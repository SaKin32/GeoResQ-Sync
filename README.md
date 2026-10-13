# 🛰️ GeoResQ-Sync
### Autonomous Geospatial Disaster Response & Relief Coordination Engine

> **GeoResQ-Sync is an autonomous disaster coordinator powered by MySQL 8.0 Spatial GIS. It leverages `ST_Distance_Sphere` to detect nearest volunteers within 5km, automates live USGS earthquake alerts, and ensures zero-deficit relief dispatch through strict ACID transactions and Leaflet.js mapping.**

---

## 📌 Project Overview
**GeoResQ-Sync** is a pure software-based disaster management and localized humanitarian rescue platform. It completely bypasses the need for proprietary IoT/hardware beacons by utilizing the native **MySQL 8.0 Spatial GIS Engine**, calculating spherical Earth surface geometry directly within database queries to pinpoint and dispatch the closest community volunteers during natural disasters (such as flash floods, cyclones, and earthquakes).

---

## 🛠️ Key Architectural Highlights

* **Geospatial Distance Calculation (`ST_Distance_Sphere`):** Computes precise great-circle distance (in meters and kilometers) on Earth's surface between victims and volunteers within a 5,000m radius directly inside MySQL.
* **ACID Inventory Logistics:** Guarantees zero stock deficit during emergency aid distribution using pessimistic row-level locking (`SELECT ... FOR UPDATE`), transaction rollbacks, and database audit logs (`relief_dispatches`).
* **Automated Early-Warning Feeds:** Integrated background cron worker continuously polls real-time seismic event feeds from the **USGS Earthquake API** and writes updates to the database.
* **Advanced MySQL Schema Objects:** Includes relational tables with foreign key cascades, **Spatial Indexes**, **Database Views** (`vw_active_rescue_missions`, `vw_relief_inventory_status`), **Stored Procedures** (`sp_find_nearest_volunteers`, `sp_dispatch_relief_acid`), and automated **Triggers** (`trg_auto_update_sos_on_volunteer_assign`).
* **Interactive Frontend Radar:** Dark glassmorphic interface powered by **Leaflet.js**, featuring live coordinate picking, dynamic radius perimeters, emergency queues, and multi-layer map switching.

---

## 🗂️ Tech Stack
* **Database:** MySQL 8.0+ / MariaDB (Spatial GIS Engine enabled via XAMPP)
* **Backend:** Node.js, Express.js, `mysql2/promise`, `node-cron`, `cors`
* **Frontend:** Vanilla JavaScript (ES6+), Leaflet.js, Tailwind CSS (CDN), FontAwesome 6
* **External APIs:** USGS Global Earthquake GeoJSON Feed

---

