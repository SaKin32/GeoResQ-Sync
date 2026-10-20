const { pool } = require('../config/db');

/**
 * 1. Dispatch Relief Goods inside an ACID MySQL Transaction (Linked to SOS)
 * Atomically checks stock, deducts inventory, and records dispatch log.
 * POST /api/relief/dispatch
 * Body: { rescue_team_id: 1, item_id: 2, quantity: 10, sos_id: 1 }
 */
const dispatchReliefGoods = async (req, res) => {
  const { rescue_team_id, item_id, quantity, items, sos_id, sos_request_id } = req.body;
  const linkedSosId = sos_id || sos_request_id || null;

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

    // 2. If SOS ID provided, verify SOS exists
    if (linkedSosId) {
      const [sosRows] = await connection.execute(
        'SELECT id, status FROM sos_requests WHERE id = ?',
        [linkedSosId]
      );
      if (sosRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `SOS Request with ID #${linkedSosId} does not exist.`
        });
      }
    }

    const dispatchResults = [];

    // 3. Process each relief item atomically
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

      // Record dispatch audit log (Linked to SOS)
      const [dispatchResult] = await connection.execute(
        `INSERT INTO relief_dispatches 
           (rescue_team_id, item_id, sos_request_id, quantity, dispatch_time) 
         VALUES (?, ?, ?, ?, NOW())`,
        [rescue_team_id, targetItemId, linkedSosId, deductQty]
      );

      dispatchResults.push({
        dispatch_id: dispatchResult.insertId,
        item_id: targetItemId,
        item_name: itemName,
        sos_request_id: linkedSosId,
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
      sos_request_id: linkedSosId,
      items_dispatched: dispatchResults
    });

  } catch (error) {
    await connection.rollback();
    console.error('Relief dispatch transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process relief dispatch. Database transaction was rolled back safely.',
      error: error.message
    });
  } finally {
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
      `SELECT id, item_name, category, unit, quantity, warehouse_name, updated_at 
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
 * 3. Add or Restock Inventory Items (Admin)
 * POST /api/relief/inventory
 */
const restockInventory = async (req, res) => {
  try {
    const { item_name, quantity, warehouse_name, category = 'General Aid', unit = 'units' } = req.body;

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
      `INSERT INTO relief_inventory (item_name, category, unit, quantity, warehouse_name) 
       VALUES (?, ?, ?, ?, ?)`,
      [item_name, category, unit, qty, warehouse_name]
    );

    return res.status(201).json({
      success: true,
      message: `Relief item "${item_name}" added to inventory.`,
      item_id: result.insertId,
      item_name,
      category,
      unit,
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
 * 4. Get Relief Dispatch Audit Trail (Linked to SOS)
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
        i.unit,
        i.warehouse_name,
        v.id AS volunteer_id,
        u.name AS volunteer_name,
        u.phone AS volunteer_phone,
        d.sos_request_id,
        s.urgency_level AS sos_urgency,
        u_victim.name AS victim_name
      FROM relief_dispatches d
      JOIN relief_inventory i ON d.item_id = i.id
      JOIN volunteers v ON d.rescue_team_id = v.id
      JOIN users u ON v.user_id = u.id
      LEFT JOIN sos_requests s ON d.sos_request_id = s.id
      LEFT JOIN users u_victim ON s.user_id = u_victim.id
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

/**
 * 5. Submit Relief Donation (Donors)
 * POST /api/relief/donations
 */
const createDonation = async (req, res) => {
  try {
    const donorId = req.user ? req.user.id : (req.body.donor_id || 7);
    const { item_id, quantity, notes } = req.body;

    if (!item_id || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'item_id and quantity are required.'
      });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than zero.' });
    }

    // Verify item exists
    const [itemRows] = await pool.execute('SELECT id, item_name FROM relief_inventory WHERE id = ?', [item_id]);
    if (itemRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Relief item not found.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO relief_donations (donor_id, item_id, quantity, notes, status, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', NOW())`,
      [donorId, item_id, qty, notes || null]
    );

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your relief donation pledge has been submitted for central warehouse approval.',
      donation_id: result.insertId,
      item_name: itemRows[0].item_name,
      quantity: qty,
      status: 'PENDING'
    });
  } catch (error) {
    console.error('Donation error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Get All Donations (Donor & Admin)
 * GET /api/relief/donations
 */
const getDonations = async (req, res) => {
  try {
    const query = `
      SELECT 
        d.id,
        d.donor_id,
        u.name AS donor_name,
        u.email AS donor_email,
        d.item_id,
        i.item_name,
        i.unit,
        i.warehouse_name,
        d.quantity,
        d.notes,
        d.status,
        d.created_at
      FROM relief_donations d
      JOIN users u ON d.donor_id = u.id
      JOIN relief_inventory i ON d.item_id = i.id
      ORDER BY d.created_at DESC;
    `;

    const [rows] = await pool.execute(query);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Approve Donation & Increment Inventory Stock (Admin only)
 * PATCH /api/relief/donations/:id/approve
 */
const approveDonation = async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [donations] = await connection.execute(
      'SELECT id, item_id, quantity, status FROM relief_donations WHERE id = ? FOR UPDATE',
      [id]
    );

    if (donations.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Donation record not found.' });
    }

    const donation = donations[0];
    if (donation.status === 'APPROVED') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Donation is already approved.' });
    }

    // 1. Update donation status
    await connection.execute(
      'UPDATE relief_donations SET status = "APPROVED" WHERE id = ?',
      [id]
    );

    // 2. Increment stock in relief_inventory
    await connection.execute(
      'UPDATE relief_inventory SET quantity = quantity + ? WHERE id = ?',
      [donation.quantity, donation.item_id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Donation #${id} approved! ${donation.quantity} units added to warehouse inventory stock.`,
      donation_id: Number(id),
      status: 'APPROVED'
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

module.exports = {
  dispatchReliefGoods,
  getReliefInventory,
  restockInventory,
  getDispatchHistory,
  createDonation,
  getDonations,
  approveDonation
};
