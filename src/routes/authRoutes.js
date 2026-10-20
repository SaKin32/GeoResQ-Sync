const express = require('express');
const router = express.Router();
const { register, login, getProfile, getAllUsers } = require('../controllers/authController');
const { verifyToken, authorizeRoles } = require('../middleware/authMiddleware');

// Public authentication routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', verifyToken, getProfile);
router.get('/users', verifyToken, authorizeRoles('ADMIN'), getAllUsers);

module.exports = router;
