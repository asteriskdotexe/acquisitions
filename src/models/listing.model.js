import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
// Relative import on purpose: drizzle-kit loads model files itself and may
// not resolve the package.json "#models/*" alias.
import { users } from './user.model.js';

export const listingStatuses = ['active', 'sold', 'withdrawn'];

export const listingStatusEnum = pgEnum('listing_status', listingStatuses);

export const listings = pgTable('listings', {
  id: serial('id').primaryKey(),
  seller_id: integer('seller_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  asking_price: numeric('asking_price', { precision: 12, scale: 2 }).notNull(),
  status: listingStatusEnum('status').notNull().default('active'),
  created_at: timestamp().defaultNow().notNull(),
  updated_at: timestamp().defaultNow().notNull(),
});
