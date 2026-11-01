import logger from '#config/logger.js';
import { jwttoken } from '#utils/jwt.js';

// Reads the token cookie set at sign in, checks it, and puts the
// decoded user ({ id, email, role }) on req.user for the next handlers.
export const authenticateToken = (req, res, next) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please sign in first',
      });
    }

    req.user = jwttoken.verify(token);

    next();
  } catch (e) {
    logger.error('Failed to authenticate token', e);

    res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid or expired token',
    });
  }
};

// Optional auth: if the token cookie holds a valid token, put the decoded
// user on req.user, otherwise carry on as a guest. It never responds or
// blocks, so sign-up, sign-in and other public routes still work.
export const attachUser = (req, res, next) => {
  const user = jwttoken.tryVerify(req.cookies?.token);

  if (user) req.user = user;

  next();
};
