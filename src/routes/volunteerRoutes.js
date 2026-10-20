const express = require('express');
const router = express.Router();
const {
  updateVolunteerLocation,
  getAllVolunteers,
  updateVolunteerStatus,
  completeRescueMission,
  createVolunteer
} = require('../controllers/volunteerController');

// 1. Get all volunteers (optional filter ?status=AVAILABLE)
router.get('/', getAllVolunteers);

// 2. Register a new volunteer into fleet
router.post('/', createVolunteer);

// 3. Update volunteer's live GPS coordinates
router.put('/:id/location', updateVolunteerLocation);

// 4. Toggle volunteer status (AVAILABLE / BUSY / OFFLINE)
router.patch('/:id/status', updateVolunteerStatus);

// 5. Mark assigned rescue mission as completed / RESOLVED
router.post('/:id/complete-mission', completeRescueMission);

module.exports = router;
