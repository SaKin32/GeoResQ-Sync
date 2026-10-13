const express = require('express');
const router = express.Router();
const {
  updateVolunteerLocation,
  getAllVolunteers
} = require('../controllers/volunteerController');

// 1. Get all volunteers (optional filter ?status=AVAILABLE)
router.get('/', getAllVolunteers);

// 2. Update volunteer's live GPS coordinates and availability
router.put('/:id/location', updateVolunteerLocation);

module.exports = router;
