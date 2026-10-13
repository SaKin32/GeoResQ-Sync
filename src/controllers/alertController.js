const { pool } = require('../config/db');

/**
 * 1. Get All Disaster Alerts
 * GET /api/alerts
 */
const getAllAlerts = async (req, res) => {
  try {
    const { severity } = req.query;
    let query = `
      SELECT id, source_api, alert_title, description, severity, event_time 
      FROM disaster_alerts 
      WHERE 1=1
    `;
    const params = [];

    if (severity) {
      query += ` AND severity = ?`;
      params.push(severity);
    }

    query += ` ORDER BY event_time DESC LIMIT 50`;

    const [alerts] = await pool.execute(query, params);

    return res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch disaster alerts.',
      error: error.message
    });
  }
};

/**
 * 2. Manually Create an Alert (e.g. from Admin or Webhook)
 * POST /api/alerts
 */
const createAlert = async (req, res) => {
  try {
    const { source_api, alert_title, description, severity } = req.body;

    if (!source_api || !alert_title || !severity) {
      return res.status(400).json({
        success: false,
        message: 'source_api, alert_title, and severity are required.'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO disaster_alerts (source_api, alert_title, description, severity, event_time) 
       VALUES (?, ?, ?, ?, NOW())`,
      [source_api, alert_title, description || null, severity]
    );

    return res.status(201).json({
      success: true,
      message: 'Disaster alert registered successfully.',
      alert_id: result.insertId,
      alert_title,
      severity
    });
  } catch (error) {
    console.error('Error registering alert:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create disaster alert.',
      error: error.message
    });
  }
};

module.exports = {
  getAllAlerts,
  createAlert
};
