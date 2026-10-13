const { pool } = require('../config/db');

/**
 * 1. Dispatch Relief Goods inside an ACID MySQL Transaction
 * Atomically checks stock, deducts inventory, and records dispatch log.
 * POST /api/relief/dispatch
 * Body: { rescue_team_id: 1, item_id: 2, quantity: 10 }
 * Or batch: { rescue_team_id: 1, items: [{ item_id: 1, quantity: 10 }, { item_id: 2, quantity: 20 }] }
 */
const dispatchReliefGoods = async (req, res) => {
  const { rescue_team_id, item_id, quantity, items } = req.body;

  if (!rescue_team_id) {
    return res.status(400).json({
      success: false,
      message: 'rescue_team_id (volunteer ID) is required.'
    });
  }

  // Normalize single item or batch items
  let dispatchList = [];
  if (Array.isArray(items) && items.length > 0) {
    dispatchList = items;
  } else if (item_id && quantity) {
    dispatchList = [{ item_id: parseInt(item_id, 10), quantity: parseInt(quantity, 10) }];
  } else {
    return res.status(400).json({
      success: false,
      message: 'Please provide either item_id & quantity, or an items array.'
    });
  }

  // Obtain dedicated connection from pool for transaction isolation
  const connection = await pool.getConnection();

  try {
    // -----------------------------------------------------------------------
    // START ACID TRANSACTION
    // -----------------------------------------------------------------------
    await connection.beginTransaction();

    // 1. Verify rescue team / volunteer exists
    const [teamRows] = await connection.execute(
      'SELECT id, user_id, status FROM volunteers WHERE id = ? FOR UPDATE',
      [rescue_team_id]
    );

    if (teamRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: `Rescue team / Volunteer with ID ${rescue_team_id} does not exist.`
      });
    }

    const dispatchResults = [];

    // 2. Process each relief item atomically
    for (const item of dispatchList) {
      const targetItemId = parseInt(item.item_id, 10);
      const deductQty = parseInt(item.quantity, 10);

      if (!targetItemId || !deductQty || deductQty <= 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Invalid item_id (${targetItemId}) or non-positive quantity (${deductQty}).`
        });
      }

      // Lock row to prevent race conditions (Pessimistic Locking)
      const [stockRows] = await connection.execute(
        'SELECT id, item_name, quantity, warehouse_name FROM relief_inventory WHERE id = ? FOR UPDATE',
        [targetItemId]
      );

      if (stockRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Relief item ID #${targetItemId} not found in inventory.`
        });
      }

      const currentStock = stockRows[0].quantity;
      const itemName = stockRows[0].item_name;
      const warehouse = stockRows[0].warehouse_name;

      // ACID Verification: check sufficient stock
      if (currentStock < deductQty) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Stock deficit for "${itemName}" (ID: ${targetItemId}). Requested: ${deductQty}, Available: ${currentStock} at ${warehouse}. Transaction aborted.`
        });
      }

      // Deduct stock in relief_inventory
      const [updateResult] = await connection.execute(
        `UPDATE relief_inventory 
         SET quantity = quantity - ? 
         WHERE id = ? AND quantity >= ?`,
        [deductQty, targetItemId, deductQty]
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: `Concurrency conflict while updating stock for item ID #${targetItemId}. Transaction rolled back.`
        });
      }

      // Record dispatch audit log
      const [dispatchResult] = await connection.execute(
        `INSERT INTO relief_dispatches 
           (rescue_team_id, item_id, quantity, dispatch_time) 
         VALUES (?, ?, ?, NOW())`,
        [rescue_team_id, targetItemId, deductQty]
      );

      dispatchResults.push({
        dispatch_id: dispatchResult.insertId,
        item_id: targetItemId,
        item_name: itemName,
        dispatched_quantity: deductQty,
        remaining_quantity: currentStock - deductQty,
        warehouse: warehouse
      });
    }

    // -----------------------------------------------------------------------
    // COMMIT TRANSACTION
    // -----------------------------------------------------------------------
    await connection.commit();

    return res.status(200).json({
      success: true,
      message: '📦 Relief inventory successfully dispatched with full ACID transaction integrity.',
      rescue_team_id: parseInt(rescue_team_id, 10),
      items_dispatched: dispatchResults
    });

  } catch (error) {
    // -----------------------------------------------------------------------
    // ROLLBACK ON ERROR
    // -----------------------------------------------------------------------
    await connection.rollback();
    console.error('Relief dispatch transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process relief dispatch. Database transaction was rolled back safely.',
      error: error.message
    });
  } finally {
    // Always release connection back to pool
    connection.release();
  }
};

/**
 * 2. Get All Relief Inventory Stock
 * GET /api/relief/inventory
 */
const getReliefInventory = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, item_name, quantity, warehouse_name, updated_at 
       FROM relief_inventory 
       ORDER BY quantity ASC`
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch relief inventory.',
      error: error.message
    });
  }
};

/**
 * 3. Add or Restock Inventory Items
 * POST /api/relief/inventory
 */
const restockInventory = async (req, res) => {
  try {
    const { item_name, quantity, warehouse_name } = req.body;

    if (!item_name || quantity === undefined || !warehouse_name) {
      return res.status(400).json({
        success: false,
        message: 'item_name, quantity, and warehouse_name are required.'
      });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 0) {
      return res.status(400).json({
        success: false,
        message: 'quantity must be a non-negative number.'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO relief_inventory (item_name, quantity, warehouse_name) 
       VALUES (?, ?, ?)`,
      [item_name, qty, warehouse_name]
    );

    return res.status(201).json({
      success: true,
      message: `Relief item "${item_name}" added to inventory.`,
      item_id: result.insertId,
      item_name,
      quantity: qty,
      warehouse_name
    });
  } catch (error) {
    console.error('Error restocking inventory:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restock inventory.',
      error: error.message
    });
  }
};

/**
 * 4. Get Relief Dispatch Audit Trail
 * GET /api/relief/dispatches
 */
const getDispatchHistory = async (req, res) => {
  try {
    const query = `
      SELECT 
        d.id AS dispatch_id,
        d.dispatch_time,
        d.quantity AS dispatched_qty,
        i.item_name,
        i.warehouse_name,
        v.id AS volunteer_id,
        u.name AS volunteer_name,
        u.phone AS volunteer_phone
      FROM relief_dispatches d
      JOIN relief_inventory i ON d.item_id = i.id
      JOIN volunteers v ON d.rescue_team_id = v.id
      JOIN users u ON v.user_id = u.id
      ORDER BY d.dispatch_time DESC
      LIMIT 50;
    `;

    const [rows] = await pool.execute(query);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching dispatch history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dispatch logs.',
      error: error.message
    });
  }
};

module.exports = {
  dispatchReliefGoods,
  getReliefInventory,
  restockInventory,
  getDispatchHistory
};
