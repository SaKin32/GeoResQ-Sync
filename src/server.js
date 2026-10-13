const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { testConnection, pool } = require('./config/db');
const sosRoutes = require('./routes/sosRoutes');
const reliefRoutes = require('./routes/reliefRoutes');
const volunteerRoutes = require('./routes/volunteerRoutes');
const alertRoutes = require('./routes/alertRoutes');
const { startDisasterAlertCron } = require('./services/cronService');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Serve Static Frontend Dashboard
app.use(express.static(path.join(__dirname, '../public')));

// 2. Health Check & API Directory Route
app.get('/api', (req, res) => {
  res.status(200).json({
    service: 'Disaster Alert & Local Crowdsourced Rescue Coordinator API',
    status: 'ACTIVE',
    version: '1.0.0',
    endpoints: {
      sos: {
        create: 'POST /api/sos',
        list: 'GET /api/sos',
        find_nearest_volunteers_by_sos_id: 'GET /api/sos/:id/nearest-volunteers?radius=5000',
        find_nearest_volunteers_by_coords: 'GET /api/sos/nearby-volunteers?lat=24.8949&lng=91.8687&radius=5000',
        assign_volunteer: 'POST /api/sos/:id/assign',
        update_status: 'PATCH /api/sos/:id/status'
      },
      relief: {
        dispatch_transaction: 'POST /api/relief/dispatch',
        view_inventory: 'GET /api/relief/inventory',
        restock: 'POST /api/relief/inventory',
        dispatch_logs: 'GET /api/relief/dispatches'
      },
      volunteers: {
        list: 'GET /api/volunteers',
        update_location: 'PUT /api/volunteers/:id/location'
      },
      alerts: {
        list: 'GET /api/alerts',
        create: 'POST /api/alerts',
        sync: 'POST /api/alerts/sync'
      }
    }
  });
});

// 3. Mount API Routes
app.use('/api/sos', sosRoutes);
app.use('/api/relief', reliefRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/alerts', alertRoutes);

// 4. Fallback to index.html for Frontend UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error occurred.',
    error: err.message
  });
});

// Server Initialization
const startServer = async () => {
  await testConnection();
  
  // Start the background cron worker for weather/earthquake alerts
  startDisasterAlertCron();

  app.listen(PORT, () => {
    console.log(`Disaster Rescue Backend Server running on http://localhost:${PORT}`);
  });
};

startServer();
