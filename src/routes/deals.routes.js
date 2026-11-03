import {
  createNewDeal,
  fetchAllDeals,
  fetchDealById,
  acceptDealById,
  rejectDealById,
  withdrawDealById,
} from '#controllers/deals.controller.js';
import { authenticateToken } from '#middleware/auth.middleware.js';
import express from 'express';

const router = express.Router();

// No delete route: deals are kept as history
router.post('/', authenticateToken, createNewDeal);
router.get('/', authenticateToken, fetchAllDeals);
router.get('/:id', authenticateToken, fetchDealById);
router.patch('/:id/accept', authenticateToken, acceptDealById);
router.patch('/:id/reject', authenticateToken, rejectDealById);
router.patch('/:id/withdraw', authenticateToken, withdrawDealById);

export default router;
