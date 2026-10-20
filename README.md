# 🛰️ GeoResQ-Sync v2.0
### Autonomous Geospatial Disaster Response, Evacuation & ACID Aid Coordination Engine

> **GeoResQ-Sync is an autonomous disaster coordinator powered by MySQL 8.0 Spatial GIS. It leverages `ST_Distance_Sphere` to detect nearest volunteers and safe evacuation shelters within 5–15km, automates live USGS earthquake & flood alerts, handles crowdsourced donor contributions, and guarantees zero-deficit relief dispatch through strict ACID transactions and Leaflet.js mapping.**

---

## 📌 Project Overview
**GeoResQ-Sync** is a pure software-based disaster management and localized humanitarian rescue platform. It completely bypasses the need for proprietary IoT/hardware beacons by utilizing the native **MySQL 8.0 Spatial GIS Engine**, calculating spherical Earth surface geometry directly within database queries to pinpoint and dispatch the closest community volunteers and guide victims to open evacuation shelters during natural disasters (such as flash floods, cyclones, and earthquakes).

---

## 🛠️ Key Architectural Highlights

* **Geospatial Distance Calculation (`ST_Distance_Sphere`):** Computes precise great-circle distance (in meters and kilometers) on Earth's surface between victims, volunteers, and evacuation shelters within a 5,000–15,000m perimeter directly inside MySQL.
* **Safe Evacuation Shelters:** Tracks live shelter capacity, occupancy constraints (`CHECK (current_occupancy <= capacity)`), and medical facilities, rendering instant routes on Leaflet.js.
* **ACID Inventory Logistics Linked to SOS:** Guarantees zero stock deficit during emergency aid distribution using pessimistic row-level locking (`SELECT ... FOR UPDATE`), transaction rollbacks, and database audit logs (`relief_dispatches`) linked to specific SOS incidents.
* **Crowdsourced Donor Contributions:** Public donors pledge emergency relief supplies; central warehouse approval automatically restocks inventory via database triggers.
* **Volunteer Fleet Capabilities:** Tracks specialized rescue equipment (Boats, Ambulances), skills (Diver, Paramedic), blood groups, and enables one-click mission completion (`RESOLVED`).
* **Automated Early-Warning Feeds:** Integrated background cron worker continuously polls real-time seismic event feeds from the **USGS Earthquake API** and BMD/FFWC flood warnings into the database.
* **Advanced MySQL Schema Objects:** Includes 8 relational tables with foreign key cascades, **Spatial Indexes**, 3 **Database Views** (`vw_active_rescue_missions`, `vw_relief_inventory_status`, `vw_shelters_overview`), 3 **Stored Procedures** (`sp_find_nearest_volunteers`, `sp_find_nearest_shelters`, `sp_dispatch_relief_acid`), and automated **Triggers** (`trg_auto_update_sos_on_volunteer_assign`, `trg_increase_inventory_on_donation_approved`).
* **Interactive Frontend Radar:** Dark glassmorphic interface powered by **Leaflet.js**, featuring live coordinate picking, dynamic radius perimeters, emergency queues, donor portals, and multi-layer map switching.

---

## 🗂️ Tech Stack
* **Database:** MySQL 8.0+ / MariaDB (Spatial GIS Engine enabled via XAMPP or Native MySQL)
* **Backend:** Node.js, Express.js, `mysql2/promise`, `bcryptjs`, `jsonwebtoken`, `node-cron`, `cors`
* **Frontend:** Vanilla JavaScript (ES6+), Leaflet.js, Tailwind CSS (CDN), FontAwesome 6
* **External APIs:** USGS Global Earthquake GeoJSON Feed & Meteorological Flood Early-Warning Feeds

---

