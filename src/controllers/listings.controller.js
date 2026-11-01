import logger from '#config/logger.js';
import {
  getListings,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
} from '#services/listings.services.js';
import {
  listingIdSchema,
  listingQuerySchema,
  createListingSchema,
  updateListingSchema,
} from '#validations/listings.validations.js';
import { formatValidationError } from '#utils/format.js';

// The seller can manage their own listing, admins can manage any listing
const canManage = (user, listing) =>
  user.role === 'admin' || Number(user.id) === listing.seller_id;

export const fetchAllListings = async (req, res, next) => {
  try {
    const queryResult = listingQuerySchema.safeParse(req.query);

    if (!queryResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(queryResult.error),
      });
    }

    const { status } = queryResult.data;

    logger.info(`Getting ${status} listings...`);

    const allListings = await getListings({ status });

    res.json({
      message: 'Successfully retrieved listings',
      listings: allListings,
      count: allListings.length,
    });
  } catch (e) {
    logger.error(e);
    next(e);
  }
};

export const fetchListingById = async (req, res, next) => {
  try {
    const idResult = listingIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    logger.info(`Getting listing by id: ${id}`);

    const listing = await getListingById(id);

    res.json({
      message: 'Successfully retrieved listing',
      listing,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Listing not found') {
      return res.status(404).json({ error: 'Listing not found' });
    }

    next(e);
  }
};

export const createNewListing = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const bodyResult = createListingSchema.safeParse(req.body);

    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(bodyResult.error),
      });
    }

    logger.info(`Creating listing for user ${req.user.id}`);

    const listing = await createListing(Number(req.user.id), bodyResult.data);

    res.status(201).json({
      message: 'Listing created successfully',
      listing,
    });
  } catch (e) {
    logger.error(e);
    next(e);
  }
};

export const updateListingById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = listingIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const bodyResult = updateListingSchema.safeParse(req.body);

    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(bodyResult.error),
      });
    }

    const { id } = idResult.data;
    const updates = bodyResult.data;

    const listing = await getListingById(id);

    if (!canManage(req.user, listing)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update your own listings',
      });
    }

    logger.info(`Updating listing ${id} (requested by user ${req.user.id})`);

    const updatedListing = await updateListing(id, updates);

    res.json({
      message: 'Listing updated successfully',
      listing: updatedListing,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Listing not found') {
      return res.status(404).json({ error: 'Listing not found' });
    }

    next(e);
  }
};

export const deleteListingById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = listingIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    const listing = await getListingById(id);

    if (!canManage(req.user, listing)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only delete your own listings',
      });
    }

    logger.info(`Deleting listing ${id} (requested by user ${req.user.id})`);

    const deletedListing = await deleteListing(id);

    res.json({
      message: 'Listing deleted successfully',
      listing: deletedListing,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Listing not found') {
      return res.status(404).json({ error: 'Listing not found' });
    }

    next(e);
  }
};
