const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { testConnection, pool } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const sosRoutes = require('./routes/sosRoutes');
const reliefRoutes = require('./routes/reliefRoutes');
const volunteerRoutes = require('./routes/volunteerRoutes');
const shelterRoutes = require('./routes/shelterRoutes');
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

// 2. Health Check & Complete API Directory Route
app.get('/api', (req, res) => {
  res.status(200).json({
    service: 'GeoResQ-Sync: Autonomous Geospatial Disaster Response Engine',
    status: 'ACTIVE',
    version: '2.0.0',
    database: 'MySQL 8.0+ Spatial GIS & InnoDB ACID Engine',
    modules: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/me',
        list_users: 'GET /api/auth/users'
      },
      shelters: {
        list_all: 'GET /api/shelters',
        nearest_spatial_radar: 'GET /api/shelters/nearest?lat=24.8949&lng=91.8687&radius=10000',
        create_shelter: 'POST /api/shelters',
        update_occupancy: 'PATCH /api/shelters/:id/occupancy'
      },
      sos: {
        create: 'POST /api/sos',
        list: 'GET /api/sos',
        find_nearest_volunteers_by_sos_id: 'GET /api/sos/:id/nearest-volunteers?radius=5000',
        find_nearest_volunteers_by_coords: 'GET /api/sos/nearby-volunteers?lat=24.8949&lng=91.8687&radius=5000',
        find_nearest_shelters_by_sos_id: 'GET /api/sos/:id/nearest-shelters?radius=15000',
        assign_volunteer: 'POST /api/sos/:id/assign',
        update_status: 'PATCH /api/sos/:id/status'
      },
      volunteers: {
        list: 'GET /api/volunteers',
        update_location: 'PUT /api/volunteers/:id/location',
        update_status: 'PATCH /api/volunteers/:id/status',
        complete_rescue_mission: 'POST /api/volunteers/:id/complete-mission'
      },
      relief_logistics: {
        dispatch_transaction_linked_to_sos: 'POST /api/relief/dispatch',
        view_inventory: 'GET /api/relief/inventory',
        restock: 'POST /api/relief/inventory',
        dispatch_logs: 'GET /api/relief/dispatches',
        submit_donation: 'POST /api/relief/donations',
        list_donations: 'GET /api/relief/donations',
        approve_donation: 'PATCH /api/relief/donations/:id/approve'
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
app.use('/api/auth', authRoutes);
app.use('/api/shelters', shelterRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/relief', reliefRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/alerts', alertRoutes);

// 4. Distinct Web Page Routes (Uncluttered, Multi-Page Architecture)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/radar', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/shelters', (req, res) => res.sendFile(path.join(__dirname, '../public/shelters.html')));
app.get('/logistics', (req, res) => res.sendFile(path.join(__dirname, '../public/logistics.html')));
app.get('/volunteers', (req, res) => res.sendFile(path.join(__dirname, '../public/volunteers.html')));
app.get('/fleet', (req, res) => res.sendFile(path.join(__dirname, '../public/volunteers.html')));
app.get('/lab', (req, res) => res.sendFile(path.join(__dirname, '../public/lab.html')));
app.get('/database', (req, res) => res.sendFile(path.join(__dirname, '../public/lab.html')));
app.get('/alerts', (req, res) => res.sendFile(path.join(__dirname, '../public/alerts.html')));

// Fallback route
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
