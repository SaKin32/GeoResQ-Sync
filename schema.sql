-- =========================================================================
-- Disaster Alert & Local Crowdsourced Rescue Coordinator (GeoResQ-Sync)
-- Database Schema for MySQL 8.0+ (Spatial POINT, GIS Indexes & ACID Transactions)
-- Features: User Roles, Shelters, Volunteers, SOS, Relief Inventory, Donations,
--           ACID Dispatches, Views, Stored Procedures, Triggers & Seed Data
-- =========================================================================

CREATE DATABASE IF NOT EXISTS disaster_rescue_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE disaster_rescue_db;

-- -------------------------------------------------------------------------
-- DROP TABLES IN PROPER CASCADE ORDER
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS relief_donations;
DROP TABLE IF EXISTS relief_dispatches;
DROP TABLE IF EXISTS volunteers;
DROP TABLE IF EXISTS sos_requests;
DROP TABLE IF EXISTS evacuation_shelters;
DROP TABLE IF EXISTS relief_inventory;
DROP TABLE IF EXISTS disaster_alerts;
DROP TABLE IF EXISTS users;

-- -------------------------------------------------------------------------
-- 1. Table: users (User & Role Management with Authentication)
-- -------------------------------------------------------------------------
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    phone VARCHAR(50) NOT NULL,
    role ENUM('VICTIM', 'VOLUNTEER', 'DONOR', 'ADMIN') NOT NULL DEFAULT 'VICTIM',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 2. Table: evacuation_shelters (Safe Zones with Spatial Point & Capacity Tracking)
-- -------------------------------------------------------------------------
CREATE TABLE evacuation_shelters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    location POINT NOT NULL,
    capacity INT NOT NULL DEFAULT 100,
    current_occupancy INT NOT NULL DEFAULT 0,
    contact_person VARCHAR(150),
    contact_phone VARCHAR(50),
    has_medical_facility BOOLEAN DEFAULT TRUE,
    status ENUM('OPEN', 'FULL', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SPATIAL INDEX idx_shelter_location (location),
    CONSTRAINT chk_occupancy CHECK (current_occupancy <= capacity AND current_occupancy >= 0)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 3. Table: sos_requests (Emergency Requests with GPS Coordinates & Spatial POINT)
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
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    SPATIAL INDEX idx_sos_location (location)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 4. Table: volunteers (Volunteer Fleet with Live GPS Location & Skills)
-- -------------------------------------------------------------------------
CREATE TABLE volunteers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    status ENUM('AVAILABLE', 'BUSY', 'OFFLINE') NOT NULL DEFAULT 'AVAILABLE',
    current_location POINT NOT NULL,
    assigned_rescue_id INT NULL,
    skills VARCHAR(255) DEFAULT 'First Aid, Swimming',
    vehicle_type VARCHAR(100) DEFAULT 'Speedboat / Rescue Dinghy',
    blood_group VARCHAR(10) DEFAULT 'O+',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_rescue_id) REFERENCES sos_requests(id) ON DELETE SET NULL,
    SPATIAL INDEX idx_volunteer_location (current_location)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 5. Table: relief_inventory (Relief Goods & Warehouse Stock)
-- -------------------------------------------------------------------------
CREATE TABLE relief_inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General Aid',
    unit VARCHAR(50) NOT NULL DEFAULT 'units',
    quantity INT NOT NULL DEFAULT 0,
    warehouse_name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_positive_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 6. Table: relief_dispatches (Audit log for distributed aid, linked to SOS)
