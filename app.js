import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, deleteDoc, where, getDocs, writeBatch, addDoc, updateDoc, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAM-x6ZCqqxDx6ZDCE1JefDHwzLXvDq5M0",
    authDomain: "flood-monitor-c6977.firebaseapp.com",
    projectId: "flood-monitor-c6977",
    storageBucket: "flood-monitor-c6977.firebasestorage.app",
    messagingSenderId: "383926004374",
    appId: "1:383926004374:web:3341d8576967048ff2f0b7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const locationCache = {}; // Prevents spamming the Map API


const notifiedAlerts = new Set();
const lastNotificationTimeByDevice = {};
const NOTIFICATION_COOLDOWN = 60000;
// Global State
let initialAlertsLoaded = false;
let activeDetailDevice = null;
let rawData = [];
let latestDataByDevice = {};
let mapInstance = null;
let chartInstances = {};
let isFirstLoad = true; 
let isViewingHidden = false;

// Chart Filters State
let chartRanges = {
    alertFreqChart: 'SEC',
    floodHeightChart: 'SEC',
    severityLineChart: 'SEC',
    turbidityLineChart: 'SEC'
};

let devChartRanges = {
    devHeightChart: 'SEC',
    devSeverityChart: 'SEC',
    devTurbidityChart: 'SEC'
};

// NEW: Device-level tracking for Hiding and Resolving
let hiddenDevices = new Set(JSON.parse(localStorage.getItem('hiddenDevices')) || []);
let resolvedDevices = JSON.parse(localStorage.getItem('resolvedDevices')) || {};

// 1 Hour in milliseconds (Change this to adjust how long a "Resolved" alert stays quiet)
const RESOLVE_COOLDOWN = 60 * 60 * 1000;

const OFFLINE_THRESHOLD = 90000; 

// Navigation Logic
window.navigate = function(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(pageId).classList.add('active');
    const triggerBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.getAttribute('onclick').includes(pageId));
    if(triggerBtn) triggerBtn.classList.add('active');

    if(pageId === 'dashboard' && mapInstance) {
        setTimeout(() => mapInstance.invalidateSize(), 250);
    }
};

// Update Time Filter Selection
window.updateChartRange = function(chartId, range, btnElement) {
    chartRanges[chartId] = range;
    
    const siblings = btnElement.parentElement.querySelectorAll('.filter-btn');
    siblings.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    updateAnalytics();
};

