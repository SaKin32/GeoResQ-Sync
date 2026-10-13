const express = require('express');
const router = express.Router();
const { getAllAlerts, createAlert } = require('../controllers/alertController');
const { fetchUsgsEarthquakes } = require('../services/cronService');

// 1. Get all alerts (optional filter ?severity=CRITICAL)
router.get('/', getAllAlerts);

// 2. Create alert manually
router.post('/', createAlert);

// 3. Force trigger external disaster API sync
router.post('/sync', async (req, res) => {
  try {
    await fetchUsgsEarthquakes();
    return res.status(200).json({ success: true, message: 'Sync triggered successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