## 📋 System Prerequisites
Before running the application on your computer, ensure you have:
1. **Node.js** (v18.0.0 or higher) — [Download Node.js](https://nodejs.org/)
2. **XAMPP** or **MySQL 8.0 Server** (running on port 3306)
3. A modern web browser (Google Chrome, Microsoft Edge, Brave, or Firefox)

---

## 🚀 Quickstart & Installation Guide

### Step 1: Start MySQL in XAMPP
1. Open the **XAMPP Control Panel**.
2. Click **Start** next to **MySQL** (should turn green on port 3306).

### Step 2: Import Database Schema
1. Open your browser and navigate to:  
   👉 `http://localhost/phpmyadmin`
2. Click on the **SQL** tab in the top navigation bar.
3. Open the `schema.sql` file from this project in any text editor, copy all of its content, paste it into the phpMyAdmin SQL text box, and click **Go**.  
   *(This automatically creates `disaster_rescue_db`, all 8 core tables, Spatial Indexes, Views, Stored Procedures, Triggers, and sample seed data for testing.)*

### Step 3: Configure Environment Variables
Verify or create a `.env` file in the project root directory:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=disaster_rescue_db
DB_PORT=3306
CRON_SCHEDULE=*/30 * * * *
JWT_SECRET=disaster_rescue_jwt_secret_key_2026
```

### Step 4: Install Dependencies & Run Server
1. Open your Terminal inside the project folder:
   ```cmd
   npm install
   ```
2. Start the application:
   ```cmd
   npm run dev
   ```

Once started, you will see:
```text
✅ Connected to MySQL Database successfully.
🕒 Disaster Alert Cron Job scheduled with pattern: [*/30 * * * *]
🚀 Disaster Rescue Backend Server running on http://localhost:5000
```

### Step 5: Open the Interactive Dashboard
Launch your browser and visit:  
👉 **`http://localhost:5000`**

### 🌐 6 Dedicated Web Pages Overview

| # | Web Page | Route URL | Purpose & Core Capabilities |
|---|---|---|---|
| **1** | **Mission Radar** | [`/`](http://localhost:5000/) or [`/radar`](http://localhost:5000/radar) | Full-screen GIS tactical radar, live incident queue, nearest fleet (5km) and shelters (15km) calculation, watermark-free dark maps. |
| **2** | **Safe Shelters** | [`/shelters`](http://localhost:5000/shelters) | Capacity tracking, occupancy bars, instant `+10 / -10` headcounts, search & filter, new shelter registration. |
| **3** | **Logistics & Donations** | [`/logistics`](http://localhost:5000/logistics) | ACID relief dispatch linked to SOS with row locking, public donor pledges, and auto-restock triggers on approval. |
| **4** | **Fleet Operations** | [`/volunteers`](http://localhost:5000/volunteers) | Rescuer roster, vehicle types (Boats, Trucks, Drones), blood groups, live GPS update, and one-click mission completion (`RESOLVED`). |
| **5** | **MySQL 8.0 Lab** | [`/lab`](http://localhost:5000/lab) | Database schema breakdown, `ST_Distance_Sphere`, ACID transaction analysis, triggers, views, and exam viva Q&A answers. |
| **6** | **Disaster Alerts** | [`/alerts`](http://localhost:5000/alerts) | Real-time USGS earthquake feeds, flood warnings, heavy rain bulletins, and emergency broadcast dispatch. |

---

## 📡 RESTful API Reference

| Module | Method | Endpoint | Description |
|---|---|---|---|
| **Auth** | `POST` | `/api/auth/register` | Register new user (Victim, Volunteer, Donor, Admin) |
| **Auth** | `POST` | `/api/auth/login` | Authenticate user & receive JWT token |
| **Auth** | `GET` | `/api/auth/me` | Fetch authenticated profile & role info |
| **Shelters** | `GET` | `/api/shelters` | List all evacuation shelters & available slots |
| **Shelters** | `GET` | `/api/shelters/nearest?lat=..&lng=..&radius=10000` | **MySQL Spatial:** Find nearest shelters using `ST_Distance_Sphere` |
| **Shelters** | `POST` | `/api/shelters` | Register a new safe shelter (Admin) |
| **Shelters** | `PATCH` | `/api/shelters/:id/occupancy` | Adjust shelter occupancy (+/- evacuees) |
| **SOS** | `POST` | `/api/sos` | Create an SOS request with Spatial `POINT` |
| **SOS** | `GET` | `/api/sos` | Retrieve all SOS requests (optional filter `?status=PENDING`) |
| **SOS** | `GET` | `/api/sos/:id/nearest-volunteers?radius=5000` | Fetch nearest available volunteers using `ST_Distance_Sphere` |
| **SOS** | `GET` | `/api/sos/:id/nearest-shelters?radius=15000` | Fetch closest safe evacuation shelter for this SOS incident |
| **SOS** | `POST` | `/api/sos/:id/assign` | Assign volunteer fleet to an SOS incident |
| **SOS** | `PATCH` | `/api/sos/:id/status` | Update SOS status (`IN_PROGRESS`, `RESOLVED`) |
| **Volunteers** | `GET` | `/api/volunteers` | List all volunteers, skills, vehicles & assigned missions |
| **Volunteers** | `PUT` | `/api/volunteers/:id/location` | Update volunteer live GPS location (`POINT`) |
| **Volunteers** | `PATCH` | `/api/volunteers/:id/status` | Toggle status (`AVAILABLE`, `BUSY`, `OFFLINE`) |
| **Volunteers** | `POST` | `/api/volunteers/:id/complete-mission` | Complete rescue mission & mark SOS as `RESOLVED` |
| **Relief** | `POST` | `/api/relief/dispatch` | **ACID Transaction:** Deduct warehouse stock & record audit log linked to SOS |
| **Relief** | `GET` | `/api/relief/inventory` | View current warehouse stock quantities |
| **Relief** | `POST` | `/api/relief/donations` | Pledge crowdsourced relief aid (Donor portal) |
| **Relief** | `GET` | `/api/relief/donations` | View public relief contributions list |
| **Relief** | `PATCH` | `/api/relief/donations/:id/approve` | **Admin:** Approve donation & atomically increment inventory |
| **Alerts** | `GET` | `/api/alerts` | Get automated earthquake and disaster warnings |
| **Alerts** | `POST` | `/api/alerts/sync` | Manually sync live USGS and flood feeds |

---

## 🧪 Comprehensive Evaluation Scenarios

| Test Case | How to Test | Expected Behavior |
|---|---|---|
| **1. Nearest Volunteer Radar (Spatial GIS)** | In the Radar view, click on **"Rafiqul Islam (CRITICAL)"**. | The Leaflet map smoothly pans to the Sylhet flood zone with a 5km perimeter. Below, MySQL calculates distances using `ST_Distance_Sphere`: **Tanvir Ahmed (73.26m)**. |
| **2. Evacuation Shelter Spatial Routing** | In the Radar view, switch sub-tab to **"Safe Evacuation Shelter"** or open the **"Shelters"** tab. | Displays closest shelters (e.g., Sylhet Govt. Pilot High School Shelter), calculates remaining beds, and draws trajectory line. |
| **3. Volunteer Assignment & Auto Trigger** | Click **"Assign"** next to a volunteer. | Volunteer status updates to `BUSY`, and database trigger `trg_auto_update_sos_on_volunteer_assign` automatically updates SOS status from `PENDING` to `ASSIGNED`. |
| **4. ACID Relief Dispatch (Zero Deficit)** | Click **"Dispatch Aid"** on the top right. Select an SOS incident, team, and item. | Executes pessimistic locking (`SELECT ... FOR UPDATE`), decrements inventory, and records entry in `relief_dispatches` linked to the SOS. If requested quantity exceeds stock, automatic rollback occurs. |
| **5. Donor Contribution & Inventory Auto-Restock** | Click **"Pledge Donation"**, submit 50 water cans, then in Logistics click **"Approve & Increment Stock"**. | Automatically approves the donation and executes trigger/transaction to increment warehouse inventory. |
| **6. Mission Completion & Volunteer Release** | In the **Fleet** tab, find a volunteer on an active mission and click **"Mark Rescue Completed (RESOLVED)"**. | Marks SOS as `RESOLVED`, sets `resolved_at = NOW()`, sets volunteer back to `AVAILABLE`, and clears assigned mission. |
| **7. Direct Stored Procedure Test** | In phpMyAdmin SQL tab, execute: `CALL sp_find_nearest_volunteers(1, 5000);` | Directly invokes the database stored procedure and outputs the spatial calculation results table. |
