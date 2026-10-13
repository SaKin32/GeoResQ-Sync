const { pool } = require('./config/db');

async function applyAdvancedSql() {
  const connection = await pool.getConnection();
  try {
    console.log('1. Creating Views...');
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
          u_vol.phone AS volunteer_phone
      FROM sos_requests s
      JOIN users u_victim ON s.user_id = u_victim.id
      LEFT JOIN volunteers v ON v.assigned_rescue_id = s.id
      LEFT JOIN users u_vol ON v.user_id = u_vol.id
      WHERE s.status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')
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
      GROUP BY r.id, r.item_name, r.warehouse_name, r.quantity, r.updated_at
    `);

    console.log('2. Creating Stored Procedures...');
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

    await connection.query(`DROP PROCEDURE IF EXISTS sp_dispatch_relief_acid`);
    await connection.query(`
      CREATE PROCEDURE sp_dispatch_relief_acid(
          IN p_rescue_team_id INT,
          IN p_item_id INT,
          IN p_quantity INT,
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

              INSERT INTO relief_dispatches (rescue_team_id, item_id, quantity, dispatch_time)
              VALUES (p_rescue_team_id, p_item_id, p_quantity, NOW());

              COMMIT;
              SET p_status_code = 200;
              SET p_status_message = 'Relief goods successfully dispatched with full ACID compliance.';
          END IF;
      END
    `);

    console.log('3. Creating Triggers...');
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

    console.log('✅ SUCCESS! All Views, Stored Procedures, and Triggers created in MySQL database.');
  } catch (err) {
    console.error('❌ Error executing advanced SQL setup:', err);
  } finally {
    connection.release();
    process.exit();
  }
}

applyAdvancedSql();
