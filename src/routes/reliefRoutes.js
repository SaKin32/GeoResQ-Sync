const express = require('express');
const router = express.Router();
const {
  dispatchReliefGoods,
  getReliefInventory,
  restockInventory,
  getDispatchHistory,
  createDonation,
  getDonations,
  approveDonation
} = require('../controllers/reliefController');
const { verifyToken, authorizeRoles, optionalToken } = require('../middleware/authMiddleware');

// 1. Dispatch relief goods within an ACID Transaction (Linked to SOS)
router.post('/dispatch', dispatchReliefGoods);

// 2. View current inventory stocks
router.get('/inventory', getReliefInventory);

// 3. Add or restock inventory goods (Admin)
router.post('/inventory', optionalToken, restockInventory);

// 4. View dispatch audit logs (shows linked SOS)
router.get('/dispatches', getDispatchHistory);

// 5. Submit donor contribution
router.post('/donations', optionalToken, createDonation);

// 6. View all donations
router.get('/donations', getDonations);

// 7. Approve donation and increment inventory
router.patch('/donations/:id/approve', optionalToken, approveDonation);

module.exports = router;
