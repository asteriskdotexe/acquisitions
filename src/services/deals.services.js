import { db } from '#config/database.js';
import logger from '#config/logger.js';
import { deals } from '#models/deal.model.js';
import { listings } from '#models/listing.model.js';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';

// Postgres error codes this service turns into conflicts (409s).
const PG_DIVISION_BY_ZERO = '22012';
const PG_UNIQUE_VIOLATION = '23505';

// A single query fails with Drizzle's DrizzleQueryError, which keeps the
// Postgres error in .cause. db.batch() fails with Neon's error directly.
const pgErrorCode = e => e?.code ?? e?.cause?.code;

// Deal columns plus its listing's seller and status, for permission and state checks.
const dealWithSeller = {
  id: deals.id,
  listing_id: deals.listing_id,
  buyer_id: deals.buyer_id,
  seller_id: listings.seller_id,
  listing_status: listings.status,
  offer_amount: deals.offer_amount,
  message: deals.message,
  status: deals.status,
  created_at: deals.created_at,
  updated_at: deals.updated_at,
};

export const getListingForDeal = async listingId => {
  try {
    const [listing] = await db
      .select({
        id: listings.id,
        seller_id: listings.seller_id,
        status: listings.status,
      })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing) throw new Error('Listing not found');

    return listing;
  } catch (e) {
    logger.error(`Error getting listing ${listingId} for a deal: `, e);
    throw e;
  }
};

export const findPendingDeal = async (listingId, buyerId) => {
  try {
    const [deal] = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.listing_id, listingId),
          eq(deals.buyer_id, buyerId),
          eq(deals.status, 'pending')
        )
      )
      .limit(1);

    return deal ?? null;
  } catch (e) {
    logger.error(`Error checking pending deals on listing ${listingId}: `, e);
    throw e;
  }
};

export const createDeal = async (
  buyerId,
  { listing_id, offer_amount, message }
) => {
  try {
    const [, [newDeal]] = await db.batch([
      // Check statement: raises a division-by-zero error unless the listing
      // is active, which rolls back the whole batch so no deal is inserted
      // (acceptDeal explains the technique). FOR SHARE locks the listing row
      // until the batch ends: an accept running at the same time either waits
      // for this offer and then rejects it, or finishes first, and this check
      // then sees the listing is sold.
      db.execute(sql`
        select 1 / (
          select count(*)::int from (
            select 1 from ${listings}
            where ${listings.id} = ${listing_id}
              and ${listings.status} = 'active'
            for share
          ) as active_listing
        ) as listing_is_active
      `),
      db
        .insert(deals)
        .values({ listing_id, buyer_id: buyerId, offer_amount, message })
        .returning(),
    ]);

    logger.info(
      `Deal ${newDeal.id} created by user ${buyerId} on listing ${listing_id}`
    );
    return newDeal;
  } catch (e) {
    logger.error(`Error creating deal for user ${buyerId}: `, e);

    // Recognised by Postgres error code, never by message text
    const code = pgErrorCode(e);

    if (code === PG_DIVISION_BY_ZERO) {
      throw new Error('Listing is not active', { cause: e });
    }

    // deals_one_pending_per_buyer: another pending offer won the race
    if (code === PG_UNIQUE_VIOLATION) {
      throw new Error('Pending offer already exists', { cause: e });
    }

    throw e;
  }
};

export const getDeals = async ({ userId, isAdmin, status }) => {
  try {
    const conditions = [];

    // Everyone except admins only sees deals they are part of
    if (!isAdmin) {
      conditions.push(
        or(eq(deals.buyer_id, userId), eq(listings.seller_id, userId))
      );
    }

    if (status) conditions.push(eq(deals.status, status));

    return await db
      .select(dealWithSeller)
      .from(deals)
      .innerJoin(listings, eq(listings.id, deals.listing_id))
      .where(and(...conditions))
      .orderBy(desc(deals.created_at));
  } catch (e) {
    logger.error('Error getting deals: ', e);
    throw e;
  }
};

export const getDealById = async id => {
  try {
    const [deal] = await db
      .select(dealWithSeller)
      .from(deals)
      .innerJoin(listings, eq(listings.id, deals.listing_id))
      .where(eq(deals.id, id))
      .limit(1);

    if (!deal) throw new Error('Deal not found');

    return deal;
  } catch (e) {
    logger.error(`Error getting deal ${id}: `, e);
    throw e;
  }
};

