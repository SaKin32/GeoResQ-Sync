const { pool } = require('../config/db');

/**
 * 1. Get All Evacuation Shelters
 * GET /api/shelters
 */
const getAllShelters = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT 
        id, 
        name, 
        latitude, 
        longitude, 
        capacity, 
        current_occupancy,
        (capacity - current_occupancy) AS available_slots,
        ROUND((current_occupancy / capacity) * 100, 1) AS occupancy_percentage,
        contact_person, 
        contact_phone, 
        has_medical_facility, 
        status, 
        created_at,
        ST_X(location) AS spatial_lng,
        ST_Y(location) AS spatial_lat
      FROM evacuation_shelters
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY available_slots DESC, id ASC`;

    const [rows] = await pool.execute(query, params);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching shelters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch evacuation shelters.',
      error: error.message
    });
  }
};

/**
 * 2. Find Nearest Shelters using MySQL Spatial ST_Distance_Sphere
 * GET /api/shelters/nearest?lat=24.8949&lng=91.8687&radius=10000
 */
const getNearestShelters = async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'lat and lng query parameters are required.'
      });
    }

    const targetLat = parseFloat(lat);
    const targetLng = parseFloat(lng);
    const radiusMeters = parseInt(radius, 10) || 15000; // default 15km

    if (isNaN(targetLat) || isNaN(targetLng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude coordinates.'
      });
    }

    // Spatial Query with ST_Distance_Sphere
    const query = `
      SELECT 
        s.id AS shelter_id,
        s.name AS shelter_name,
        s.latitude,
        s.longitude,
        s.capacity,
        s.current_occupancy,
        (s.capacity - s.current_occupancy) AS available_slots,
        ROUND((s.current_occupancy / s.capacity) * 100, 1) AS occupancy_percentage,
        s.has_medical_facility,
        s.status,
        s.contact_person,
        s.contact_phone,
        ROUND(ST_Distance_Sphere(s.location, POINT(?, ?)), 2) AS distance_meters,
        ROUND(ST_Distance_Sphere(s.location, POINT(?, ?)) / 1000, 2) AS distance_km
      FROM evacuation_shelters s
      WHERE s.status != 'CLOSED'
        AND ST_Distance_Sphere(s.location, POINT(?, ?)) <= ?
      ORDER BY distance_meters ASC
      LIMIT 20;
    `;

    const [shelters] = await pool.execute(query, [
      targetLng, targetLat,
      targetLng, targetLat,
      targetLng, targetLat,
      radiusMeters
    ]);

    return res.status(200).json({
      success: true,
      origin: { latitude: targetLat, longitude: targetLng },
      radius_meters: radiusMeters,
      total_found: shelters.length,
      data: shelters
    });
  } catch (error) {
    console.error('Error finding nearest shelters:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search nearest shelters.',
      error: error.message
    });
  }
};

/**
 * 3. Add a new Shelter (Admin only)
 * POST /api/shelters
 */
const createShelter = async (req, res) => {
  try {
    const {
      name,
      latitude,
      longitude,
      capacity = 100,
      contact_person,
      contact_phone,
      has_medical_facility = true
    } = req.body;

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'name, latitude, and longitude are required.'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const cap = parseInt(capacity, 10);

    const [result] = await pool.execute(
      `INSERT INTO evacuation_shelters 
        (name, latitude, longitude, location, capacity, current_occupancy, contact_person, contact_phone, has_medical_facility, status)
       VALUES (?, ?, ?, POINT(?, ?), ?, 0, ?, ?, ?, 'OPEN')`,
      [name, lat, lng, lng, lat, cap, contact_person || null, contact_phone || null, has_medical_facility ? 1 : 0]
    );

    return res.status(201).json({
      success: true,
      message: 'Safe shelter added successfully.',
      shelter_id: result.insertId,
      name,
      capacity: cap
    });
  } catch (error) {
    console.error('Error adding shelter:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create shelter.',
      error: error.message
    });
  }
};

/**
 * 4. Update Shelter Occupancy
 * PATCH /api/shelters/:id/occupancy
 */
const updateOccupancy = async (req, res) => {
  try {
    const { id } = req.params;
    const { occupancy_delta, current_occupancy } = req.body;

    const [shelters] = await pool.execute(
      'SELECT id, capacity, current_occupancy FROM evacuation_shelters WHERE id = ?',
      [id]
    );

    if (shelters.length === 0) {
      return res.status(404).json({ success: false, message: 'Shelter not found.' });
    }

    const shelter = shelters[0];
    let newOccupancy = shelter.current_occupancy;

    if (current_occupancy !== undefined) {
      newOccupancy = parseInt(current_occupancy, 10);
    } else if (occupancy_delta !== undefined) {
      newOccupancy += parseInt(occupancy_delta, 10);
    }

    if (newOccupancy < 0) newOccupancy = 0;
    if (newOccupancy > shelter.capacity) {
      return res.status(400).json({
        success: false,
        message: `Capacity limit exceeded. Max capacity is ${shelter.capacity}, requested: ${newOccupancy}.`
      });
    }

    const newStatus = newOccupancy >= shelter.capacity ? 'FULL' : 'OPEN';

    await pool.execute(
      'UPDATE evacuation_shelters SET current_occupancy = ?, status = ? WHERE id = ?',
      [newOccupancy, newStatus, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Shelter occupancy updated successfully.',
      shelter_id: Number(id),
      current_occupancy: newOccupancy,
      capacity: shelter.capacity,
      available_slots: shelter.capacity - newOccupancy,
      status: newStatus
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllShelters,
  getNearestShelters,
  createShelter,
  updateOccupancy
};
