# Disaster Alert & Local Crowdsourced Rescue Coordinator
## Disaster Alert & Crowdsourced Rescue Coordinator - Backend API

A complete, production-ready Node.js, Express, and MySQL 8.0+ backend for real-time disaster management, featuring:
- **MySQL Spatial POINT Data Types** & `ST_Distance_Sphere` geospatial calculations for nearby volunteer discovery.
- **Strict ACID Transactions** with row-level locking (`FOR UPDATE`) for zero-deficit relief inventory management.
- **Automated Cron Jobs** fetching live seismic/disaster data from USGS Earthquake API.

---

## 📁 Project Structure

```
disaster-rescue-backend/
├── schema.sql                      # Complete MySQL 8.0+ Schema (DDL + Spatial Indexes + Seed Data)
├── package.json                    # Node.js dependencies
├── .env.example                    # Environment variable configuration template
├── README.md                       # Complete API documentation & SQL guide
└── src/
    ├── server.js                   # Application entry point & route loader
    ├── config/
    │   └── db.js                   # MySQL Connection Pool (mysql2/promise)
    ├── controllers/
    │   ├── sosController.js        # SOS creation, ST_Distance_Sphere query, volunteer assignment
    │   ├── reliefController.js     # ACID Transaction for relief dispatch & stock audit
    │   ├── volunteerController.js  # Live GPS location updates
    │   └── alertController.js      # Disaster warnings & external API handler
    ├── routes/
    │   ├── sosRoutes.js
    │   ├── reliefRoutes.js
    │   ├── volunteerRoutes.js
    │   └── alertRoutes.js
    └── services/
        └── cronService.js          # Cron job to pull external earthquake/weather data
```

---

## 🗄️ Database Setup (MySQL 8.0+)

1. Open your MySQL client (MySQL Workbench, phpMyAdmin, or terminal CLI).
2. Run the `schema.sql` script:
```bash
mysql -u root -p < schema.sql
```
This will:
- Create database `disaster_rescue_db`.
- Build the 6 core tables (`users`, `sos_requests`, `volunteers`, `relief_inventory`, `relief_dispatches`, `disaster_alerts`).
- Establish foreign keys and spatial indexes (`SPATIAL INDEX`).
- Populate realistic seed data for testing (Sylhet/Dhaka flood scenario coordinates).

---

## 🚀 Getting Started

1. Clone or navigate to the project directory:
```bash
cd disaster-rescue-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create your `.env` file from `.env.example`:
```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=disaster_rescue_db
DB_PORT=3306
CRON_SCHEDULE=*/30 * * * *
```

4. Start the server:
```bash
# Production mode
npm start

# Development mode (with live reload)
npm run dev
```

---

## 🔍 Core Business Logic & SQL Deep Dive

### 1. Geospatial Query (`ST_Distance_Sphere`)
In MySQL Spatial 8.0, coordinates stored in `POINT` columns default to `(X, Y)` where **X is Longitude** and **Y is Latitude**.

`ST_Distance_Sphere(v.current_location, POINT(target_lng, target_lat))` calculates the great-circle spherical distance over the surface of the earth in **meters**.

```sql
SELECT 
  v.id AS volunteer_id,
  u.name,
  u.phone,
  v.status,
  ST_X(v.current_location) AS longitude,
  ST_Y(v.current_location) AS latitude,
  ROUND(ST_Distance_Sphere(v.current_location, POINT(91.8687, 24.8949)), 2) AS distance_meters
FROM volunteers v
JOIN users u ON v.user_id = u.id
WHERE v.status = 'AVAILABLE'
  AND ST_Distance_Sphere(v.current_location, POINT(91.8687, 24.8949)) <= 5000
ORDER BY distance_meters ASC;
```

> **Why `ST_X` and `ST_Y`?**
> By default, selecting a `POINT` column returns a raw binary WKB (Well-Known Binary) Buffer in Node.js. Extracting `ST_X(location)` and `ST_Y(location)` ensures your JSON responses contain clean decimal floats ready for Leaflet.js!

---

### 2. ACID Transaction for Relief Distribution
When volunteers withdraw aid from emergency depots, race conditions can cause stock deficits. We enforce:
1. `connection.beginTransaction()`
2. Row-level pessimistic locking (`SELECT ... FOR UPDATE`)
3. Validation: `current_stock >= requested_qty`
4. Deduction: `UPDATE relief_inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?`
5. Audit log: `INSERT INTO relief_dispatches (...)`
6. `connection.commit()` (or `connection.rollback()` if any error occurs).

---

## 📡 API Reference & Testing (cURL Examples)

### 🚨 SOS Endpoints

#### 1. Create an SOS Request
```bash
curl -X POST http://localhost:5000/api/sos \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "latitude": 24.8949,
    "longitude": 91.8687,
    "urgency_level": "CRITICAL",
    "details": "Flash flood waters reached rooftop. 5 family members trapped."
  }'
```

#### 2. Find Nearest Available Volunteers within 5km (5000m)
```bash
# By SOS Request ID
curl -X GET "http://localhost:5000/api/sos/1/nearest-volunteers?radius=5000"

# Or directly by Latitude/Longitude
curl -X GET "http://localhost:5000/api/sos/nearby-volunteers?lat=24.8949&lng=91.8687&radius=5000"
```

#### 3. Assign a Volunteer to an SOS
```bash
curl -X POST http://localhost:5000/api/sos/1/assign \
  -H "Content-Type: application/json" \
  -d '{ "volunteer_id": 1 }'
```

#### 4. Update SOS Mission Status
```bash
curl -X PATCH http://localhost:5000/api/sos/1/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "RESOLVED" }'
```

---

### 📦 Relief Inventory Endpoints (ACID Transactions)

#### 1. Dispatch Relief Goods (Atomically Deducts & Logs)
```bash
curl -X POST http://localhost:5000/api/relief/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "rescue_team_id": 1,
    "item_id": 1,
    "quantity": 10
  }'
```

Or batch dispatch multiple items at once:
```bash
curl -X POST http://localhost:5000/api/relief/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "rescue_team_id": 1,
    "items": [
      { "item_id": 1, "quantity": 15 },
      { "item_id": 2, "quantity": 25 },
      { "item_id": 4, "quantity": 5 }
    ]
  }'
```

#### 2. View Real-time Inventory Stocks
```bash
curl -X GET http://localhost:5000/api/relief/inventory
```

#### 3. View Relief Dispatch History (Audit Log)
```bash
curl -X GET http://localhost:5000/api/relief/dispatches
```

---

### 📍 Volunteer & Alert Endpoints

#### 1. Update Volunteer Live Location
```bash
curl -X PUT http://localhost:5000/api/volunteers/1/location \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 24.8960,
    "longitude": 91.8700,
    "status": "AVAILABLE"
  }'
```

#### 2. Get Live Disaster Warnings
```bash
curl -X GET http://localhost:5000/api/alerts
```
# GeoResQ-Sync
