import { jest } from '@jest/globals';
import request from 'supertest';

// Mocks must be registered before the app is imported, so the app and
// everything it imports get the mocked versions.
jest.unstable_mockModule('#services/users.services.js', () => ({
  getAllUsers: jest.fn(),
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
}));

// The other services import the database, so it is stubbed out to keep the
// tests from needing a real connection.
jest.unstable_mockModule('#config/database.js', () => ({
  db: {},
  sql: jest.fn(),
}));

// Skip Arcjet (bot detection, shield, rate limits) in tests.
jest.unstable_mockModule('#middleware/security.middleware.js', () => ({
  default: (req, res, next) => next(),
}));

const { default: app } = await import('#src/app.js');
const { requireRole } = await import('#middleware/auth.middleware.js');
const { jwttoken } = await import('#utils/jwt.js');
const usersService = await import('#services/users.services.js');

const user = { id: 1, email: 'user@example.com', role: 'user' };
const admin = { id: 2, email: 'admin@example.com', role: 'admin' };

const authCookie = u => `token=${jwttoken.sign(u)}`;

// A fake Express response that records what was sent
const mockResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('requireRole middleware', () => {
  it('calls next when the user has an allowed role', () => {
    const req = { user: admin };
    const res = mockResponse();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts any of several allowed roles', () => {
    const next = jest.fn();

    requireRole('admin', 'user')({ user }, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 and does not call next for the wrong role', () => {
    const res = mockResponse();
    const next = jest.fn();

    requireRole('admin')({ user }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Insufficient permissions',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when there is no signed-in user', () => {
    const res = mockResponse();
    const next = jest.fn();

    requireRole('admin')({}, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('GET /api/users', () => {
  it('returns 403 for a normal user', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie(user))
      .expect(403);

    expect(response.body).toEqual({
      error: 'Forbidden',
      message: 'Insufficient permissions',
    });
    expect(usersService.getAllUsers).not.toHaveBeenCalled();
  });

  it('returns the users for an admin', async () => {
    const users = [
      { id: 1, email: 'user@example.com', name: 'User', role: 'user' },
      { id: 2, email: 'admin@example.com', name: 'Admin', role: 'admin' },
    ];
    usersService.getAllUsers.mockResolvedValue(users);

    const response = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie(admin))
      .expect(200);

    expect(response.body.users).toEqual(users);
    expect(response.body).toHaveProperty('count', 2);
  });

  it('still returns 401 without a token', async () => {
    await request(app).get('/api/users').expect(401);

    expect(usersService.getAllUsers).not.toHaveBeenCalled();
  });
});

describe('global error handler', () => {
  it('returns 400 for a malformed JSON body', async () => {
    const response = await request(app)
      .post('/api/auth/sign-in')
      .set('Content-Type', 'application/json')
      .send('{"email": "user@example.com", ')
      .expect(400);

    expect(response.body).toEqual({ error: 'Invalid JSON' });
  });

  it('returns 413 for a body over the size limit', async () => {
    // express.json() accepts up to 100kb by default
    const body = JSON.stringify({ padding: 'a'.repeat(110 * 1024) });

    const response = await request(app)
      .post('/api/auth/sign-in')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(413);

    expect(response.body).toEqual({ error: 'Payload too large' });
  });

  it('returns 500 without details for an unexpected service error', async () => {
    usersService.getAllUsers.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432')
    );

    const response = await request(app)
      .get('/api/users')
      .set('Cookie', authCookie(admin))
      .expect('Content-Type', /json/)
      .expect(500);

    // Only the generic message: no error text, stack or internal address
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(response.text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|at /);
  });
});
