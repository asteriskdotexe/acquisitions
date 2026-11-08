import express from 'express';
import logger from '#config/logger.js';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from '#routes/auth.routes.js';
import securityMiddleware from '#middleware/security.middleware.js';
import { attachUser } from '#middleware/auth.middleware.js';
import usersRoutes from '#routes/users.routes.js';
import listingsRoutes from '#routes/listings.routes.js';
import dealsRoutes from '#routes/deals.routes.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  morgan('combined', {
    stream: { write: message => logger.info(message.trim()) },
  })
);

// Order matters: attachUser needs req.cookies from cookieParser, and must run
// before securityMiddleware so the rate limit can pick a tier from req.user.
app.use(attachUser);

app.use(securityMiddleware);

app.get('/', (req, res) => {
  logger.info('Hello from Acquisitions');
  res.status(200).send('Hello from Acquisitions!');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({ message: 'Acquisitions API is running!' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/deals', dealsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler. Express recognises it by its four parameters, so
// `next` must stay even though it is only used for the headersSent case.
// Never sends the stack or the error message to the client.
app.use((err, req, res, next) => {
  // A response already started streaming: let Express close the connection
  if (res.headersSent) return next(err);

  // Malformed JSON body, rejected by express.json() before any route runs
  if (err.type === 'entity.parse.failed') {
    logger.warn(`Invalid JSON body on ${req.method} ${req.originalUrl}`);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Other client errors carry a 4xx status, e.g. body-parser's 413 for a
  // body over the size limit. Keep the status, but send a generic message.
  if (err.status >= 400 && err.status < 500) {
    logger.warn(
      `Client error ${err.status} on ${req.method} ${req.originalUrl}: ${err.message}`
    );
    return res.status(err.status).json({
      error: err.status === 413 ? 'Payload too large' : 'Bad request',
    });
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
