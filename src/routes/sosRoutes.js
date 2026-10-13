const express = require('express');
const router = express.Router();
const {
  createSosRequest,
  getNearestVolunteers,
  assignVolunteerToSos,
  getAllSosRequests,
  updateSosStatus
} = require('../controllers/sosController');

// 1. Create a new SOS request
router.post('/', createSosRequest);

// 2. Get list of all SOS requests (with optional filters: ?status=PENDING&urgency_level=CRITICAL)
router.get('/', getAllSosRequests);

// 3. Find nearest available volunteers by coordinates query (?lat=..&lng=..&radius=5000)
router.get('/nearby-volunteers', getNearestVolunteers);

// 4. Find nearest available volunteers for a specific SOS request ID (?radius=5000)
router.get('/:id/nearest-volunteers', getNearestVolunteers);

// 5. Assign volunteer to an SOS request
router.post('/:id/assign', assignVolunteerToSos);

// 6. Update SOS status (e.g. IN_PROGRESS, RESOLVED)
router.patch('/:id/status', updateSosStatus);

module.exports = router;
