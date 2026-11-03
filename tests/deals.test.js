import { jest } from '@jest/globals';
import request from 'supertest';

// Mocks must be registered before the app is imported, so the app and
// everything it imports get the mocked versions.
jest.unstable_mockModule('#services/deals.services.js', () => ({
  getListingForDeal: jest.fn(),
  findPendingDeal: jest.fn(),
  createDeal: jest.fn(),
  getDeals: jest.fn(),
  getDealById: jest.fn(),
  acceptDeal: jest.fn(),
  rejectDeal: jest.fn(),
  withdrawDeal: jest.fn(),
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
const { jwttoken } = await import('#utils/jwt.js');
const dealsService = await import('#services/deals.services.js');

const seller = { id: 1, email: 'seller@example.com', role: 'user' };
const buyer = { id: 2, email: 'buyer@example.com', role: 'user' };
const otherUser = { id: 3, email: 'other@example.com', role: 'user' };
const admin = { id: 4, email: 'admin@example.com', role: 'admin' };

const authCookie = user => `token=${jwttoken.sign(user)}`;

const listing = { id: 10, seller_id: seller.id, status: 'active' };

const pendingDeal = {
  id: 50,
  listing_id: listing.id,
  buyer_id: buyer.id,
  seller_id: seller.id,
  listing_status: 'active',
  offer_amount: '900.00',
  message: 'Is this still available?',
  status: 'pending',
};

const notFound = what => new Error(`${what} not found`);

describe('Deals API', () => {
  describe('authentication', () => {
    it('returns 401 for POST without a token cookie', async () => {
      const response = await request(app)
        .post('/api/deals')
        .send({ listing_id: listing.id, offer_amount: 900 })
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Authentication required');
      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    it('returns 401 for GET without a token cookie', async () => {
      await request(app).get('/api/deals').expect(401);

      expect(dealsService.getDeals).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/deals', () => {
    it('creates an offer for the signed-in buyer', async () => {
      dealsService.getListingForDeal.mockResolvedValue(listing);
      dealsService.findPendingDeal.mockResolvedValue(null);
      dealsService.createDeal.mockResolvedValue(pendingDeal);

      const response = await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send({
          listing_id: listing.id,
          offer_amount: 900,
          message: 'Is this still available?',
        })
        .expect(201);

      expect(dealsService.findPendingDeal).toHaveBeenCalledWith(
        listing.id,
        buyer.id
      );
      expect(dealsService.createDeal).toHaveBeenCalledWith(buyer.id, {
        listing_id: listing.id,
        offer_amount: '900.00',
        message: 'Is this still available?',
      });
      expect(response.body.deal).toEqual(pendingDeal);
    });

    it('ignores buyer_id and status sent in the body', async () => {
      dealsService.getListingForDeal.mockResolvedValue(listing);
      dealsService.findPendingDeal.mockResolvedValue(null);
      dealsService.createDeal.mockResolvedValue(pendingDeal);

      await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send({
          listing_id: listing.id,
          offer_amount: 900,
          buyer_id: otherUser.id,
          status: 'accepted',
        })
        .expect(201);

      // The buyer comes from the token, and unknown fields are dropped
      expect(dealsService.createDeal).toHaveBeenCalledWith(buyer.id, {
        listing_id: listing.id,
        offer_amount: '900.00',
      });
    });

    it.each([
      ['listing_id is missing', { offer_amount: 900 }],
      ['listing_id is not a number', { listing_id: 'abc', offer_amount: 900 }],
      ['offer_amount is missing', { listing_id: 10 }],
      ['offer_amount is zero', { listing_id: 10, offer_amount: 0 }],
      ['offer_amount is negative', { listing_id: 10, offer_amount: -5 }],
      ['offer_amount has 3 decimals', { listing_id: 10, offer_amount: 9.999 }],
      [
        'offer_amount is above numeric(12,2)',
        { listing_id: 10, offer_amount: 10000000000 },
      ],
      [
        'message is over 1000 characters',
        { listing_id: 10, offer_amount: 900, message: 'a'.repeat(1001) },
      ],
    ])('returns 400 when %s', async (_case, body) => {
      const response = await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send(body)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(dealsService.getListingForDeal).not.toHaveBeenCalled();
      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    it('returns 404 when the listing does not exist', async () => {
      dealsService.getListingForDeal.mockRejectedValue(notFound('Listing'));

      await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send({ listing_id: 999, offer_amount: 900 })
        .expect(404);

      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    it('returns 403 for an offer on your own listing', async () => {
      dealsService.getListingForDeal.mockResolvedValue(listing);

      const response = await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(seller))
        .send({ listing_id: listing.id, offer_amount: 900 })
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Forbidden');
      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    it('returns 409 for an offer on a listing that is not active', async () => {
      dealsService.getListingForDeal.mockResolvedValue({
        ...listing,
        status: 'sold',
      });

      const response = await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send({ listing_id: listing.id, offer_amount: 900 })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Conflict');
      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    it('returns 409 when the buyer already has a pending offer', async () => {
      dealsService.getListingForDeal.mockResolvedValue(listing);
      dealsService.findPendingDeal.mockResolvedValue(pendingDeal);

      const response = await request(app)
        .post('/api/deals')
        .set('Cookie', authCookie(buyer))
        .send({ listing_id: listing.id, offer_amount: 950 })
        .expect(409);

      expect(response.body).toHaveProperty('error', 'Conflict');
      expect(dealsService.createDeal).not.toHaveBeenCalled();
    });

    // The service reports these when another request wins a race after the
    // controller's checks passed
    it.each(['Pending offer already exists', 'Listing is not active'])(
      'returns 409 when the service reports "%s"',
      async serviceError => {
        dealsService.getListingForDeal.mockResolvedValue(listing);
        dealsService.findPendingDeal.mockResolvedValue(null);
        dealsService.createDeal.mockRejectedValue(new Error(serviceError));

        const response = await request(app)
          .post('/api/deals')
          .set('Cookie', authCookie(buyer))
          .send({ listing_id: listing.id, offer_amount: 900 })
          .expect(409);

        expect(response.body).toEqual({
          error: 'Conflict',
          message: serviceError,
        });
      }
    );
  });

  describe('GET /api/deals', () => {
    it('returns only my deals for a normal user', async () => {
      dealsService.getDeals.mockResolvedValue([pendingDeal]);

      const response = await request(app)
        .get('/api/deals')
        .set('Cookie', authCookie(buyer))
        .expect(200);

      expect(dealsService.getDeals).toHaveBeenCalledWith({
        userId: buyer.id,
        isAdmin: false,
        status: undefined,
      });
      expect(response.body).toHaveProperty('count', 1);
    });

    it('returns all deals for an admin, with a ?status= filter', async () => {
      dealsService.getDeals.mockResolvedValue([]);

      await request(app)
        .get('/api/deals?status=pending')
        .set('Cookie', authCookie(admin))
        .expect(200);

      expect(dealsService.getDeals).toHaveBeenCalledWith({
        userId: admin.id,
        isAdmin: true,
        status: 'pending',
      });
    });

    it('returns 400 for an unknown status', async () => {
      await request(app)
        .get('/api/deals?status=cancelled')
        .set('Cookie', authCookie(buyer))
        .expect(400);

      expect(dealsService.getDeals).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/deals/:id', () => {
    it.each([
      ['the buyer', buyer],
      ['the seller', seller],
      ['an admin', admin],
    ])('lets %s view the deal', async (_who, user) => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);

      const response = await request(app)
        .get('/api/deals/50')
        .set('Cookie', authCookie(user))
        .expect(200);

      expect(dealsService.getDealById).toHaveBeenCalledWith(50);
      expect(response.body.deal).toEqual(pendingDeal);
    });

    it('returns 403 for a user who is not part of the deal', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);

      const response = await request(app)
        .get('/api/deals/50')
        .set('Cookie', authCookie(otherUser))
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Forbidden');
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app)
        .get('/api/deals/abc')
        .set('Cookie', authCookie(buyer))
        .expect(400);

      expect(dealsService.getDealById).not.toHaveBeenCalled();
    });

    it('returns 404 when the deal does not exist', async () => {
      dealsService.getDealById.mockRejectedValue(notFound('Deal'));

      await request(app)
        .get('/api/deals/999')
        .set('Cookie', authCookie(buyer))
        .expect(404);
    });
  });

  describe('PATCH /api/deals/:id/accept', () => {
    it('lets the seller accept a pending deal', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);
      dealsService.acceptDeal.mockResolvedValue({
        deal: { ...pendingDeal, status: 'accepted' },
        rejectedDealIds: [51, 52],
      });

      const response = await request(app)
        .patch('/api/deals/50/accept')
        .set('Cookie', authCookie(seller))
        .expect(200);

      expect(dealsService.acceptDeal).toHaveBeenCalledWith(pendingDeal);
      expect(response.body.deal).toHaveProperty('status', 'accepted');
      expect(response.body.rejected_deal_ids).toEqual([51, 52]);
    });

    it.each([
      ['the buyer', buyer],
      ['another user', otherUser],
      ['an admin', admin],
    ])('returns 403 when %s tries to accept', async (_who, user) => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);

      await request(app)
        .patch('/api/deals/50/accept')
        .set('Cookie', authCookie(user))
        .expect(403);

      expect(dealsService.acceptDeal).not.toHaveBeenCalled();
    });

    it.each(['accepted', 'rejected', 'withdrawn'])(
      'returns 409 for a deal that is already %s',
      async status => {
        dealsService.getDealById.mockResolvedValue({ ...pendingDeal, status });

        const response = await request(app)
          .patch('/api/deals/50/accept')
          .set('Cookie', authCookie(seller))
          .expect(409);

        expect(response.body).toHaveProperty('error', 'Conflict');
        expect(dealsService.acceptDeal).not.toHaveBeenCalled();
      }
    );

    it('returns 409 when the listing is no longer active', async () => {
      dealsService.getDealById.mockResolvedValue({
        ...pendingDeal,
        listing_status: 'withdrawn',
      });

      const response = await request(app)
        .patch('/api/deals/50/accept')
        .set('Cookie', authCookie(seller))
        .expect(409);

      expect(response.body).toEqual({
        error: 'Conflict',
        message: 'Listing is already withdrawn',
      });
      expect(dealsService.acceptDeal).not.toHaveBeenCalled();
    });

    it('returns 409 when the deal changes state during the accept', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);
      dealsService.acceptDeal.mockRejectedValue(
        new Error('Deal is no longer pending')
      );

      const response = await request(app)
        .patch('/api/deals/50/accept')
        .set('Cookie', authCookie(seller))
        .expect(409);

      expect(response.body).toEqual({
        error: 'Conflict',
        message: 'Deal is no longer pending',
      });
    });

    it('returns 404 when the deal does not exist', async () => {
      dealsService.getDealById.mockRejectedValue(notFound('Deal'));

      await request(app)
        .patch('/api/deals/999/accept')
        .set('Cookie', authCookie(seller))
        .expect(404);
    });
  });

  describe('PATCH /api/deals/:id/reject', () => {
    it('lets the seller reject a pending deal', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);
      dealsService.rejectDeal.mockResolvedValue({
        ...pendingDeal,
        status: 'rejected',
      });

      const response = await request(app)
        .patch('/api/deals/50/reject')
        .set('Cookie', authCookie(seller))
        .expect(200);

      expect(dealsService.rejectDeal).toHaveBeenCalledWith(50);
      expect(response.body.deal).toHaveProperty('status', 'rejected');
    });

    it.each([
      ['the buyer', buyer],
      ['another user', otherUser],
      ['an admin', admin],
    ])('returns 403 when %s tries to reject', async (_who, user) => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);

      await request(app)
        .patch('/api/deals/50/reject')
        .set('Cookie', authCookie(user))
        .expect(403);

      expect(dealsService.rejectDeal).not.toHaveBeenCalled();
    });

    it('returns 409 for a deal that is not pending', async () => {
      dealsService.getDealById.mockResolvedValue({
        ...pendingDeal,
        status: 'accepted',
      });

      await request(app)
        .patch('/api/deals/50/reject')
        .set('Cookie', authCookie(seller))
        .expect(409);

      expect(dealsService.rejectDeal).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/deals/:id/withdraw', () => {
    it('lets the buyer withdraw a pending deal', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);
      dealsService.withdrawDeal.mockResolvedValue({
        ...pendingDeal,
        status: 'withdrawn',
      });

      const response = await request(app)
        .patch('/api/deals/50/withdraw')
        .set('Cookie', authCookie(buyer))
        .expect(200);

      expect(dealsService.withdrawDeal).toHaveBeenCalledWith(50);
      expect(response.body.deal).toHaveProperty('status', 'withdrawn');
    });

    it.each([
      ['the seller', seller],
      ['another user', otherUser],
      ['an admin', admin],
    ])('returns 403 when %s tries to withdraw', async (_who, user) => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);

      await request(app)
        .patch('/api/deals/50/withdraw')
        .set('Cookie', authCookie(user))
        .expect(403);

      expect(dealsService.withdrawDeal).not.toHaveBeenCalled();
    });

    it('returns 409 for a deal that is not pending', async () => {
      dealsService.getDealById.mockResolvedValue({
        ...pendingDeal,
        status: 'rejected',
      });

      await request(app)
        .patch('/api/deals/50/withdraw')
        .set('Cookie', authCookie(buyer))
        .expect(409);

      expect(dealsService.withdrawDeal).not.toHaveBeenCalled();
    });

    it('returns 409 when the deal changes state during the withdraw', async () => {
      dealsService.getDealById.mockResolvedValue(pendingDeal);
      dealsService.withdrawDeal.mockRejectedValue(
        new Error('Deal is no longer pending')
      );

      await request(app)
        .patch('/api/deals/50/withdraw')
        .set('Cookie', authCookie(buyer))
        .expect(409);
    });
  });
});