## 📋 System Prerequisites
Before running the application on your computer, ensure you have:
1. **Node.js** (v18.0.0 or higher) — [Download Node.js](https://nodejs.org/)
2. **XAMPP** (for Apache & MySQL) — [Download XAMPP](https://www.apachefriends.org/)
3. A modern web browser (Google Chrome, Microsoft Edge, Brave, or Firefox)

---

## 🚀 5-Minute Quickstart & Installation Guide

### Step 1: Start MySQL in XAMPP
1. Open the **XAMPP Control Panel**.
2. Click **Start** next to **Apache** and **MySQL** (both should turn green).

### Step 2: Import Database Schema
1. Open your browser and navigate to:  
   👉 `http://localhost/phpmyadmin`
2. Click on the **SQL** tab in the top navigation bar.
3. Open the `schema.sql` file from this project in any text editor, copy all of its content, paste it into the phpMyAdmin SQL text box, and click **Go**.  
   *(This automatically creates `disaster_rescue_db`, all 6 core tables, Spatial Indexes, Views, Stored Procedures, Triggers, and sample seed data for testing.)*

### Step 3: Configure Environment Variables
Verify or create a `.env` file in the project root directory with standard XAMPP defaults:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=disaster_rescue_db
DB_PORT=3306
CRON_SCHEDULE=*/30 * * * *
```
*(Note: XAMPP's default MySQL root password is empty.)*

### Step 4: Install Dependencies & Run Server
1. Open your Terminal / Command Prompt (CMD) inside the project folder:
   ```cmd
   cd /d E:\disaster-rescue-backend
   ```
2. Install the necessary NPM dependencies:
   ```cmd
   npm install
   ```
3. Start the application:
   ```cmd
   npm run dev
   ```
   *(Alternatively, run `npm start`)*

Once started, you will see:
```text
✅ Connected to MySQL Database successfully.
🕒 Disaster Alert Cron Job scheduled with pattern: [*/30 * * * *]
🚀 Disaster Rescue Backend Server running on http://localhost:5000
```

### Step 5: Open the Interactive Dashboard
Launch your browser and visit:  
👉 **`http://localhost:5000`**

---

## 🧪 Comprehensive Testing Scenarios (For Evaluators & Testers)

| Test Case | How to Test | Expected Behavior |
|---|---|---|
| **1. Nearest Volunteer Radar (Spatial SQL)** | In the left panel, click on **"Rafiqul Islam (CRITICAL)"**. | The Leaflet map smoothly pans to Sylhet Sadar flood zone with a 5km cyan perimeter circle. Below, the system dynamically calculates distances using `ST_Distance_Sphere`: **Tanvir Ahmed (73.26m)** and **Nusrat Jahan (1.5km)**. |
| **2. Volunteer Assignment** | Click the **"Assign"** button next to Tanvir Ahmed. | The volunteer status updates to `BUSY`, and the SOS status switches from `PENDING` to `ASSIGNED` via database update/trigger. |
| **3. ACID Relief Dispatch (Zero Deficit)** | Click **"Dispatch Aid (ACID)"** on the top right. Select a team and 10 units of an item, then submit. | Executes pessimistic row locking (`SELECT ... FOR UPDATE`), decrements inventory, and records an entry in `relief_dispatches`. If requested quantity exceeds stock, the database transaction automatically rolls back. |
| **4. Submit New SOS Request** | Click **"Send SOS Request"** or click anywhere on the interactive map to pick coordinates, then submit. | Saves coordinates as native MySQL `POINT(lng, lat)`, adds a glowing red marker to the map, and queues the emergency incident. |
| **5. Direct Stored Procedure Test** | In phpMyAdmin SQL tab, execute: `CALL sp_find_nearest_volunteers(1, 5000);` | Directly invokes the database stored procedure and outputs the spatial calculation results table. |
| **6. Database Views Verification** | In phpMyAdmin SQL tab, execute: `SELECT * FROM vw_relief_inventory_status;` | Returns stock health analytics with calculated categories (`SUFFICIENT`, `CRITICAL LOW`, `OUT OF STOCK`). |

---

## 📡 RESTful API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the interactive visual web dashboard |
| `GET` | `/api` | API health check & endpoint documentation |
| `POST` | `/api/sos` | Create an SOS request with Spatial `POINT` |
| `GET` | `/api/sos` | Retrieve all SOS requests (optional filter `?status=PENDING`) |
| `GET` | `/api/sos/:id/nearest-volunteers?radius=5000` | Fetch nearest available volunteers using `ST_Distance_Sphere` |
| `POST` | `/api/sos/:id/assign` | Assign a volunteer team to an SOS incident |
| `POST` | `/api/relief/dispatch` | **ACID Transaction:** Deduct warehouse inventory & write audit log |
| `GET` | `/api/relief/inventory` | View current warehouse stock quantities |
| `GET` | `/api/relief/dispatches` | View relief dispatch audit log history |
| `PUT` | `/api/volunteers/:id/location` | Update volunteer live GPS location (`POINT`) |
| `GET` | `/api/alerts` | Get automated earthquake and disaster warnings |

---

## 📁 Repository Structure
```text
GeoResQ-Sync/
├── schema.sql                      # Complete MySQL 8.0+ DDL, Indexes, Views, Procedures, Triggers
├── package.json                    # Project metadata & dependencies
├── .env.example                    # Configuration template
├── README.md                       # Comprehensive setup & testing documentation
├── public/
│   └── index.html                  # Glassmorphic Leaflet.js Frontend Dashboard
└── src/
    ├── server.js                   # Express application entrypoint
    ├── config/
    │   └── db.js                   # MySQL2 connection pool setup
    ├── controllers/
    │   ├── sosController.js        # Spatial queries & SOS management
    │   ├── reliefController.js     # ACID transaction & inventory distribution
    │   ├── volunteerController.js  # Live volunteer GPS location updates
    │   └── alertController.js      # External alert handlers
    ├── routes/
    │   ├── sosRoutes.js
    │   ├── reliefRoutes.js
    │   ├── volunteerRoutes.js
    │   └── alertRoutes.js
    └── services/
        └── cronService.js          # Scheduled polling worker for USGS live feeds
```

---

## 👥 Sharing with Teammates
When sharing this project as a ZIP archive:
* Exclude the `node_modules` folder to keep the archive under **1 MB**.
* Recipients only need to run `npm install` after extracting to download all required packages.

---

## 📄 License
This project is open-source and developed for academic database evaluation and disaster relief innovation.
