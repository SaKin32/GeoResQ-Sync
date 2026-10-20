const express = require('express');
const router = express.Router();
const { getAllAlerts, createAlert } = require('../controllers/alertController');
const { fetchUsgsEarthquakes, fetchWeatherAndFloodAlerts } = require('../services/cronService');

// 1. Get all alerts (optional filter ?severity=CRITICAL)
router.get('/', getAllAlerts);

// 2. Create alert manually
router.post('/', createAlert);

// 3. Force trigger external disaster API sync (both USGS & Weather/Flood feeds)
router.post('/sync', async (req, res) => {
  try {
    await fetchUsgsEarthquakes();
    await fetchWeatherAndFloodAlerts();
    return res.status(200).json({
      success: true,
      message: 'Disaster and meteorological early-warning feeds synced successfully.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
