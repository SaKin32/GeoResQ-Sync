const express = require('express');
const router = express.Router();
const {
  getAllShelters,
  getNearestShelters,
  createShelter,
  updateOccupancy
} = require('../controllers/shelterController');
const { verifyToken, authorizeRoles, optionalToken } = require('../middleware/authMiddleware');

// 1. Get all shelters
router.get('/', getAllShelters);

// 2. Spatial search for nearest shelters (ST_Distance_Sphere)
router.get('/nearest', getNearestShelters);

// 3. Add new shelter (Admin only)
router.post('/', verifyToken, authorizeRoles('ADMIN'), createShelter);

// 4. Update shelter occupancy / admissions
router.patch('/:id/occupancy', optionalToken, updateOccupancy);

module.exports = router;
