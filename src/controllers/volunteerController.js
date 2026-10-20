const { pool } = require('../config/db');

/**
 * 1. Update Volunteer Live Location and Status
 * Saves new POINT(longitude, latitude) coordinates
 * PUT /api/volunteers/:id/location
 */
const updateVolunteerLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, status } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'latitude and longitude are required.'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GPS coordinates.'
      });
    }

    let updateQuery = `
      UPDATE volunteers 
      SET current_location = POINT(?, ?)
    `;
    const params = [lng, lat];

    if (status) {
      const validStatuses = ['AVAILABLE', 'BUSY', 'OFFLINE'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Choose from: ${validStatuses.join(', ')}`
        });
      }
      updateQuery += `, status = ?`;
      params.push(status);
    }

    updateQuery += ` WHERE id = ?`;
    params.push(id);

    const [result] = await pool.execute(updateQuery, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: `Volunteer #${id} not found.`
      });
    }

    return res.status(200).json({
      success: true,
      message: `Volunteer #${id} GPS location successfully updated.`,
      latitude: lat,
      longitude: lng,
      status: status || 'UNCHANGED'
    });
  } catch (error) {
    console.error('Error updating volunteer location:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update volunteer location.',
      error: error.message
    });
  }
};

/**
 * 2. Get All Volunteers with Geo Coordinates & Fleet Details
 * GET /api/volunteers
 */
const getAllVolunteers = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT 
        v.id,
        v.user_id,
        u.name,
        u.email,
        u.phone,
        v.status,
        v.skills,
        v.vehicle_type,
        v.blood_group,
        v.assigned_rescue_id,
        s.urgency_level AS assigned_sos_urgency,
        s.details AS assigned_sos_details,
        u_victim.name AS assigned_victim_name,
        ST_X(v.current_location) AS longitude,
        ST_Y(v.current_location) AS latitude
      FROM volunteers v
      JOIN users u ON v.user_id = u.id
      LEFT JOIN sos_requests s ON v.assigned_rescue_id = s.id
      LEFT JOIN users u_victim ON s.user_id = u_victim.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND v.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY v.id ASC`;

    const [volunteers] = await pool.execute(query, params);

    return res.status(200).json({
      success: true,
      count: volunteers.length,
      data: volunteers
    });
  } catch (error) {
    console.error('Error fetching volunteers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch volunteers.',
      error: error.message
    });
  }
};

/**
 * 3. Update Volunteer Status (Toggle AVAILABLE / BUSY / OFFLINE)
 * PATCH /api/volunteers/:id/status
 */
const updateVolunteerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['AVAILABLE', 'BUSY', 'OFFLINE'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Valid status required: ${validStatuses.join(', ')}`
      });
    }

    const [result] = await pool.execute(
      'UPDATE volunteers SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Volunteer not found.' });
    }

    return res.status(200).json({
      success: true,
      message: `Volunteer #${id} status changed to ${status}.`,
      status
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Complete Assigned Rescue Mission (Mark SOS as RESOLVED)
 * POST /api/volunteers/:id/complete-mission
 */
const completeRescueMission = async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [volRows] = await connection.execute(
      'SELECT id, assigned_rescue_id, status FROM volunteers WHERE id = ? FOR UPDATE',
      [id]
    );

    if (volRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Volunteer not found.' });
    }

    const volunteer = volRows[0];
    const rescueId = volunteer.assigned_rescue_id;

    if (!rescueId) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'This volunteer currently has no assigned rescue mission to complete.'
      });
    }

    // 1. Mark SOS as RESOLVED
    await connection.execute(
      'UPDATE sos_requests SET status = "RESOLVED", resolved_at = NOW() WHERE id = ?',
      [rescueId]
    );

    // 2. Free up the volunteer
    await connection.execute(
      'UPDATE volunteers SET status = "AVAILABLE", assigned_rescue_id = NULL WHERE id = ?',
      [id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Rescue Mission #${rescueId} marked as RESOLVED! Volunteer #${id} is now available for next dispatch.`,
      resolved_sos_id: rescueId,
      volunteer_id: Number(id),
      volunteer_status: 'AVAILABLE'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error completing rescue mission:', error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

module.exports = {
  updateVolunteerLocation,
  getAllVolunteers,
  updateVolunteerStatus,
  completeRescueMission
};