window.showToast = function(deviceId, severity, depth) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${severity.toLowerCase()}`; // Adds 'warning' or 'danger' class
    
    toast.innerHTML = `
        <div class="toast-header">
            <strong>⚠️ New ${severity} Alert</strong>
            <button onclick="this.parentElement.parentElement.remove()">✕</button>
        </div>
        <div class="toast-body">
            Device <b>${deviceId}</b> just reported a flood level of ${depth.toFixed(1)} cm.
        </div>
    `;

    container.appendChild(toast);

    // Automatically remove the popup after 5 seconds so it doesn't clutter the screen
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 5000);
};

function initMap() {
    mapInstance = L.map('map').setView([3.1390, 101.6869], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapInstance);
}

const iconSafe = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const iconWarning = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const iconDanger = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const iconOffline = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// NEW: Fetch data from Cloudflare instead of Firebase
async function fetchCachedData() {
    try {
        // PASTE YOUR CLOUDFLARE WORKER URL HERE
        const response = await fetch("https://flood-monitor-api.aonomi175.workers.dev");
        const fetchedData = await response.json();

        rawData = [];
        latestDataByDevice = {};

        fetchedData.forEach((data) => {
            rawData.push(data);
            if (!latestDataByDevice[data.device_id]) {
                latestDataByDevice[data.device_id] = data;
            }
        });

        if (isFirstLoad) {
            refreshUI();
            isFirstLoad = false;
        }
    } catch (error) {
        console.error("Error fetching cached data:", error);
    }
}

function listenForData() {
    // 1. Fetch immediately when the dashboard loads
    fetchCachedData();
    
    // 2. Poll the Cloudflare Worker every 10 seconds. 
    // (Don't worry, even if you poll every 10 seconds, Cloudflare only asks Firebase every 60 seconds due to the cache!)
    setInterval(fetchCachedData, 10000);
}

function refreshUI() {
    updateDashboard();
    updateAdminTable();
    updateAlertsTable();
    updateAnalytics();
    
    // Automatically update the device detail charts if the user is looking at them
    if (document.getElementById('device-details').classList.contains('active')) {
        updateDeviceDetailCharts();
    }
}

function updateDashboard() {
    const devices = Object.values(latestDataByDevice);
    document.getElementById('dash-total-devices').innerText = devices.length;
    
    let onlineCount = 0;
    let severityCounts = { SAFE: 0, WARNING: 0, DANGER: 0 };
    let turbidityCounts = { Clean: 0, Cloudy: 0, Dirty: 0 };
    const currentTime = Date.now();

    mapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
            mapInstance.removeLayer(layer);
        }
    });

    devices.forEach(d => {
        const isOnline = Math.abs(currentTime - d.timestamp) < OFFLINE_THRESHOLD;
        // NEW: Identify if the device is still waiting for GPS
        const isWaitingForGPS = (d.latitude === 0 && d.longitude === 0);
        
        let currentIcon = iconOffline;
        
        if (isOnline) {
            onlineCount++;
            
            if (severityCounts[d.severity] !== undefined) severityCounts[d.severity]++;
            if (turbidityCounts[d.turbidity_status] !== undefined) turbidityCounts[d.turbidity_status]++;

            if (d.severity === 'SAFE') currentIcon = iconSafe;
            else if (d.severity === 'WARNING') currentIcon = iconWarning;
            else if (d.severity === 'DANGER') currentIcon = iconDanger;
        }

        // NEW: Only add the marker to the map if it has a real coordinate
        if (!isWaitingForGPS) {
            const marker = L.marker([d.latitude, d.longitude], { icon: currentIcon }).addTo(mapInstance);
            
            marker.bindPopup(`
                <b>Device ID:</b> ${d.device_id}<br>
                <b>Location:</b> Lat ${d.latitude.toFixed(4)}, Lng ${d.longitude.toFixed(4)}<br>
                <b>Flood Level:</b> ${d.depth_cm.toFixed(1)} cm<br>
                <b>Severity:</b> ${d.severity}<br>
                <b>Turbidity:</b> ${d.turbidity_status}<br>
                <b>Status:</b> ${isOnline ? '<span style="color:green">Online</span>' : '<span style="color:gray">Offline</span>'}
            `);
        }
    });

    document.getElementById('dash-online-devices').innerText = onlineCount;
    
    renderPieChart('severityPieChart', ['Safe', 'Warning', 'Danger'], [severityCounts.SAFE, severityCounts.WARNING, severityCounts.DANGER], ['#2ecc71', '#f39c12', '#e74c3c']);
    renderPieChart('turbidityPieChart', ['Clean', 'Cloudy', 'Dirty'], [turbidityCounts.Clean, turbidityCounts.Cloudy, turbidityCounts.Dirty], ['#2ecc71', '#f39c12', '#e74c3c']);
}

function updateAdminTable() {
    const tbody = document.getElementById('device-table-body');
    tbody.innerHTML = '';
    const currentTime = Date.now();

    // 1. Grab the devices and explicitly sort them alphabetically by ID!
    const sortedDevices = Object.values(latestDataByDevice).sort((a, b) => a.device_id.localeCompare(b.device_id));

    // 2. Loop through the sorted array instead of the raw object
    sortedDevices.forEach((d, index) => {
        const isOnline = Math.abs(currentTime - d.timestamp) < OFFLINE_THRESHOLD;
        const tr = document.createElement('tr');
        
        const coordKey = `${d.latitude},${d.longitude}`;
        
        // NEW: Check if coordinates are 0
        const isWaitingForGPS = (d.latitude === 0 && d.longitude === 0);

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${d.device_id}</td>
            <td id="loc-${d.device_id}">${isWaitingForGPS ? 'Waiting for GPS...' : `Fetching... (${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)})`}</td>
            <td><span class="badge ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span></td>
            <td>
                <button class="action-btn" onclick='viewDeviceDetails("${d.device_id}")' title="View Device Details"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn" onclick='deleteDevice("${d.device_id}")' style="color: #e74c3c; margin-left: 10px;" title="Delete Device"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);

        // Map Cache Logic
        if (isWaitingForGPS) {
            // Do not hit the API if we don't have a valid GPS lock yet
            return; 
        } else if (locationCache[coordKey]) {
            document.getElementById(`loc-${d.device_id}`).innerText = locationCache[coordKey];
        } else {
            fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${d.latitude}&lon=${d.longitude}`)
                .then(res => res.json())
                .then(geoData => {
                    let locName = "Unknown Location";
                    if (geoData && geoData.display_name) {
                        locName = geoData.display_name.split(',').slice(0, 2).join(', ');
                    }
                    locationCache[coordKey] = locName; 
                    
                    const locCell = document.getElementById(`loc-${d.device_id}`);
                    if(locCell) locCell.innerText = locName;
                })
                .catch(err => console.error("Geocoding failed", err));
        }
    });
}

