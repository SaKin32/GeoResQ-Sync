const express = require('express');
const router = express.Router();
const {
  dispatchReliefGoods,
  getReliefInventory,
  restockInventory,
  getDispatchHistory
} = require('../controllers/reliefController');

// 1. Dispatch relief goods within an ACID Transaction (Atomic deduction + dispatch log)
router.post('/dispatch', dispatchReliefGoods);

// 2. View current inventory stocks
router.get('/inventory', getReliefInventory);

// 3. Add or restock inventory goods
router.post('/inventory', restockInventory);

// 4. View dispatch audit logs
router.get('/dispatches', getDispatchHistory);

module.exports = router;
