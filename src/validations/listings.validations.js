import { z } from 'zod';
import { listingStatuses } from '#models/listing.model.js';

// Validates the :id in the URL, same idea as userIdSchema.
export const listingIdSchema = z.object({
  id: z.coerce
    .number({ error: 'Listing id must be a number' })
    .int('Listing id must be a whole number')
    .positive('Listing id must be greater than 0'),
});

// numeric(12,2) holds up to 9999999999.99. The price is turned into a
// string with exactly 2 decimals, which is how Postgres numeric round-trips.
const askingPriceSchema = z.coerce
  .number({ error: 'Asking price must be a number' })
  .positive('Asking price must be greater than 0')
  .max(9999999999.99, 'Asking price must be at most 9999999999.99')
  .multipleOf(0.01, 'Asking price can have at most 2 decimal places')
  .transform(price => price.toFixed(2));

// New listings always start as active, so status is not accepted here.
export const createListingSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).optional(),
  asking_price: askingPriceSchema,
});

// Every field is optional, but at least one must be sent.
// seller_id and any other field are dropped by Zod. description: null clears it.
export const updateListingSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    asking_price: askingPriceSchema.optional(),
    status: z.enum(listingStatuses).optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
  });

// The ?status= filter for GET /api/listings, defaults to active listings.
export const listingQuerySchema = z.object({
  status: z.enum(listingStatuses).default('active'),
});
