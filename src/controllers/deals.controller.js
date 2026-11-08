import logger from '#config/logger.js';
import {
  getListingForDeal,
  findPendingDeal,
  createDeal,
  getDeals,
  getDealById,
  acceptDeal,
  rejectDeal,
  withdrawDeal,
} from '#services/deals.services.js';
import {
  dealIdSchema,
  dealQuerySchema,
  createDealSchema,
} from '#validations/deals.validations.js';
import { formatValidationError } from '#utils/format.js';

// Errors the service throws when a deal or listing changed state between our
// checks and the database update (another request won the race)
const conflictErrors = [
  'Listing is not active',
  'Pending offer already exists',
  'Deal is no longer pending',
];

const isAdmin = user => user.role === 'admin';
const isBuyer = (user, deal) => Number(user.id) === deal.buyer_id;
const isSeller = (user, deal) => Number(user.id) === deal.seller_id;

export const createNewDeal = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const bodyResult = createDealSchema.safeParse(req.body);

    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(bodyResult.error),
      });
    }

    const { listing_id } = bodyResult.data;
    const buyerId = Number(req.user.id);

    const listing = await getListingForDeal(listing_id);

    if (listing.seller_id === buyerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You cannot make an offer on your own listing',
      });
    }

    if (listing.status !== 'active') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Offers can only be made on active listings',
      });
    }

    if (await findPendingDeal(listing_id, buyerId)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'You already have a pending offer on this listing',
      });
    }

    logger.info(`Creating deal on listing ${listing_id} for user ${buyerId}`);

    const deal = await createDeal(buyerId, bodyResult.data);

    res.status(201).json({
      message: 'Offer created successfully',
      deal,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Listing not found') {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (conflictErrors.includes(e.message)) {
      return res.status(409).json({ error: 'Conflict', message: e.message });
    }

    next(e);
  }
};

export const fetchAllDeals = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const queryResult = dealQuerySchema.safeParse(req.query);

    if (!queryResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(queryResult.error),
      });
    }

    const { status } = queryResult.data;

    logger.info(`Getting deals for user ${req.user.id}...`);

    const allDeals = await getDeals({
      userId: Number(req.user.id),
      isAdmin: isAdmin(req.user),
      status,
    });

    res.json({
      message: 'Successfully retrieved deals',
      deals: allDeals,
      count: allDeals.length,
    });
  } catch (e) {
    logger.error(e);
    next(e);
  }
};

export const fetchDealById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = dealIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    const deal = await getDealById(id);

    // The buyer, the listing's seller and admins can view a deal
    if (
      !isBuyer(req.user, deal) &&
      !isSeller(req.user, deal) &&
      !isAdmin(req.user)
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only view deals you are part of',
      });
    }

    res.json({
      message: 'Successfully retrieved deal',
      deal,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Deal not found') {
      return res.status(404).json({ error: 'Deal not found' });
    }

    next(e);
  }
};

export const acceptDealById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = dealIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    const deal = await getDealById(id);

    if (!isSeller(req.user, deal)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the seller can accept this offer',
      });
    }

    if (deal.status !== 'pending') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Deal is already ${deal.status}`,
      });
    }

    // A pending offer can outlive its listing, e.g. when the seller withdraws
    // the listing. Say so instead of letting the batch report the deal.
    if (deal.listing_status !== 'active') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Listing is already ${deal.listing_status}`,
      });
    }

    logger.info(`Accepting deal ${id} (requested by user ${req.user.id})`);

    const { deal: acceptedDeal, rejectedDealIds } = await acceptDeal(deal);

    res.json({
      message: 'Offer accepted and listing marked as sold',
      deal: acceptedDeal,
      rejected_deal_ids: rejectedDealIds,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Deal not found') {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (conflictErrors.includes(e.message)) {
      return res.status(409).json({ error: 'Conflict', message: e.message });
    }

    next(e);
  }
};

export const rejectDealById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = dealIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    const deal = await getDealById(id);

    if (!isSeller(req.user, deal)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the seller can reject this offer',
      });
    }

    if (deal.status !== 'pending') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Deal is already ${deal.status}`,
      });
    }

    logger.info(`Rejecting deal ${id} (requested by user ${req.user.id})`);

    const rejectedDeal = await rejectDeal(id);

    res.json({
      message: 'Offer rejected',
      deal: rejectedDeal,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Deal not found') {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (conflictErrors.includes(e.message)) {
      return res.status(409).json({ error: 'Conflict', message: e.message });
    }

    next(e);
  }
};

export const withdrawDealById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const idResult = dealIdSchema.safeParse(req.params);

    if (!idResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(idResult.error),
      });
    }

    const { id } = idResult.data;

    const deal = await getDealById(id);

    if (!isBuyer(req.user, deal)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the buyer can withdraw this offer',
      });
    }

    if (deal.status !== 'pending') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Deal is already ${deal.status}`,
      });
    }

    logger.info(`Withdrawing deal ${id} (requested by user ${req.user.id})`);

    const withdrawnDeal = await withdrawDeal(id);

    res.json({
      message: 'Offer withdrawn',
      deal: withdrawnDeal,
    });
  } catch (e) {
    logger.error(e);

    if (e.message === 'Deal not found') {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (conflictErrors.includes(e.message)) {
      return res.status(409).json({ error: 'Conflict', message: e.message });
    }

    next(e);
  }
};