export const acceptDeal = async ({ id, listing_id }) => {
  try {
    // db.batch() runs every statement in one transaction, but an UPDATE that
    // matches no rows is not an error, so the batch would still commit. The
    // last statement turns "this batch did not win" into an error.
    const [, [acceptedDeal], rejectedDeals] = await db.batch([
      // 1. Sell the listing. This runs first, so it is where two accepts on
      //    the same listing queue up: the second waits for the first to
      //    finish, then no longer matches status = 'active'.
      db
        .update(listings)
        .set({ status: 'sold', updated_at: sql`now()` })
        .where(and(eq(listings.id, listing_id), eq(listings.status, 'active')))
        .returning({ id: listings.id }),

      // 2. Accept this deal, only if it is still pending.
      db
        .update(deals)
        .set({ status: 'accepted', updated_at: sql`now()` })
        .where(and(eq(deals.id, id), eq(deals.status, 'pending')))
        .returning(),

      // 3. Reject every other pending offer on the listing.
      db
        .update(deals)
        .set({ status: 'rejected', updated_at: sql`now()` })
        .where(
          and(
            eq(deals.listing_id, listing_id),
            eq(deals.status, 'pending'),
            ne(deals.id, id)
          )
        )
        .returning({ id: deals.id }),

      // 4. Check statement: did THIS batch both sell the listing (step 1)
      //    and accept the deal (step 2)?
      //
      //    now() is the transaction's start time and is the same in every
      //    statement of this batch, so updated_at = now() proves the change
      //    was made here, not by an earlier accept.
      //
      //    Plain SQL can't raise an error on its own (that needs a PL/pgSQL
      //    function), so we divide 1 by the number of matching rows. If either
      //    step matched nothing, the count is 0 and Postgres raises
      //    division_by_zero (SQLSTATE 22012). Any error aborts the
      //    transaction, so the whole batch, steps 1 to 3 included, is rolled
      //    back and nothing changes. The catch below turns 22012 into a 409.
      db.execute(sql`
        select 1 / (
          select count(*)::int
          from ${deals}
          join ${listings} on ${listings.id} = ${deals.listing_id}
          where ${deals.id} = ${id}
            and ${deals.status} = 'accepted'
            and ${deals.updated_at} = now()::timestamp
            and ${listings.status} = 'sold'
            and ${listings.updated_at} = now()::timestamp
        ) as accepted_by_this_batch
      `),
    ]);

    logger.info(
      `Deal ${id} accepted, listing ${listing_id} sold, ${rejectedDeals.length} other offer(s) rejected`
    );
    return {
      deal: acceptedDeal,
      rejectedDealIds: rejectedDeals.map(deal => deal.id),
    };
  } catch (e) {
    logger.error(`Error accepting deal ${id}: `, e);

    // Recognised by Postgres error code, never by message text
    if (pgErrorCode(e) === PG_DIVISION_BY_ZERO) {
      throw new Error('Deal is no longer pending', { cause: e });
    }

    throw e;
  }
};

// Moves a pending deal to a new status. A single UPDATE is atomic on its own,
// and the status = 'pending' condition makes a late or repeated request
// match nothing instead of overwriting a decision.
const closePendingDeal = async (id, status) => {
  const [deal] = await db
    .update(deals)
    .set({ status, updated_at: new Date() })
    .where(and(eq(deals.id, id), eq(deals.status, 'pending')))
    .returning();

  if (!deal) throw new Error('Deal is no longer pending');

  return deal;
};

export const rejectDeal = async id => {
  try {
    const deal = await closePendingDeal(id, 'rejected');

    logger.info(`Deal ${id} rejected`);
    return deal;
  } catch (e) {
    logger.error(`Error rejecting deal ${id}: `, e);
    throw e;
  }
};

export const withdrawDeal = async id => {
  try {
    const deal = await closePendingDeal(id, 'withdrawn');

    logger.info(`Deal ${id} withdrawn`);
    return deal;
  } catch (e) {
    logger.error(`Error withdrawing deal ${id}: `, e);
    throw e;
  }
};
