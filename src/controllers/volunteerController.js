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
 * 2. Get All Volunteers with Geo Coordinates
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
        v.assigned_rescue_id,
        ST_X(v.current_location) AS longitude,
        ST_Y(v.current_location) AS latitude
      FROM volunteers v
      JOIN users u ON v.user_id = u.id
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

module.exports = {
  updateVolunteerLocation,
  getAllVolunteers
};