window.viewDeviceDetails = function(deviceId) {
    activeDetailDevice = deviceId;
    navigate('device-details');
    document.getElementById('device-detail-title').innerText = `Device Details: ${deviceId}`;
    updateDeviceDetailCharts();
};

// Handles clicking the new buttons on the Device Details page
window.updateDevChartRange = function(chartId, range, btnElement) {
    devChartRanges[chartId] = range;
    
    const siblings = btnElement.parentElement.querySelectorAll('.filter-btn');
    siblings.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    updateDeviceDetailCharts();
};

// Calculates the time-steps for a single specific device
function getSingleDeviceChartData(deviceId, range) {
    const now = new Date();
    let stepSize, numSteps, labelFormat;

    if (range === 'SEC') {
        now.setMilliseconds(0);
        now.setSeconds(Math.floor(now.getSeconds() / 5) * 5); 
        stepSize = 5 * 1000; 
        numSteps = 60; 
        labelFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); 
    } else if (range === 'MIN') {
        now.setSeconds(0, 0); 
        stepSize = 60 * 1000; 
        numSteps = 60;        
        labelFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const currentTime = now.getTime();
    const timeLabels = [];
    const heightData = [], safeData = [], warningData = [], dangerData = [];
    const cleanData = [], cloudyData = [], dirtyData = [];

    // Filter raw database for ONLY the device we are currently looking at
    const deviceRawData = rawData.filter(d => d.device_id === deviceId);

    // Build the graph from left to right
    for (let i = numSteps - 1; i >= 0; i--) {
        const stepTimeEnd = currentTime - (i * stepSize);
        timeLabels.push(labelFormat(new Date(stepTimeEnd)));
        
        // Find the most recent ping for this specific time slice
        const reading = deviceRawData.find(d => d.timestamp <= stepTimeEnd);

        // If a reading exists and the sensor wasn't offline
        if (reading && Math.abs(stepTimeEnd - reading.timestamp) < OFFLINE_THRESHOLD) {
            heightData.push(reading.depth_cm);
            safeData.push(reading.severity === 'SAFE' ? 1 : 0);
            warningData.push(reading.severity === 'WARNING' ? 1 : 0);
            dangerData.push(reading.severity === 'DANGER' ? 1 : 0);
            cleanData.push(reading.turbidity_status === 'Clean' ? 1 : 0);
            cloudyData.push(reading.turbidity_status === 'Cloudy' ? 1 : 0);
            dirtyData.push(reading.turbidity_status === 'Dirty' ? 1 : 0);
        } else {
            // Flatline at zero if offline
            heightData.push(0);
            safeData.push(0); warningData.push(0); dangerData.push(0);
            cleanData.push(0); cloudyData.push(0); dirtyData.push(0);
        }
    }

    return { timeLabels, heightData, safeData, warningData, dangerData, cleanData, cloudyData, dirtyData };
}

