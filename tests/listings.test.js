import { jest } from '@jest/globals';
import request from 'supertest';

// Mocks must be registered before the app is imported, so the app and
// everything it imports get the mocked versions.
jest.unstable_mockModule('#services/listings.services.js', () => ({
  getListings: jest.fn(),
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

// Skip Arcjet (bot detection, shield, rate limits) in tests.
jest.unstable_mockModule('#middleware/security.middleware.js', () => ({
  default: (req, res, next) => next(),
}));

const { default: app } = await import('#src/app.js');
const { jwttoken } = await import('#utils/jwt.js');
const listingsService = await import('#services/listings.services.js');

const seller = { id: 1, email: 'seller@example.com', role: 'user' };
const otherUser = { id: 2, email: 'other@example.com', role: 'user' };
const admin = { id: 3, email: 'admin@example.com', role: 'admin' };

const authCookie = user => `token=${jwttoken.sign(user)}`;

const listing = {
  id: 10,
  seller_id: seller.id,
  title: 'Vintage bike',
  description: 'Barely used',
  asking_price: '1500.00',
  status: 'active',
};

const notFound = () => new Error('Listing not found');

describe('Listings API', () => {
  describe('authentication', () => {
    it('returns 401 without a token cookie', async () => {
      const response = await request(app).get('/api/listings').expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(listingsService.getListings).not.toHaveBeenCalled();
    });

    it('returns 401 with an invalid token', async () => {
      const response = await request(app)
        .post('/api/listings')
        .set('Cookie', 'token=not-a-real-token')
        .send({ title: 'Vintage bike', asking_price: 1500 })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication failed');
      expect(listingsService.createListing).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/listings', () => {
    it('returns active listings by default', async () => {
      listingsService.getListings.mockResolvedValue([listing]);

      const response = await request(app)
        .get('/api/listings')
        .set('Cookie', authCookie(otherUser))
        .expect(200);

      expect(listingsService.getListings).toHaveBeenCalledWith({
        status: 'active',
      });
      expect(response.body).toHaveProperty('count', 1);
      expect(response.body.listings).toEqual([listing]);
    });

    it('filters by ?status=', async () => {
      listingsService.getListings.mockResolvedValue([]);

      await request(app)
        .get('/api/listings?status=sold')
        .set('Cookie', authCookie(otherUser))
        .expect(200);

      expect(listingsService.getListings).toHaveBeenCalledWith({
        status: 'sold',
      });
    });

    it('returns 400 for an unknown status', async () => {
      await request(app)
        .get('/api/listings?status=deleted')
        .set('Cookie', authCookie(otherUser))
        .expect(400);

      expect(listingsService.getListings).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/listings/:id', () => {
    it('returns the listing', async () => {
      listingsService.getListingById.mockResolvedValue(listing);

      const response = await request(app)
        .get('/api/listings/10')
        .set('Cookie', authCookie(otherUser))
        .expect(200);

      expect(listingsService.getListingById).toHaveBeenCalledWith(10);
      expect(response.body.listing).toEqual(listing);
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app)
        .get('/api/listings/abc')
        .set('Cookie', authCookie(otherUser))
        .expect(400);
    });

    it('returns 404 when the listing does not exist', async () => {
      listingsService.getListingById.mockRejectedValue(notFound());

      const response = await request(app)
        .get('/api/listings/999')
        .set('Cookie', authCookie(otherUser))
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Listing not found');
    });
  });

  describe('POST /api/listings', () => {
    it('creates a listing owned by the signed-in user', async () => {
      listingsService.createListing.mockResolvedValue(listing);

      const response = await request(app)
        .post('/api/listings')
        .set('Cookie', authCookie(seller))
        .send({
          title: 'Vintage bike',
          asking_price: 1500,
          seller_id: 99,
          status: 'sold',
        })
        .expect(201);

      // seller_id comes from the token, and status is dropped
      expect(listingsService.createListing).toHaveBeenCalledWith(seller.id, {
        title: 'Vintage bike',
        asking_price: '1500.00',
      });
      expect(response.body.listing).toEqual(listing);
    });

    it('returns 400 when the title is missing', async () => {
      await request(app)
        .post('/api/listings')
        .set('Cookie', authCookie(seller))
        .send({ asking_price: 1500 })
        .expect(400);

      expect(listingsService.createListing).not.toHaveBeenCalled();
    });

    it('returns 400 for a price with more than 2 decimals', async () => {
      await request(app)
        .post('/api/listings')
        .set('Cookie', authCookie(seller))
        .send({ title: 'Vintage bike', asking_price: 10.999 })
        .expect(400);

      expect(listingsService.createListing).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/listings/:id', () => {
    it('lets the seller update their listing', async () => {
      listingsService.getListingById.mockResolvedValue(listing);
      listingsService.updateListing.mockResolvedValue({
        ...listing,
        status: 'sold',
      });

      const response = await request(app)
        .put('/api/listings/10')
        .set('Cookie', authCookie(seller))
        .send({ status: 'sold' })
        .expect(200);

      expect(listingsService.updateListing).toHaveBeenCalledWith(10, {
        status: 'sold',
      });
      expect(response.body.listing).toHaveProperty('status', 'sold');
    });

    it('lets an admin update any listing', async () => {
      listingsService.getListingById.mockResolvedValue(listing);
      listingsService.updateListing.mockResolvedValue({
        ...listing,
        status: 'withdrawn',
      });

      await request(app)
        .put('/api/listings/10')
        .set('Cookie', authCookie(admin))
        .send({ status: 'withdrawn' })
        .expect(200);

      expect(listingsService.updateListing).toHaveBeenCalledWith(10, {
        status: 'withdrawn',
      });
    });

    it('returns 403 for a user who is not the seller', async () => {
      listingsService.getListingById.mockResolvedValue(listing);

      const response = await request(app)
        .put('/api/listings/10')
        .set('Cookie', authCookie(otherUser))
        .send({ asking_price: 1 })
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(listingsService.updateListing).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty body', async () => {
      await request(app)
        .put('/api/listings/10')
        .set('Cookie', authCookie(seller))
        .send({})
        .expect(400);

      expect(listingsService.updateListing).not.toHaveBeenCalled();
    });

    it('returns 404 when the listing does not exist', async () => {
      listingsService.getListingById.mockRejectedValue(notFound());

      await request(app)
        .put('/api/listings/999')
        .set('Cookie', authCookie(seller))
        .send({ status: 'sold' })
        .expect(404);

      expect(listingsService.updateListing).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/listings/:id', () => {
    it('lets the seller delete their listing', async () => {
      listingsService.getListingById.mockResolvedValue(listing);
      listingsService.deleteListing.mockResolvedValue({
        id: listing.id,
        title: listing.title,
      });

      await request(app)
        .delete('/api/listings/10')
        .set('Cookie', authCookie(seller))
        .expect(200);

      expect(listingsService.deleteListing).toHaveBeenCalledWith(10);
    });

    it('lets an admin delete any listing', async () => {
      listingsService.getListingById.mockResolvedValue(listing);
      listingsService.deleteListing.mockResolvedValue({
        id: listing.id,
        title: listing.title,
      });

      await request(app)
        .delete('/api/listings/10')
        .set('Cookie', authCookie(admin))
        .expect(200);

      expect(listingsService.deleteListing).toHaveBeenCalledWith(10);
    });

    it('returns 403 for a user who is not the seller', async () => {
      listingsService.getListingById.mockResolvedValue(listing);

      await request(app)
        .delete('/api/listings/10')
        .set('Cookie', authCookie(otherUser))
        .expect(403);

      expect(listingsService.deleteListing).not.toHaveBeenCalled();
    });

    it('returns 404 when the listing does not exist', async () => {
      listingsService.getListingById.mockRejectedValue(notFound());

      await request(app)
        .delete('/api/listings/999')
        .set('Cookie', authCookie(seller))
        .expect(404);

      expect(listingsService.deleteListing).not.toHaveBeenCalled();
    });
  });
});
