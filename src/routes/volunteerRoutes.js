const express = require('express');
const router = express.Router();
const {
  updateVolunteerLocation,
  getAllVolunteers,
  updateVolunteerStatus,
  completeRescueMission
} = require('../controllers/volunteerController');

// 1. Get all volunteers (optional filter ?status=AVAILABLE)
router.get('/', getAllVolunteers);

// 2. Update volunteer's live GPS coordinates
router.put('/:id/location', updateVolunteerLocation);

// 3. Toggle volunteer status (AVAILABLE / BUSY / OFFLINE)
router.patch('/:id/status', updateVolunteerStatus);

// 4. Mark assigned rescue mission as completed / RESOLVED
router.post('/:id/complete-mission', completeRescueMission);

module.exports = router;