// Replaces your old rendering function
function updateDeviceDetailCharts() {
    if (!activeDetailDevice) return;

    // Cache to prevent recalculating the same math if multiple charts share the same time filter
    const devDataCache = {};
    const getDevCachedData = (range) => {
        if (!devDataCache[range]) devDataCache[range] = getSingleDeviceChartData(activeDetailDevice, range);
        return devDataCache[range];
    };

    const hData = getDevCachedData(devChartRanges.devHeightChart);
    renderLineChart('devHeightChart', hData.timeLabels, [{ label: 'Flood Depth (cm)', data: hData.heightData, borderColor: '#34495e', fill: true, backgroundColor: 'rgba(52, 73, 94, 0.2)' }]);
    
    const sData = getDevCachedData(devChartRanges.devSeverityChart);
    renderLineChart('devSeverityChart', sData.timeLabels, [
        { label: 'Safe', data: sData.safeData, borderColor: '#2ecc71', backgroundColor: '#2ecc71' },
        { label: 'Warning', data: sData.warningData, borderColor: '#f39c12', backgroundColor: '#f39c12' },
        { label: 'Danger', data: sData.dangerData, borderColor: '#e74c3c', backgroundColor: '#e74c3c' }
    ], true);

    const tData = getDevCachedData(devChartRanges.devTurbidityChart);
    renderLineChart('devTurbidityChart', tData.timeLabels, [
        { label: 'Clean', data: tData.cleanData, borderColor: '#2ecc71', backgroundColor: '#2ecc71' },
        { label: 'Cloudy', data: tData.cloudyData, borderColor: '#f39c12', backgroundColor: '#f39c12' },
        { label: 'Dirty', data: tData.dirtyData, borderColor: '#e74c3c', backgroundColor: '#e74c3c' }
    ], true);
}

