const { pool } = require('./config/db');

async function applyAdvancedSql() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Connected to MySQL. Setting up database structures...');

    // 1. Verify or Alter users table
    console.log('1. Checking users table columns...');
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email`);
    } catch {
      // Column may already exist
    }

    // 2. Create evacuation_shelters table if not exists
    console.log('2. Creating evacuation_shelters table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS evacuation_shelters (
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
    `);

    // 3. Alter volunteers table if needed
    console.log('3. Updating volunteers table...');
    try {
      await connection.query(`ALTER TABLE volunteers ADD COLUMN skills VARCHAR(255) DEFAULT 'First Aid, Swimming'`);
    } catch {}
    try {
      await connection.query(`ALTER TABLE volunteers ADD COLUMN vehicle_type VARCHAR(100) DEFAULT 'Rescue Inflatable Dinghy'`);
    } catch {}
    try {
      await connection.query(`ALTER TABLE volunteers ADD COLUMN blood_group VARCHAR(10) DEFAULT 'O+'`);
    } catch {}

    // 4. Alter relief_dispatches table if needed
    console.log('4. Updating relief_dispatches table...');
    try {
      await connection.query(`ALTER TABLE relief_dispatches ADD COLUMN sos_request_id INT NULL AFTER item_id`);
      await connection.query(`ALTER TABLE relief_dispatches ADD CONSTRAINT fk_dispatch_sos FOREIGN KEY (sos_request_id) REFERENCES sos_requests(id) ON DELETE SET NULL`);
    } catch {}

    // 5. Create relief_donations table
    console.log('5. Creating relief_donations table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS relief_donations (
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
    `);

    // 6. Create Database Views
    console.log('6. Creating Database Views...');
    await connection.query(`
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
    `);

    await connection.query(`
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
    `);

    await connection.query(`
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
    `);

    // 7. Create Stored Procedures
    console.log('7. Creating Stored Procedures...');
    await connection.query(`DROP PROCEDURE IF EXISTS sp_find_nearest_volunteers`);
    await connection.query(`
      CREATE PROCEDURE sp_find_nearest_volunteers(
          IN p_sos_id INT,
          IN p_max_distance_meters INT
      )
      BEGIN
          DECLARE target_location POINT;

          SELECT location INTO target_location
          FROM sos_requests
          WHERE id = p_sos_id;

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
      END
    `);

    await connection.query(`DROP PROCEDURE IF EXISTS sp_find_nearest_shelters`);
    await connection.query(`
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
      END
    `);

    await connection.query(`DROP PROCEDURE IF EXISTS sp_dispatch_relief_acid`);
    await connection.query(`
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
          
          DECLARE EXIT HANDLER FOR SQLEXCEPTION
          BEGIN
              ROLLBACK;
              SET p_status_code = 500;
              SET p_status_message = 'Database exception during relief dispatch. Transaction rolled back.';
          END;

          START TRANSACTION;

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
              UPDATE relief_inventory
              SET quantity = quantity - p_quantity
              WHERE id = p_item_id AND quantity >= p_quantity;

              INSERT INTO relief_dispatches (rescue_team_id, item_id, sos_request_id, quantity, dispatch_time)
              VALUES (p_rescue_team_id, p_item_id, p_sos_id, p_quantity, NOW());

              COMMIT;
              SET p_status_code = 200;
              SET p_status_message = 'Relief goods successfully dispatched with full ACID compliance.';
          END IF;
      END
    `);

    // 8. Create Triggers
    console.log('8. Creating Triggers...');
    await connection.query(`DROP TRIGGER IF EXISTS trg_auto_update_sos_on_volunteer_assign`);
    await connection.query(`
      CREATE TRIGGER trg_auto_update_sos_on_volunteer_assign
      AFTER UPDATE ON volunteers
      FOR EACH ROW
      BEGIN
          IF NEW.assigned_rescue_id IS NOT NULL AND (OLD.assigned_rescue_id IS NULL OR OLD.assigned_rescue_id != NEW.assigned_rescue_id) THEN
              UPDATE sos_requests
              SET status = 'ASSIGNED'
              WHERE id = NEW.assigned_rescue_id AND status = 'PENDING';
          END IF;
      END
    `);

    await connection.query(`DROP TRIGGER IF EXISTS trg_increase_inventory_on_donation_approved`);
    await connection.query(`
      CREATE TRIGGER trg_increase_inventory_on_donation_approved
      AFTER UPDATE ON relief_donations
      FOR EACH ROW
      BEGIN
          IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
              UPDATE relief_inventory
              SET quantity = quantity + NEW.quantity
              WHERE id = NEW.item_id;
          END IF;
      END
    `);

    // 9. Insert default seed data if shelters table is empty
    const [shelterCount] = await connection.query('SELECT COUNT(*) AS total FROM evacuation_shelters');
    if (shelterCount[0].total === 0) {
      console.log('9. Seeding initial shelters...');
      await connection.query(`
        INSERT INTO evacuation_shelters (id, name, latitude, longitude, location, capacity, current_occupancy, contact_person, contact_phone, has_medical_facility, status) VALUES
        (1, 'Sylhet Govt. Pilot High School Shelter', 24.89650000, 91.86980000, POINT(91.86980000, 24.89650000), 500, 180, 'Md. Anwarul Karim', '+8801711122334', TRUE, 'OPEN'),
        (2, 'Amberkhana Girls College Safe Zone', 24.90800000, 91.87100000, POINT(91.87100000, 24.90800000), 350, 310, 'Begum Rokeya Khatun', '+8801811122335', TRUE, 'OPEN'),
        (3, 'Shahjalal University Central Auditorium Shelter', 24.91720000, 91.83190000, POINT(91.83190000, 24.91720000), 1200, 450, 'Prof. Dr. M. Rahman', '+8801911122336', TRUE, 'OPEN'),
        (4, 'Surma Riverside Community Center (At Capacity)', 24.88700000, 91.86400000, POINT(91.86400000, 24.88700000), 200, 200, 'Zakir Hossain', '+8801611122337', FALSE, 'FULL');
      `);
    }

    console.log('✅ ALL DATABASE OBJECTS & ADVANCED SQL FEATURES CREATED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Error executing advanced SQL setup:', err.message);
  } finally {
    if (connection) connection.release();
    process.exit();
  }
}

applyAdvancedSql();
