import { jest } from '@jest/globals';
import request from 'supertest';

// Skip Arcjet (bot detection, shield, rate limits) in tests.
jest.unstable_mockModule('#middleware/security.middleware.js', () => ({
  default: (req, res, next) => next(),
}));

const { default: app } = await import('#src/app.js');

describe('API Endpoints', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api', () => {
    it('should return API message', async () => {
      const response = await request(app).get('/api').expect(200);

      expect(response.body).toHaveProperty(
        'message',
        'Acquisitions API is running!'
      );
    });
  });

  describe('GET /nonexistent', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/nonexistent').expect(404);

      expect(response.body).toHaveProperty('error', 'Route not found');
    });
  });
});