function updateAlertsTable() {
    const tbody = document.getElementById('alerts-table-body');
    tbody.innerHTML = '';
    let alertCounter = 1000;
    const latestAlertsByDevice = {};
    
    let activeAlertCount = 0; 

    // Find the latest alerts
    rawData.forEach(d => {
        if ((d.severity === 'WARNING' || d.severity === 'DANGER') && !latestAlertsByDevice[d.device_id]) {
            latestAlertsByDevice[d.device_id] = d;
        }
    });

    Object.values(latestAlertsByDevice).forEach((alertData) => {
        alertCounter++;
        const alertId = `A-${alertCounter}`;
        const deviceId = alertData.device_id;
        
        // 1. Is this device permanently hidden?
        const isHidden = hiddenDevices.has(deviceId);
        
        // 2. Is this device resolved (snoozed)?
        let isResolved = false;
        if (resolvedDevices[deviceId]) {
            const timeSinceResolved = Date.now() - resolvedDevices[deviceId];
            
            if (timeSinceResolved < RESOLVE_COOLDOWN) {
                isResolved = true; // Still snoozed!
            } else {
                // Cooldown expired! It's been over an hour, remove from resolved list
                delete resolvedDevices[deviceId];
                localStorage.setItem('resolvedDevices', JSON.stringify(resolvedDevices));
            }
        }

        // If it's hidden OR resolved, treat it as hidden from the main view
        const effectivelyHidden = isHidden || isResolved;

        if (!effectivelyHidden) {
            activeAlertCount++;
        }

        // --- POPUP NOTIFICATION LOGIC ---
        if (!notifiedAlerts.has(alertData.id)) {
            notifiedAlerts.add(alertData.id); 

            if (initialAlertsLoaded && !effectivelyHidden) {
                const currentTime = Date.now();
                const lastNotified = lastNotificationTimeByDevice[deviceId] || 0;

                if (currentTime - lastNotified > NOTIFICATION_COOLDOWN) {
                    showToast(deviceId, alertData.severity, alertData.depth_cm);
                    lastNotificationTimeByDevice[deviceId] = currentTime;
                }
            }
        }

        // --- FILTER VIEWS ---
        if (isViewingHidden && !effectivelyHidden) return;
        if (!isViewingHidden && effectivelyHidden) return;

        const dateStr = new Date(alertData.timestamp).toLocaleString();
        
        // --- ACTION BUTTONS ---
        let actionBtnHTML = '';
        if (isViewingHidden) {
            // Restore Icon
            actionBtnHTML = `<button class="action-btn" onclick='restoreAlert("${deviceId}")' style="color: #2ecc71; margin-left: 10px;" title="Restore Alert"><i class="fa-solid fa-rotate-left"></i></button>`;
        } else {
            // Resolve AND Hide Icons
            actionBtnHTML = `
                <button class="action-btn" onclick='resolveAlert("${deviceId}")' style="color: #3498db; margin-left: 10px;" title="Resolve (Snooze for 1 Hour)"><i class="fa-solid fa-check"></i></button>
                <button class="action-btn" onclick='hideAlert("${deviceId}")' style="color: #95a5a6; margin-left: 10px;" title="Hide Permanently"><i class="fa-solid fa-eye-slash"></i></button>
            `;
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${alertId}</td>
            <td>${deviceId}</td>
            <td>${dateStr}</td>
            <td><span class="badge ${alertData.severity.toLowerCase()}">${alertData.severity}</span></td>
            <td>
                <button class="action-btn" onclick='viewAlertOverview(${JSON.stringify(alertData)}, "${alertId}")'><i class="fa-solid fa-eye"></i></button>
                ${actionBtnHTML}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update Notification Bubble
    const navBadge = document.getElementById('nav-alert-badge');
    if (navBadge) {
        if (activeAlertCount > 0) {
            navBadge.innerText = activeAlertCount;
            navBadge.style.display = 'inline-block'; 
        } else {
            navBadge.style.display = 'none'; 
        }
    }
    
    initialAlertsLoaded = true; 
}

window.viewAlertOverview = async function(data, alertId) {
    navigate('alert-overview');
    
    // Set standard data
    document.getElementById('overview-title').innerText = alertId;
    document.getElementById('ov-alert-id').innerText = alertId;
    document.getElementById('ov-device-id').innerText = data.device_id;
    document.getElementById('ov-severity').innerText = data.severity;
    document.getElementById('ov-severity').className = `badge ${data.severity.toLowerCase()}`;
    document.getElementById('ov-level').innerText = `${data.depth_cm.toFixed(1)} cm`;
    document.getElementById('ov-coord').innerText = `${data.latitude}, ${data.longitude}`;
    document.getElementById('ov-turbidity').innerText = data.turbidity_status;
    document.getElementById('ov-timestamp').innerText = new Date(data.timestamp).toLocaleString();

    // Show a loading message while we fetch the real name
    document.getElementById('ov-location').innerText = "Fetching location name..."; 

    // Translate Coordinates into a Location Name using OpenStreetMap
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${data.latitude}&lon=${data.longitude}`);
        const geoData = await response.json();
        
        if (geoData && geoData.display_name) {
            // Grab the first two parts of the address to keep it readable (e.g., "Gombak, Selangor")
            const shortName = geoData.display_name.split(',').slice(0, 2).join(', ');
            document.getElementById('ov-location').innerText = shortName;
        } else {
            document.getElementById('ov-location').innerText = "Unknown Location";
        }
    } catch (error) {
        console.error("Error fetching location:", error);
        document.getElementById('ov-location').innerText = "Location unavailable";
    }
}

window.toggleHiddenAlerts = function() {
    isViewingHidden = !isViewingHidden;
    const btn = document.getElementById('toggle-hidden-btn');
    
    if (isViewingHidden) {
        btn.innerText = "View Active Alerts";
        btn.classList.add('active');
    } else {
        btn.innerText = "View Hidden Alerts";
        btn.classList.remove('active');
    }
    
    updateAlertsTable(); // Refresh the table
};

window.hideAlert = function(deviceId) {
    hiddenDevices.add(deviceId);
    localStorage.setItem('hiddenDevices', JSON.stringify(Array.from(hiddenDevices)));
    updateAlertsTable();
};

window.resolveAlert = function(deviceId) {
    // Save the exact time the user clicked 'Resolve'
    resolvedDevices[deviceId] = Date.now();
    localStorage.setItem('resolvedDevices', JSON.stringify(resolvedDevices));
    updateAlertsTable();
};

window.restoreAlert = function(deviceId) {
    hiddenDevices.delete(deviceId);
    delete resolvedDevices[deviceId]; // Clear resolve timers too
    
    localStorage.setItem('hiddenDevices', JSON.stringify(Array.from(hiddenDevices)));
    localStorage.setItem('resolvedDevices', JSON.stringify(resolvedDevices));
    updateAlertsTable();
};

window.deleteDevice = async function(deviceId) {
    if(confirm(`Are you sure you want to delete device ${deviceId}?`)) {
        try {
            const q = query(collection(db, "sensor_history"), where("device_id", "==", deviceId));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach((document) => batch.delete(document.ref));
            await batch.commit();
        } catch (error) {
            console.error("Error deleting device: ", error);
        }
    }
}


function getChartDataForRange(range) {
    const now = new Date();
    let stepSize, numSteps, labelFormat;

    if (range === 'SEC') {
        // Seconds: 5-second intervals over 5 minutes
        now.setMilliseconds(0);
        now.setSeconds(Math.floor(now.getSeconds() / 5) * 5); 
        stepSize = 5 * 1000; 
        numSteps = 60; 
        labelFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); 
        
    } else if (range === 'MIN') {
        // Minutes: 1-minute intervals over 1 hour
        now.setSeconds(0, 0); 
        stepSize = 60 * 1000; 
        numSteps = 60;        
        labelFormat = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const currentTime = now.getTime();
    
    const timeLabels = [];
    const safeData = [], warningData = [], dangerData = [];
    const cleanData = [], cloudyData = [], dirtyData = [];
    const alertDataByTime = [], highestHeightByTime = [];

    for (let i = numSteps - 1; i >= 0; i--) {
        const stepTimeEnd = currentTime - (i * stepSize);
        timeLabels.push(labelFormat(new Date(stepTimeEnd)));
        
        const devicesStateAtStep = {};
        for (let log of rawData) {
            if (log.timestamp <= stepTimeEnd) {
                if (!devicesStateAtStep[log.device_id]) {
                    devicesStateAtStep[log.device_id] = log;
                }
            }
        }

        let maxDepth = 0;
        let alerts = 0, safe = 0, warning = 0, danger = 0;
        let clean = 0, cloudy = 0, dirty = 0;

        Object.values(devicesStateAtStep).forEach(deviceLog => {
            const isOnline = Math.abs(stepTimeEnd - deviceLog.timestamp) < OFFLINE_THRESHOLD;

            if (isOnline) {
                if (deviceLog.depth_cm > maxDepth) maxDepth = deviceLog.depth_cm;
                if (deviceLog.severity === 'WARNING' || deviceLog.severity === 'DANGER') alerts++;
                if (deviceLog.severity === 'SAFE') safe++;
                if (deviceLog.severity === 'WARNING') warning++;
                if (deviceLog.severity === 'DANGER') danger++;

                if (deviceLog.turbidity_status === 'Clean') clean++;
                if (deviceLog.turbidity_status === 'Cloudy') cloudy++;
                if (deviceLog.turbidity_status === 'Dirty') dirty++;
            } 
        });

        highestHeightByTime.push(maxDepth);
        alertDataByTime.push(alerts);
        safeData.push(safe);
        warningData.push(warning);
        dangerData.push(danger);
        cleanData.push(clean);
        cloudyData.push(cloudy);
        dirtyData.push(dirty);
    }

    return { timeLabels, highestHeightByTime, alertDataByTime, safeData, warningData, dangerData, cleanData, cloudyData, dirtyData };
}

function updateAnalytics() {
    const devices = Object.values(latestDataByDevice);
    const currentTime = Date.now();
    let onlineCount = 0;
    let warningDevicesCount = new Set();
    let alerts24hSet = new Set(); 

    rawData.forEach(d => {
        if (d.severity === 'WARNING' || d.severity === 'DANGER') {
            warningDevicesCount.add(d.device_id);
            if (Math.abs(currentTime - d.timestamp) <= 86400000) { 
                alerts24hSet.add(d.device_id); 
            }
        }
    });

    devices.forEach(d => {
        if (Math.abs(currentTime - d.timestamp) < OFFLINE_THRESHOLD) onlineCount++;
    });

    document.getElementById('stat-total').innerText = devices.length;
    document.getElementById('stat-warnings').innerText = warningDevicesCount.size;
    document.getElementById('stat-offline').innerText = devices.length - onlineCount;
    document.getElementById('stat-alerts24').innerText = alerts24hSet.size;

    renderPieChart('statusPieChart', ['Online', 'Offline'], [onlineCount, devices.length - onlineCount], ['#2ecc71', '#95a5a6']);

    // Map through individual chart state and render accordingly
    const dataCache = {};
    const getCachedData = (range) => {
        if (!dataCache[range]) dataCache[range] = getChartDataForRange(range);
        return dataCache[range];
    };

    // 1. Alert Frequency - Force Integers
    const alertData = getCachedData(chartRanges.alertFreqChart);
    renderLineChart('alertFreqChart', alertData.timeLabels, [{ label: 'Alerts', data: alertData.alertDataByTime, borderColor: '#e74c3c', backgroundColor: '#e74c3c' }], true);

    // 2. Flood Height - Keep Floats (No 4th parameter needed)
    const floodData = getCachedData(chartRanges.floodHeightChart);
    renderLineChart('floodHeightChart', floodData.timeLabels, [{ label: 'Max Depth (cm)', data: floodData.highestHeightByTime, borderColor: '#34495e', fill: true, backgroundColor: 'rgba(52, 73, 94, 0.2)' }]);
    
    // 3. Severity Trends - Force Integers
    const severityData = getCachedData(chartRanges.severityLineChart);
    renderLineChart('severityLineChart', severityData.timeLabels, [
        { label: 'Safe', data: severityData.safeData, borderColor: '#2ecc71', backgroundColor: '#2ecc71' },
        { label: 'Warning', data: severityData.warningData, borderColor: '#f39c12', backgroundColor: '#f39c12' },
        { label: 'Danger', data: severityData.dangerData, borderColor: '#e74c3c', backgroundColor: '#e74c3c' }
    ], true);

    // 4. Turbidity Trends - Force Integers
    const turbidityData = getCachedData(chartRanges.turbidityLineChart);
    renderLineChart('turbidityLineChart', turbidityData.timeLabels, [
        { label: 'Clean', data: turbidityData.cleanData, borderColor: '#2ecc71', backgroundColor: '#2ecc71' },
        { label: 'Cloudy', data: turbidityData.cloudyData, borderColor: '#f39c12', backgroundColor: '#f39c12' },
        { label: 'Dirty', data: turbidityData.dirtyData, borderColor: '#e74c3c', backgroundColor: '#e74c3c' }
    ], true);
}

function renderPieChart(canvasId, labels, data, colors) {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].data.labels = labels;
        chartInstances[canvasId].data.datasets[0].data = data;
        chartInstances[canvasId].data.datasets[0].backgroundColor = colors;
        chartInstances[canvasId].update();
    } else {
        const ctx = document.getElementById(canvasId).getContext('2d');
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: { 
                labels: labels, 
                datasets: [{ 
                    data: data, 
                    backgroundColor: colors,
                    borderWidth: 0 // Removes the harsh white borders between segments
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                cutout: '75%', // Makes the doughnut ring thinner and more modern
                plugins: {
                    legend: {
                        position: 'right', // Moves the legend to the side to give the chart room
                        labels: {
                            usePointStyle: true, // Changes the legend color boxes into clean circles
                            padding: 15,
                            font: {
                                size: 11
                            }
                        }
                    }
                }
            }
        });
    }
}

function renderLineChart(canvasId, labels, datasets, forceIntegers = false) {
    if (chartInstances[canvasId]) {
        // If the chart already exists, just update the data!
        // This makes the line smoothly slide over instead of blinking/redrawing
        chartInstances[canvasId].data.labels = labels;
        chartInstances[canvasId].data.datasets = datasets;
        chartInstances[canvasId].update('none'); // 'none' disables the bouncy redraw, making the line flow smoothly
    } else {
        // If it doesn't exist yet, create it for the first time
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Configure Y-axis dynamically
        let yAxisOptions = { beginAtZero: true };
        if (forceIntegers) {
            yAxisOptions.ticks = {
                precision: 0, 
                stepSize: 1   
            };
        }

        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                scales: { y: yAxisOptions }, 
                elements: { 
                    line: { tension: 0 },
                    point: { radius: 2 } // Keeps the graph clean without dots
                } 
            }
        });
    }
}

window.onload = () => {
    initMap();
    listenForData();

    // Heartbeat logic completely handles UI refresh - rigidly set to 1 minute updates
    setInterval(() => {
        if (Object.keys(latestDataByDevice).length > 0) {
            refreshUI();
        }
    }, 5000); 
};