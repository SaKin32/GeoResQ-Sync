-- =========================================================================
-- Disaster Alert & Local Crowdsourced Rescue Coordinator
-- Database Schema for MySQL 8.0+ (Spatial POINT & ACID Transactions)
-- Features: Tables, Spatial Indexes, Views, Stored Procedures, Triggers
-- =========================================================================

CREATE DATABASE IF NOT EXISTS disaster_rescue_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE disaster_rescue_db;

-- -------------------------------------------------------------------------
-- 1. Table: users (User & Role Management)
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS relief_dispatches;
DROP TABLE IF EXISTS volunteers;
DROP TABLE IF EXISTS sos_requests;
DROP TABLE IF EXISTS relief_inventory;
DROP TABLE IF EXISTS disaster_alerts;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL,
    role ENUM('VICTIM', 'VOLUNTEER', 'DONOR', 'ADMIN') NOT NULL DEFAULT 'VICTIM',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 2. Table: sos_requests (Emergency Requests with GPS Coordinates & Spatial POINT)
-- -------------------------------------------------------------------------
CREATE TABLE sos_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    location POINT NOT NULL,
    urgency_level ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    status ENUM('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'PENDING',
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    SPATIAL INDEX idx_sos_location (location)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 3. Table: volunteers (Volunteer Fleet & Live GPS Location)
-- -------------------------------------------------------------------------
CREATE TABLE volunteers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    status ENUM('AVAILABLE', 'BUSY', 'OFFLINE') NOT NULL DEFAULT 'AVAILABLE',
    current_location POINT NOT NULL,
    assigned_rescue_id INT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_rescue_id) REFERENCES sos_requests(id) ON DELETE SET NULL,
    SPATIAL INDEX idx_volunteer_location (current_location)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 4. Table: relief_inventory (Relief Goods & Warehouse Stock)
