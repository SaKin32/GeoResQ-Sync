const { pool } = require('../config/db');

/**
 * 1. Create a new SOS Request
 * Saves GPS coordinates as both DECIMAL and MySQL Spatial POINT(longitude, latitude).
 * POST /api/sos
 */
const createSosRequest = async (req, res) => {
  try {
    const { user_id, latitude, longitude, urgency_level = 'MEDIUM', details } = req.body;

    if (!user_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user_id, latitude, longitude are mandatory.'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude coordinates.'
      });
    }

    // In MySQL Spatial, standard POINT(x, y) treats X as longitude and Y as latitude
    const insertQuery = `
      INSERT INTO sos_requests 
        (user_id, latitude, longitude, location, urgency_level, status, details)
      VALUES 
        (?, ?, ?, POINT(?, ?), ?, 'PENDING', ?)
    `;

    const [result] = await pool.execute(insertQuery, [
      user_id,
      lat,
      lng,
      lng, // X coordinate for POINT
      lat, // Y coordinate for POINT
      urgency_level,
      details || null
    ]);

    // Fetch the inserted record with coordinates as floats
    const [rows] = await pool.execute(
      `SELECT 
        id, 
        user_id, 
        latitude, 
        longitude, 
        urgency_level, 
        status, 
        details, 
        created_at,
        ST_X(location) AS spatial_lng,
        ST_Y(location) AS spatial_lat
       FROM sos_requests 
       WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: '🚨 SOS request registered successfully.',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error creating SOS request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create SOS request.',
      error: error.message
    });
  }
};

/**
 * 2. Fetch Nearest Volunteers for an SOS Request using ST_Distance_Sphere
 * GET /api/sos/:id/nearest-volunteers?radius=5000
 * Or GET /api/sos/nearby-volunteers?lat=24.8949&lng=91.8687&radius=5000
 */
const getNearestVolunteers = async (req, res) => {
  try {
    const { id } = req.params;
    const radiusMeters = parseInt(req.query.radius, 10) || 5000; // default: 5km (5000 meters)

    let targetLat, targetLng, sosDetails = null;

    if (id) {
      // Find SOS request coordinates
      const [sosRows] = await pool.execute(
        `SELECT id, user_id, latitude, longitude, urgency_level, status, details, location 
         FROM sos_requests WHERE id = ?`,
        [id]
      );

      if (sosRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `SOS Request with ID ${id} not found.`
        });
      }

      sosDetails = sosRows[0];
      targetLat = parseFloat(sosDetails.latitude);
      targetLng = parseFloat(sosDetails.longitude);
    } else {
      targetLat = parseFloat(req.query.lat);
      targetLng = parseFloat(req.query.lng);

      if (isNaN(targetLat) || isNaN(targetLng)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide either an SOS :id or lat/lng query parameters.'
        });
      }
    }

    /**
     * GEOSPATIAL QUERY:
     * ST_Distance_Sphere(point1, point2) calculates spherical distance on earth in meters.
     * v.current_location is stored as POINT(lng, lat).
     * Filter by status = 'AVAILABLE' and distance <= radiusMeters.
     */
    const query = `
      SELECT 
        v.id AS volunteer_id,
        u.id AS user_id,
        u.name,
        u.phone,
        u.email,
        v.status,
        ST_X(v.current_location) AS longitude,
        ST_Y(v.current_location) AS latitude,
        ROUND(ST_Distance_Sphere(v.current_location, POINT(?, ?)), 2) AS distance_meters,
        ROUND(ST_Distance_Sphere(v.current_location, POINT(?, ?)) / 1000, 2) AS distance_km
      FROM volunteers v
      JOIN users u ON v.user_id = u.id
      WHERE v.status = 'AVAILABLE'
        AND ST_Distance_Sphere(v.current_location, POINT(?, ?)) <= ?
      ORDER BY distance_meters ASC
      LIMIT 25;
    `;

    const [volunteers] = await pool.execute(query, [
      targetLng, targetLat, // For select distance_meters
      targetLng, targetLat, // For select distance_km
      targetLng, targetLat, // For where ST_Distance_Sphere filter
      radiusMeters
    ]);

    return res.status(200).json({
      success: true,
      sos_request: sosDetails ? {
        id: sosDetails.id,
        urgency_level: sosDetails.urgency_level,
        status: sosDetails.status,
        latitude: targetLat,
        longitude: targetLng
      } : { latitude: targetLat, longitude: targetLng },
      search_radius_meters: radiusMeters,
      total_volunteers_found: volunteers.length,
      volunteers
    });
  } catch (error) {
    console.error('Error fetching nearest volunteers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch nearest volunteers.',
      error: error.message
    });
  }
};

/**
 * 3. Assign Volunteer to SOS Request
 * Updates volunteer status to 'BUSY' and SOS status to 'ASSIGNED'
 * POST /api/sos/:id/assign
 */
const assignVolunteerToSos = async (req, res) => {
  const { id } = req.params;
  const { volunteer_id } = req.body;

  if (!volunteer_id) {
    return res.status(400).json({
      success: false,
      message: 'volunteer_id is required in request body.'
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Check SOS request state
    const [sosRows] = await connection.execute(
      'SELECT id, status FROM sos_requests WHERE id = ? FOR UPDATE',
      [id]
    );

    if (sosRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'SOS request not found.' });
    }

    if (sosRows[0].status === 'RESOLVED') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'SOS request is already resolved.' });
    }

    // 2. Check Volunteer state
    const [volRows] = await connection.execute(
      'SELECT id, status FROM volunteers WHERE id = ? FOR UPDATE',
      [volunteer_id]
    );

    if (volRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Volunteer not found.' });
    }

    if (volRows[0].status !== 'AVAILABLE') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Volunteer is currently ${volRows[0].status} and cannot be assigned.`
      });
    }

    // 3. Update SOS request to ASSIGNED
    await connection.execute(
      'UPDATE sos_requests SET status = "ASSIGNED" WHERE id = ?',
      [id]
    );

    // 4. Update Volunteer to BUSY with assigned_rescue_id
    await connection.execute(
      'UPDATE volunteers SET status = "BUSY", assigned_rescue_id = ? WHERE id = ?',
      [id, volunteer_id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Volunteer #${volunteer_id} successfully assigned to SOS Request #${id}.`,
      sos_id: Number(id),
      volunteer_id: Number(volunteer_id),
      status: 'ASSIGNED'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in assigning volunteer:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign volunteer.',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * 4. List All SOS Requests
 * GET /api/sos
 */
const getAllSosRequests = async (req, res) => {
  try {
    const { status, urgency_level } = req.query;
    let query = `
      SELECT 
        s.id, 
        s.user_id, 
        u.name AS victim_name,
        u.phone AS victim_phone,
        s.latitude, 
        s.longitude, 
        s.urgency_level, 
        s.status, 
        s.details, 
        s.created_at,
        ST_X(s.location) AS spatial_lng,
        ST_Y(s.location) AS spatial_lat
      FROM sos_requests s
      JOIN users u ON s.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND s.status = ?`;
      params.push(status);
    }
    if (urgency_level) {
      query += ` AND s.urgency_level = ?`;
      params.push(urgency_level);
    }

    query += ` ORDER BY FIELD(s.urgency_level, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), s.created_at DESC`;

    const [rows] = await pool.execute(query, params);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching SOS requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch SOS requests.',
      error: error.message
    });
  }
};

/**
 * 5. Update SOS Status (e.g. to IN_PROGRESS or RESOLVED)
 * PATCH /api/sos/:id/status
 */
const updateSosStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Valid options are: ${validStatuses.join(', ')}`
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      'UPDATE sos_requests SET status = ? WHERE id = ?',
      [status, id]
    );

    // If resolved, free up the assigned volunteer
    if (status === 'RESOLVED') {
      await connection.execute(
        `UPDATE volunteers 
         SET status = 'AVAILABLE', assigned_rescue_id = NULL 
         WHERE assigned_rescue_id = ?`,
        [id]
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `SOS Request #${id} marked as ${status}.`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating SOS status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update SOS status.',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  createSosRequest,
  getNearestVolunteers,
  assignVolunteerToSos,
  getAllSosRequests,
  updateSosStatus
};