-- -------------------------------------------------------------------------
CREATE TABLE relief_dispatches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rescue_team_id INT NOT NULL,
    item_id INT NOT NULL,
    sos_request_id INT NULL,
    quantity INT NOT NULL,
    dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rescue_team_id) REFERENCES volunteers(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES relief_inventory(id) ON DELETE RESTRICT,
    FOREIGN KEY (sos_request_id) REFERENCES sos_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 7. Table: relief_donations (Donor Contributions to Warehouse)
-- -------------------------------------------------------------------------
CREATE TABLE relief_donations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    donor_id INT NOT NULL,
    item_id INT NOT NULL,
    quantity INT NOT NULL,
    notes TEXT,
    status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES relief_inventory(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------
-- 8. Table: disaster_alerts (Automated Weather / Earthquake Alerts)
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
    u_vol.phone AS volunteer_phone,
    v.vehicle_type,
    v.skills
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
    r.category,
    r.unit,
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
GROUP BY r.id, r.item_name, r.category, r.unit, r.warehouse_name, r.quantity, r.updated_at;

-- View 3: Shelters Capacity Overview
CREATE OR REPLACE VIEW vw_shelters_overview AS
SELECT 
    id AS shelter_id,
    name AS shelter_name,
    capacity,
    current_occupancy,
    (capacity - current_occupancy) AS available_slots,
    ROUND((current_occupancy / capacity) * 100, 1) AS occupancy_percentage,
    has_medical_facility,
    status,
    contact_person,
    contact_phone
FROM evacuation_shelters;

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
        v.skills,
        v.vehicle_type,
        v.blood_group,
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

-- Procedure 2: Find Nearest Evacuation Shelters
DROP PROCEDURE IF EXISTS sp_find_nearest_shelters;

DELIMITER $$
CREATE PROCEDURE sp_find_nearest_shelters(
    IN p_latitude DECIMAL(10, 8),
    IN p_longitude DECIMAL(11, 8),
    IN p_max_distance_meters INT
)
BEGIN
    DECLARE origin_location POINT;
    SET origin_location = POINT(p_longitude, p_latitude);

    SELECT 
        s.id AS shelter_id,
        s.name AS shelter_name,
        s.latitude,
        s.longitude,
        s.capacity,
        s.current_occupancy,
        (s.capacity - s.current_occupancy) AS available_slots,
        s.has_medical_facility,
        s.status,
        s.contact_person,
        s.contact_phone,
        ROUND(ST_Distance_Sphere(s.location, origin_location), 2) AS distance_meters,
        ROUND(ST_Distance_Sphere(s.location, origin_location) / 1000, 2) AS distance_km
    FROM evacuation_shelters s
    WHERE s.status != 'CLOSED'
      AND ST_Distance_Sphere(s.location, origin_location) <= p_max_distance_meters
    ORDER BY distance_meters ASC
    LIMIT 20;
END $$
DELIMITER ;

-- Procedure 3: ACID Relief Goods Dispatch with Row Locking & Rollback
DROP PROCEDURE IF EXISTS sp_dispatch_relief_acid;

DELIMITER $$
CREATE PROCEDURE sp_dispatch_relief_acid(
    IN p_rescue_team_id INT,
    IN p_item_id INT,
    IN p_quantity INT,
    IN p_sos_id INT,
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

        -- Record Dispatch Audit Log (Linked to SOS)
        INSERT INTO relief_dispatches (rescue_team_id, item_id, sos_request_id, quantity, dispatch_time)
        VALUES (p_rescue_team_id, p_item_id, p_sos_id, p_quantity, NOW());

        COMMIT;
        SET p_status_code = 200;
        SET p_status_message = 'Relief goods successfully dispatched with full ACID compliance.';
    END IF;
END $$
DELIMITER ;

-- =========================================================================
-- DATABASE TRIGGERS (Automated Referential Event Handling)
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

-- Trigger 2: Auto-increase warehouse inventory when a donation is APPROVED
DROP TRIGGER IF EXISTS trg_increase_inventory_on_donation_approved;

DELIMITER $$
CREATE TRIGGER trg_increase_inventory_on_donation_approved
AFTER UPDATE ON relief_donations
FOR EACH ROW
BEGIN
    IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
        UPDATE relief_inventory
        SET quantity = quantity + NEW.quantity
        WHERE id = NEW.item_id;
    END IF;
END $$
DELIMITER ;

-- =========================================================================
-- SEED DATA (Realistic Mock Data for Testing)
-- Locations around Sylhet Sadar flood zone (24.8949 N, 91.8687 E)
-- Note: MySQL POINT(x, y) coordinates: X = longitude, Y = latitude
-- =========================================================================

-- 1. Insert Users (Default password for testing: 'password123' hashed with bcrypt: $2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK)
INSERT INTO users (id, name, email, password_hash, phone, role) VALUES
(1, 'Rafiqul Islam', 'rafiq@example.com', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801711000001', 'VICTIM'),
(2, 'Fatima Begum', 'fatima@example.com', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801711000002', 'VICTIM'),
(3, 'Tanvir Ahmed', 'tanvir@rescue.org', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801811000003', 'VOLUNTEER'),
(4, 'Nusrat Jahan', 'nusrat@rescue.org', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801811000004', 'VOLUNTEER'),
(5, 'Sabbir Hossain', 'sabbir@rescue.org', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801811000005', 'VOLUNTEER'),
(6, 'Central Disaster Admin', 'admin@disaster.gov.bd', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801911000006', 'ADMIN'),
(7, 'Shahidul Alam (Donor)', 'donor@humanitarian.org', '$2a$10$wTf7U7PZk8pA2v5M8I1xTe19k7nsuh0m9zVv87VlF9fXm71z7c8zK', '+8801712000007', 'DONOR');

-- 2. Insert Evacuation Shelters (Flood shelters around Sylhet zone)
INSERT INTO evacuation_shelters (id, name, latitude, longitude, location, capacity, current_occupancy, contact_person, contact_phone, has_medical_facility, status) VALUES
(1, 'Sylhet Govt. Pilot High School Shelter', 24.89650000, 91.86980000, POINT(91.86980000, 24.89650000), 500, 180, 'Md. Anwarul Karim', '+8801711122334', TRUE, 'OPEN'),
(2, 'Amberkhana Girls College Safe Zone', 24.90800000, 91.87100000, POINT(91.87100000, 24.90800000), 350, 310, 'Begum Rokeya Khatun', '+8801811122335', TRUE, 'OPEN'),
(3, 'Shahjalal University Central Auditorium Shelter', 24.91720000, 91.83190000, POINT(91.83190000, 24.91720000), 1200, 450, 'Prof. Dr. M. Rahman', '+8801911122336', TRUE, 'OPEN'),
(4, 'Surma Riverside Community Center (At Capacity)', 24.88700000, 91.86400000, POINT(91.86400000, 24.88700000), 200, 200, 'Zakir Hossain', '+8801611122337', FALSE, 'FULL');

-- 3. Insert Initial SOS Requests
INSERT INTO sos_requests (id, user_id, latitude, longitude, location, urgency_level, status, details) VALUES
(1, 1, 24.89490000, 91.86870000, POINT(91.86870000, 24.89490000), 'CRITICAL', 'PENDING', 'Flash flood water reached roof level. 5 family members including an infant trapped.'),
(2, 2, 24.90150000, 91.87950000, POINT(91.87950000, 24.90150000), 'HIGH', 'PENDING', 'Elderly diabetic patient requires immediate boat evacuation and insulin.');

-- 4. Insert Volunteers (Coordinates around Sylhet Sadar: 24.8949 N, 91.8687 E)
INSERT INTO volunteers (id, user_id, status, current_location, assigned_rescue_id, skills, vehicle_type, blood_group) VALUES
(1, 3, 'AVAILABLE', POINT(91.8690, 24.8955), NULL, 'Certified Diver, Paramedic First Aid', 'High-Speed Rescue Inflatable Boat', 'B+'),   -- ~150 meters away
(2, 4, 'AVAILABLE', POINT(91.8820, 24.9010), NULL, 'Search & Rescue, Medical Triage', '4WD Offroad Amphibious Truck', 'O+'),   -- ~1.5 km away
(3, 5, 'BUSY',      POINT(91.8500, 24.8700), NULL, 'Water Rescue, Drone Operator', 'Motorized Dinghy', 'A+');   -- ~3.5 km away (Busy)

-- 5. Insert Relief Inventory
INSERT INTO relief_inventory (id, item_name, category, unit, quantity, warehouse_name) VALUES
(1, 'Emergency Dry Food Packet (Per Family)', 'Food', 'Packets', 250, 'Sylhet Central Warehouse'),
(2, 'Drinking Water 5-Liter Can', 'Water', 'Cans', 400, 'Sylhet Central Warehouse'),
(3, 'Water Purification Tablets (Strip of 50)', 'Water', 'Strips', 1500, 'Zilla Parishad Depot'),
(4, 'First Aid & Antiseptic Kit', 'Medical', 'Kits', 80, 'Sylhet Central Warehouse'),
(5, 'Life Jacket & Safety Vest', 'Gear', 'Pieces', 45, 'Red Crescent Rescue Hub');

-- 6. Insert Relief Dispatches (Sample linked to SOS #1)
INSERT INTO relief_dispatches (id, rescue_team_id, item_id, sos_request_id, quantity, dispatch_time) VALUES
(1, 1, 1, 1, 5, NOW()),
(2, 1, 2, 1, 10, NOW());

-- 7. Insert Relief Donations
INSERT INTO relief_donations (id, donor_id, item_id, quantity, notes, status, created_at) VALUES
(1, 7, 2, 100, 'Donation from Sylhet Humanitarian Aid Society for flood relief.', 'APPROVED', NOW()),
(2, 7, 4, 30, 'Urgent medical aid kits for children and infants.', 'PENDING', NOW());

-- 8. Insert Sample Disaster Alerts
INSERT INTO disaster_alerts (id, source_api, alert_title, description, severity, event_time) VALUES
(1, 'Flood Forecasting & Warning Centre', 'Severe Flash Flood Warning in Surma River Basin', 'Surma river water level is currently 85cm above the danger mark. Evacuation urged.', 'HIGH', NOW()),
(2, 'USGS Earthquake API', 'Earthquake M4.8 - Sylhet-Assam Border Region', 'Magnitude 4.8 seismic activity detected at depth 10km. Minor tremors felt.', 'MEDIUM', NOW()),
(3, 'Bangladesh Meteorological Department', 'Heavy Monsoon Rainfall Alert (150mm+ Expected)', 'Continuous torrential downpour forecasted across Sylhet, Sunamganj, and Netrokona districts for next 48 hours.', 'CRITICAL', NOW());