-- -------------------------------------------------------------------------
CREATE TABLE relief_inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    warehouse_name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_positive_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 5. Table: relief_dispatches (Audit log for distributed aid)
-- -------------------------------------------------------------------------
CREATE TABLE relief_dispatches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rescue_team_id INT NOT NULL,
    item_id INT NOT NULL,
    quantity INT NOT NULL,
    dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rescue_team_id) REFERENCES volunteers(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES relief_inventory(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 6. Table: disaster_alerts (Automated Weather / Earthquake Alerts)
-- -------------------------------------------------------------------------
CREATE TABLE disaster_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_api VARCHAR(100) NOT NULL,
    alert_title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(50) NOT NULL,
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =========================================================================
-- DATABASE VIEWS (Virtual Tables for Monitoring & Analytics)
-- =========================================================================

-- View 1: Active Rescue Missions Overview
CREATE OR REPLACE VIEW vw_active_rescue_missions AS
SELECT 
    s.id AS sos_id,
    s.urgency_level,
    s.status AS rescue_status,
    u_victim.name AS victim_name,
    u_victim.phone AS victim_phone,
    s.latitude AS victim_latitude,
    s.longitude AS victim_longitude,
    s.details AS emergency_details,
    s.created_at AS reported_at,
    v.id AS assigned_volunteer_id,
    u_vol.name AS volunteer_name,
    u_vol.phone AS volunteer_phone
FROM sos_requests s
JOIN users u_victim ON s.user_id = u_victim.id
LEFT JOIN volunteers v ON v.assigned_rescue_id = s.id
LEFT JOIN users u_vol ON v.user_id = u_vol.id
WHERE s.status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS');

-- View 2: Relief Inventory Stock & Health Analysis
CREATE OR REPLACE VIEW vw_relief_inventory_status AS
SELECT 
    r.id AS item_id,
    r.item_name,
    r.warehouse_name,
    r.quantity AS current_stock,
    COALESCE(SUM(d.quantity), 0) AS total_dispatched_units,
    CASE 
        WHEN r.quantity = 0 THEN 'OUT OF STOCK'
        WHEN r.quantity < 50 THEN 'CRITICAL LOW'
        WHEN r.quantity < 200 THEN 'MODERATE'
        ELSE 'SUFFICIENT'
    END AS stock_health_status,
    r.updated_at AS last_inventory_update
FROM relief_inventory r
LEFT JOIN relief_dispatches d ON r.id = d.item_id
GROUP BY r.id, r.item_name, r.warehouse_name, r.quantity, r.updated_at;

-- =========================================================================
-- STORED PROCEDURES (Encapsulated Business Logic in Database)
-- =========================================================================

-- Procedure 1: Find Nearest Volunteers within radius using ST_Distance_Sphere
DROP PROCEDURE IF EXISTS sp_find_nearest_volunteers;

DELIMITER $$
CREATE PROCEDURE sp_find_nearest_volunteers(
    IN p_sos_id INT,
    IN p_max_distance_meters INT
)
BEGIN
    DECLARE target_location POINT;

    -- Retrieve Victim Location
    SELECT location INTO target_location
    FROM sos_requests
    WHERE id = p_sos_id;

    -- Geospatial Distance Calculation in meters
    SELECT 
        v.id AS volunteer_id,
        u.name AS volunteer_name,
        u.phone AS volunteer_phone,
        v.status AS current_status,
        ST_X(v.current_location) AS longitude,
        ST_Y(v.current_location) AS latitude,
        ROUND(ST_Distance_Sphere(v.current_location, target_location), 2) AS distance_meters,
        ROUND(ST_Distance_Sphere(v.current_location, target_location) / 1000, 2) AS distance_km
    FROM volunteers v
    JOIN users u ON v.user_id = u.id
    WHERE v.status = 'AVAILABLE'
      AND ST_Distance_Sphere(v.current_location, target_location) <= p_max_distance_meters
    ORDER BY distance_meters ASC
    LIMIT 25;
END $$
DELIMITER ;

-- Procedure 2: ACID Relief Goods Dispatch with Row Locking & Rollback
DROP PROCEDURE IF EXISTS sp_dispatch_relief_acid;

DELIMITER $$
CREATE PROCEDURE sp_dispatch_relief_acid(
    IN p_rescue_team_id INT,
    IN p_item_id INT,
    IN p_quantity INT,
    OUT p_status_code INT,
    OUT p_status_message VARCHAR(255)
)
BEGIN
    DECLARE v_available_stock INT DEFAULT 0;
    
    -- Error Handler for Automatic Rollback
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_status_code = 500;
        SET p_status_message = 'Database exception during relief dispatch. Transaction rolled back.';
    END;

    START TRANSACTION;

    -- Lock row for concurrency safety (Pessimistic Locking)
    SELECT quantity INTO v_available_stock
    FROM relief_inventory
    WHERE id = p_item_id
    FOR UPDATE;

    IF v_available_stock IS NULL THEN
        ROLLBACK;
        SET p_status_code = 404;
        SET p_status_message = 'Relief item not found in warehouse.';
    ELSEIF v_available_stock < p_quantity THEN
        ROLLBACK;
        SET p_status_code = 400;
        SET p_status_message = CONCAT('Insufficient stock. Available: ', v_available_stock, ', Requested: ', p_quantity);
    ELSE
        -- Atomic Stock Deduction
        UPDATE relief_inventory
        SET quantity = quantity - p_quantity
        WHERE id = p_item_id AND quantity >= p_quantity;

        -- Record Dispatch Audit Log
        INSERT INTO relief_dispatches (rescue_team_id, item_id, quantity, dispatch_time)
        VALUES (p_rescue_team_id, p_item_id, p_quantity, NOW());

        COMMIT;
        SET p_status_code = 200;
        SET p_status_message = 'Relief goods successfully dispatched with full ACID compliance.';
    END IF;
END $$
DELIMITER ;

-- =========================================================================
-- DATABASE TRIGGER (Automated Referential Event Handling)
-- =========================================================================

-- Trigger 1: Auto-update SOS status to ASSIGNED when volunteer is assigned
DROP TRIGGER IF EXISTS trg_auto_update_sos_on_volunteer_assign;

DELIMITER $$
CREATE TRIGGER trg_auto_update_sos_on_volunteer_assign
AFTER UPDATE ON volunteers
FOR EACH ROW
BEGIN
    IF NEW.assigned_rescue_id IS NOT NULL AND (OLD.assigned_rescue_id IS NULL OR OLD.assigned_rescue_id != NEW.assigned_rescue_id) THEN
        UPDATE sos_requests
        SET status = 'ASSIGNED'
        WHERE id = NEW.assigned_rescue_id AND status = 'PENDING';
    END IF;
END $$
DELIMITER ;

-- =========================================================================
-- SEED DATA (Realistic Mock Data for Testing)
-- Locations around Sylhet Sadar flood zone (24.8949 N, 91.8687 E)
-- Note: MySQL POINT(x, y) coordinates: X = longitude, Y = latitude
-- =========================================================================

-- 1. Insert Users
INSERT INTO users (id, name, email, phone, role) VALUES
(1, 'Rafiqul Islam', 'rafiq@example.com', '+8801711000001', 'VICTIM'),
(2, 'Fatima Begum', 'fatima@example.com', '+8801711000002', 'VICTIM'),
(3, 'Tanvir Ahmed', 'tanvir@rescue.org', '+8801811000003', 'VOLUNTEER'),
(4, 'Nusrat Jahan', 'nusrat@rescue.org', '+8801811000004', 'VOLUNTEER'),
(5, 'Sabbir Hossain', 'sabbir@rescue.org', '+8801811000005', 'VOLUNTEER'),
(6, 'Central Disaster Admin', 'admin@disaster.gov.bd', '+8801911000006', 'ADMIN');

-- 2. Insert Volunteers (Coordinates around Sylhet Sadar: 24.8949 N, 91.8687 E)
INSERT INTO volunteers (id, user_id, status, current_location, assigned_rescue_id) VALUES
(1, 3, 'AVAILABLE', POINT(91.8690, 24.8955), NULL),   -- ~150 meters away
(2, 4, 'AVAILABLE', POINT(91.8820, 24.9010), NULL),   -- ~1.5 km away
(3, 5, 'BUSY',      POINT(91.8500, 24.8700), NULL);   -- ~3.5 km away (Busy)

-- 3. Insert Initial SOS Requests
INSERT INTO sos_requests (id, user_id, latitude, longitude, location, urgency_level, status, details) VALUES
(1, 1, 24.89490000, 91.86870000, POINT(91.86870000, 24.89490000), 'CRITICAL', 'PENDING', 'Flash flood water reached roof level. 5 family members including an infant trapped.');

-- 4. Insert Relief Inventory
INSERT INTO relief_inventory (id, item_name, quantity, warehouse_name) VALUES
(1, 'Emergency Dry Food Packet (Per Family)', 250, 'Sylhet Central Warehouse'),
(2, 'Drinking Water 5-Liter Can', 400, 'Sylhet Central Warehouse'),
(3, 'Water Purification Tablets (Strip of 50)', 1500, 'Zilla Parishad Depot'),
(4, 'First Aid & Antiseptic Kit', 80, 'Sylhet Central Warehouse'),
(5, 'Life Jacket & Safety Vest', 45, 'Red Crescent Rescue Hub');

-- 5. Insert Sample Disaster Alerts
INSERT INTO disaster_alerts (id, source_api, alert_title, description, severity, event_time) VALUES
(1, 'Flood Forecasting & Warning Centre', 'Severe Flash Flood Warning in Surma River Basin', 'Surma river water level is currently 85cm above the danger mark. Evacuation urged.', 'HIGH', NOW()),
(2, 'USGS Earthquake API', 'Earthquake M4.8 - Sylhet-Assam Border Region', 'Magnitude 4.8 seismic activity detected at depth 10km. Minor tremors felt.', 'MEDIUM', NOW());
