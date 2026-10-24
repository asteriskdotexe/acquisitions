import { db } from '#config/database.js';
import logger from '#config/logger.js';
import { users } from '#models/user.model.js';
import { eq } from 'drizzle-orm';
import { hashPassword } from '#services/auth.service.js';

// The columns we are happy to send back. The password hash is never in here.
const publicFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  created_at: users.created_at,
  updated_at: users.updated_at,
};

export const getAllUsers = async () => {
  try {
    return await db.select(publicFields).from(users);
  } catch (e) {
    logger.error('Error getting users: ', e);
    throw e;
  }
};

export const getUserById = async id => {
  try {
    const [user] = await db
      .select(publicFields)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) throw new Error('User not found');

    return user;
  } catch (e) {
    logger.error(`Error getting user ${id}: `, e);
    throw e;
  }
};

export const updateUser = async (id, updates) => {
  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!existingUser) throw new Error('User not found');

    const changes = { ...updates };

    // A new email must not already belong to someone else
    if (changes.email && changes.email !== existingUser.email) {
      const [emailTaken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, changes.email))
        .limit(1);

      if (emailTaken) throw new Error('Email already in use');
    }

    // Store the hash, never the plain password
    if (changes.password) {
      changes.password = await hashPassword(changes.password);
    }

    const [updatedUser] = await db
      .update(users)
      .set({ ...changes, updated_at: new Date() })
      .where(eq(users.id, id))
      .returning(publicFields);

    logger.info(`User ${updatedUser.email} updated successfully`);
    return updatedUser;
  } catch (e) {
    logger.error(`Error updating user ${id}: `, e);
    throw e;
  }
};

export const deleteUser = async id => {
  try {
    const [deletedUser] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, name: users.name });

    if (!deletedUser) throw new Error('User not found');

    logger.info(`User ${deletedUser.email} deleted successfully`);
    return deletedUser;
  } catch (e) {
    logger.error(`Error deleting user ${id}: `, e);
    throw e;
  }
};
