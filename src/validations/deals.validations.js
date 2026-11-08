import { z } from 'zod';
import { dealStatuses } from '#models/deal.model.js';
import { priceSchema } from '#validations/common.validations.js';

// Validates the :id in the URL, same idea as listingIdSchema.
export const dealIdSchema = z.object({
  id: z.coerce
    .number({ error: 'Deal id must be a number' })
    .int('Deal id must be a whole number')
    .positive('Deal id must be greater than 0'),
});

// buyer_id and any other field are dropped by Zod. The buyer always comes
// from the token.
export const createDealSchema = z.object({
  listing_id: z.coerce
    .number({ error: 'Listing id must be a number' })
    .int('Listing id must be a whole number')
    .positive('Listing id must be greater than 0'),
  offer_amount: priceSchema('Offer amount'),
  message: z.string().trim().max(1000).optional(),
});

// The optional ?status= filter for GET /api/deals. Without it, deals of
// every status are returned, since deals are kept as history.
export const dealQuerySchema = z.object({
  status: z.enum(dealStatuses).optional(),
});
