# 🌊 Flood Monitoring Dashboard — Web Frontend

The web-based frontend for the **Flood Monitoring Dashboard System**, a Final Year Project at **Universiti Kuala Lumpur (UniKL), 2026**. This dashboard connects to Google Firebase Firestore to visualise real-time flood data transmitted by vehicle-mounted IoT sensor units.

> **Related Repository:** [ESP32 Firmware & Hardware](https://github.com/IrfanFardaus/Flood-Monitoring-Dashboard-system)  
> **Live Deployment:** Hosted on [Cloudflare Pages](https://pages.cloudflare.com/)

---

## 📌 Overview

This single-page application (SPA) displays live flood data collected by vehicle-mounted ESP32 sensor nodes. It listens to Firebase Firestore in real time and updates the map, charts, and alert tables instantly — no page refresh needed.

Designed for **road users and local authorities** to make fast, informed travel decisions during flood events.

---

## ✨ Features

- 🗺️ **Live Leaflet.js map** — colour-coded flood markers (🟢 Safe, 🟡 Warning, 🔴 Danger) updated in real time
- 🔔 **Toast notifications** — pop-up alerts on new Warning/Danger events
- 📋 **Alerts table** — full list of triggered alerts with severity badges and detail view
- 🙈 **Hidden alerts toggle** — view/hide dismissed alert entries
- 📟 **Device Management** — table of all registered sensor units with status and last location
- 📊 **Per-device charts** — flood height, severity, and turbidity over time (Seconds / Minutes view)
- 📈 **Analytics page** — fleet-wide stats: device counts, warning counts, offline sensors, 24-hour alerts
- 🍩 **Pie charts** — live Flood Severity and Turbidity distribution on the main dashboard
- 📉 **Trend line charts** — alert frequency, highest flood height, severity trends, turbidity trends
- 📱 **Responsive layout** — works on desktop and mobile browsers

---

## 🖥️ Pages

| Page | Description |
|---|---|
| **Dashboard** | Summary cards, severity & turbidity pie charts, live Leaflet map |
| **Device Management** | Table of all sensor nodes with location and online status |
| **Device Details** | Per-device charts — flood height, severity, turbidity (with time range filter) |
| **Alerts** | Sortable list of all Warning/Danger events; hidden alerts toggle |
| **Alert Overview** | Full detail view for a single alert: location, depth, turbidity, coordinates, timestamp |
| **Analytics** | Fleet-wide statistics and multi-chart trend overview |

---

## 📁 File Structure

```
flood-monitoring-dashboard-web/
├── index.html     # Single-page app shell — all pages, layout, navigation
├── app.js         # Firebase listener, map logic, Chart.js rendering, routing
└── styles.css     # Sidebar, cards, tables, badges, chart containers
```

---

## 🔧 Tech Stack

| Technology | Purpose |
|---|---|
| **HTML / CSS / JavaScript** | Core frontend (no framework) |
| **Firebase Firestore (JS SDK)** | Real-time database listener via WebSocket |
| **Leaflet.js v1.9.4** | Interactive OpenStreetMap-based flood map |
| **Chart.js** | Line charts, bar charts, and doughnut/pie charts |
| **Font Awesome 6.5.1** | Sidebar navigation icons |
| **Cloudflare Pages** | Static site hosting and global CDN |

---

## 🚀 Getting Started

### Prerequisites

- A Google Firebase project with **Cloud Firestore** enabled
- The [ESP32 firmware](https://github.com/IrfanFardaus/Flood-Monitoring-Dashboard-system) running and sending data to Firestore

### 1. Clone the Repository

```bash
git clone https://github.com/IrfanFardaus/flood-monitoring-dashboard-web.git
cd flood-monitoring-dashboard-web
```

### 2. Configure Firebase

Open `app.js` and update the Firebase config object with your project credentials:

```javascript
const firebaseConfig = {
  apiKey:            "your-api-key",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId:             "your-app-id"
};
```

### 3. Run Locally

No build step required — open `index.html` directly in a browser, or serve it with any static file server:

```bash
# Using VS Code Live Server extension (recommended)
# Right-click index.html → "Open with Live Server"

# Or with Python
python -m http.server 8080
# Then open http://localhost:8080
```

### 4. Deploy to Cloudflare Pages

1. Push this repository to GitHub
2. Go to [Cloudflare Pages](https://pages.cloudflare.com/) → Create a Project
3. Connect your GitHub repo
4. Set build settings:
   - **Build command:** *(leave blank — static site)*
   - **Build output directory:** `/` (root)
5. Click **Deploy** — Cloudflare will publish the site globally via CDN

---

## 📊 Dashboard Data Schema

The dashboard reads from the `sensor_history` Firestore collection. Each document must have:

```json
{
  "device_id":           "SENSOR_001",
  "depth_cm":            22.4,
  "turbidity_percent":   14.8,
  "turbidity_status":    "Dirty",
  "severity":            "WARNING",
  "timestamp":           1750000000000,
  "latitude":            3.2653822,
  "longitude":           101.72639
}
```

---

## 🚦 Severity Colour Coding

| Severity | Map Marker | Badge Colour |
|---|---|---|
| SAFE | 🟢 Green | Green |
| WARNING | 🟡 Orange | Orange |
| DANGER | 🔴 Red | Red |
| INVALID | ⚫ Grey | Grey |

---

## 📱 Navigation

The sidebar contains four main navigation buttons:

- **Dashboard** `📈` — overview map and summary charts
- **Device** `🖥️` — sensor unit management table
- **Alerts** `⚠️` — triggered event log with unread badge counter
- **Analytics** `📊` — fleet-wide trends and statistics

---

## ⚠️ Known Limitations

- Requires an internet connection to load Firebase data; no offline mode
- All sensor data is public if Firestore rules are open — consider adding authentication for production use
- Map markers are not clustered; many active devices in a small area may overlap
- Chart time ranges are limited to Seconds and Minutes views

---

## 🔮 Future Improvements

- Add user authentication (Firebase Auth) for admin access
- Implement map marker clustering for dense deployments
- Add push notifications via Firebase Cloud Messaging
- Export alerts and analytics data to CSV
- Add hourly / daily / weekly time range options for charts

---

## 📜 License

Developed for academic purposes at **Universiti Kuala Lumpur (UniKL), British Malaysian Institute, 2026**.  
All rights reserved by **Muhammad Irfan Bin Mohd Fardaus**.
