import jwt from 'jsonwebtoken';
import logger from '#config/logger.js';

// Only used outside production, so local runs and tests work without a .env.
const DEV_ONLY_JWT_SECRET = 'dev-only-insecure-jwt-secret-do-not-use-in-prod';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

if (!process.env.JWT_SECRET) {
  logger.warn('JWT_SECRET is not set, using the dev-only fallback secret');
}

const JWT_SECRET = process.env.JWT_SECRET || DEV_ONLY_JWT_SECRET;
// Single source of truth for session length; the token cookie uses it too.
export const JWT_EXPIRES_IN_SECONDS = 15 * 60;

export const jwttoken = {
  sign: payload => {
    try {
      return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN_SECONDS,
      });
    } catch (e) {
      logger.error('Failed to authenticate token', e);
      throw new Error('Failed to authenticate token', { cause: e });
    }
  },
  verify: token => {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (e) {
      logger.error('Failed to authenticate token', e);
      throw new Error('Failed to authenticate token', { cause: e });
    }
  },
  // Like verify, but for optional auth: returns null instead of throwing or
  // logging, because a missing or expired token is normal for guests.
  tryVerify: token => {
    if (!token) return null;

    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  },
};
