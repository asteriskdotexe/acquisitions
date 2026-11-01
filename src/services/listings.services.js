import { db } from '#config/database.js';
import logger from '#config/logger.js';
import { listings } from '#models/listing.model.js';
import { desc, eq } from 'drizzle-orm';

export const getListings = async ({ status }) => {
  try {
    return await db
      .select()
      .from(listings)
      .where(eq(listings.status, status))
      .orderBy(desc(listings.created_at));
  } catch (e) {
    logger.error('Error getting listings: ', e);
    throw e;
  }
};

export const getListingById = async id => {
  try {
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) throw new Error('Listing not found');

    return listing;
  } catch (e) {
    logger.error(`Error getting listing ${id}: `, e);
    throw e;
  }
};

export const createListing = async (
  sellerId,
  { title, description, asking_price }
) => {
  try {
    const [newListing] = await db
      .insert(listings)
      .values({ seller_id: sellerId, title, description, asking_price })
      .returning();

    logger.info(`Listing ${newListing.id} created by user ${sellerId}`);
    return newListing;
  } catch (e) {
    logger.error(`Error creating listing for user ${sellerId}: `, e);
    throw e;
  }
};

export const updateListing = async (id, updates) => {
  try {
    const [updatedListing] = await db
      .update(listings)
      .set({ ...updates, updated_at: new Date() })
      .where(eq(listings.id, id))
      .returning();
    //check for race condition, between the controller’s check and this update, someone could delete the listing
    if (!updatedListing) throw new Error('Listing not found');

    logger.info(`Listing ${id} updated successfully`);
    return updatedListing;
  } catch (e) {
    logger.error(`Error updating listing ${id}: `, e);
    throw e;
  }
};

export const deleteListing = async id => {
  try {
    const [deletedListing] = await db
      .delete(listings)
      .where(eq(listings.id, id))
      .returning({ id: listings.id, title: listings.title });
    //same race condition guard
    if (!deletedListing) throw new Error('Listing not found');

    logger.info(`Listing ${id} deleted successfully`);
    return deletedListing;
  } catch (e) {
    logger.error(`Error deleting listing ${id}: `, e);
    throw e;
  }
};
