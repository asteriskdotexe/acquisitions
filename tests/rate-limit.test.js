import { jest } from '@jest/globals';
import request from 'supertest';

// slidingWindow returns just the rule's name, so withRule receives a
// string we can assert on, like 'user-rate-limit'.
jest.unstable_mockModule('@arcjet/node', () => ({
  slidingWindow: jest.fn(options => options.name),
}));

// withRule records the rule it was given and returns a client that always
// allows the request, so nothing is actually rate limited in the test.
jest.unstable_mockModule('#config/arcjet.js', () => ({
  default: {
    withRule: jest.fn(() => ({
      protect: jest.fn(async () => ({ isDenied: () => false })),
    })),
  },
}));

jest.unstable_mockModule('#services/listings.services.js', () => ({
  getListings: jest.fn(async () => []),
  getListingById: jest.fn(),
  createListing: jest.fn(),
  updateListing: jest.fn(),
  deleteListing: jest.fn(),
}));

// The users and auth services import the database, so it is stubbed out
// to keep the tests from needing a real connection.
jest.unstable_mockModule('#config/database.js', () => ({
  db: {},
  sql: jest.fn(),
}));

const { default: app } = await import('#src/app.js');
const { default: aj } = await import('#config/arcjet.js');
const { slidingWindow } = await import('@arcjet/node');
const { jwttoken } = await import('#utils/jwt.js');
const listingsService = await import('#services/listings.services.js');

const authCookie = user => `token=${jwttoken.sign(user)}`;

// A denied Arcjet decision for one reason: 'bot', 'shield' or 'rateLimit'
const deniedDecision = kind => ({
  isDenied: () => true,
  reason: {
    isBot: () => kind === 'bot',
    isShield: () => kind === 'shield',
    isRateLimit: () => kind === 'rateLimit',
  },
});

// Makes the next request's Arcjet check return a denied decision
const denyNextRequest = kind => {
  aj.withRule.mockReturnValueOnce({
    protect: jest.fn(async () => deniedDecision(kind)),
  });
};

// Regression: securityMiddleware runs globally, before the routes'
// authenticateToken, so it used to see no req.user and rate limited every
// request as a guest. attachUser now sets req.user first.
describe('role-based rate limiting', () => {
  it('uses the user rate limit for a signed-in user', async () => {
    await request(app)
      .get('/api/listings')
      .set(
        'Cookie',
        authCookie({ id: 1, email: 'u@example.com', role: 'user' })
      )
      .expect(200);

    expect(aj.withRule).toHaveBeenCalledTimes(1);
    expect(aj.withRule).toHaveBeenCalledWith('user-rate-limit');
    expect(slidingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'user-rate-limit', max: 10 })
    );
  });

  it('uses the admin rate limit for an admin', async () => {
    await request(app)
      .get('/api/listings')
      .set(
        'Cookie',
        authCookie({ id: 3, email: 'a@example.com', role: 'admin' })
      )
      .expect(200);

    expect(aj.withRule).toHaveBeenCalledTimes(1);
    expect(aj.withRule).toHaveBeenCalledWith('admin-rate-limit');
    expect(slidingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'admin-rate-limit', max: 20 })
    );
  });

  it('uses the guest rate limit when there is no token', async () => {
    // Still rejected by authenticateToken, after the rate limit check
    await request(app).get('/api/listings').expect(401);

    expect(aj.withRule).toHaveBeenCalledTimes(1);
    expect(aj.withRule).toHaveBeenCalledWith('guest-rate-limit');
    expect(slidingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'guest-rate-limit', max: 5 })
    );
  });

  it('uses the guest rate limit for an invalid token', async () => {
    await request(app)
      .get('/api/listings')
      .set('Cookie', 'token=not-a-real-token')
      .expect(401);

    expect(aj.withRule).toHaveBeenCalledWith('guest-rate-limit');
  });
});

describe('blocked requests', () => {
  it('returns 429 with Retry-After when the rate limit is exceeded', async () => {
    denyNextRequest('rateLimit');

    const response = await request(app)
      .get('/api/listings')
      .set(
        'Cookie',
        authCookie({ id: 1, email: 'u@example.com', role: 'user' })
      )
      .expect(429);

    expect(response.headers['retry-after']).toBe('60');
    expect(response.body).toEqual({
      error: 'Too Many Requests',
      message: 'User request limit exceeded (10 per minute), slow down.',
    });
    expect(listingsService.getListings).not.toHaveBeenCalled();
  });

  it('returns 403 without Retry-After for a bot', async () => {
    denyNextRequest('bot');

    const response = await request(app).get('/api/listings').expect(403);

    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.body).toEqual({
      error: 'Forbidden',
      message: 'Automated requests are not allowed',
    });
  });

  it('returns 403 without Retry-After for a shield block', async () => {
    denyNextRequest('shield');

    const response = await request(app).get('/api/listings').expect(403);

    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.body).toEqual({
      error: 'Forbidden',
      message: 'Request blocked by security policy',
    });
  });
});
