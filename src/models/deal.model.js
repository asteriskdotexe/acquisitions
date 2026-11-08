import { sql } from 'drizzle-orm';
import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
// Relative imports on purpose: drizzle-kit loads model files itself and may
// not resolve the package.json "#models/*" alias.
import { listings } from './listing.model.js';
import { users } from './user.model.js';

export const dealStatuses = ['pending', 'accepted', 'rejected', 'withdrawn'];

export const dealStatusEnum = pgEnum('deal_status', dealStatuses);

export const deals = pgTable(
  'deals',
  {
    id: serial('id').primaryKey(),
    listing_id: integer('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyer_id: integer('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    offer_amount: numeric('offer_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),
    message: text('message'),
    status: dealStatusEnum('status').notNull().default('pending'),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  table => [
    // One pending offer per buyer per listing. Enforced by the database, so
    // two simultaneous requests can't both create one.
    uniqueIndex('deals_one_pending_per_buyer')
      .on(table.listing_id, table.buyer_id)
      .where(sql`${table.status} = 'pending'`),
  ]
);
