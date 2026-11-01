import {
  fetchAllListings,
  fetchListingById,
  createNewListing,
  updateListingById,
  deleteListingById,
} from '#controllers/listings.controller.js';
import { authenticateToken } from '#middleware/auth.middleware.js';
import express from 'express';

const router = express.Router();

router.get('/', authenticateToken, fetchAllListings);
router.get('/:id', authenticateToken, fetchListingById);
router.post('/', authenticateToken, createNewListing);
router.put('/:id', authenticateToken, updateListingById);
router.delete('/:id', authenticateToken, deleteListingById);

export default router;
