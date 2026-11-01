import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { attachUser } from '#middleware/auth.middleware.js';
import { jwttoken } from '#utils/jwt.js';

const user = { id: 1, email: 'user@example.com', role: 'user' };

// A fake Express response that records whether anything was sent
const mockResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
});

const expectNoResponse = res => {
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
  expect(res.send).not.toHaveBeenCalled();
};

describe('attachUser middleware', () => {
  it('sets req.user and calls next for a valid token', () => {
    const req = { cookies: { token: jwttoken.sign(user) } };
    const res = mockResponse();
    const next = jest.fn();

    attachUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject(user);
    expectNoResponse(res);
  });

  it('calls next without req.user when there is no token cookie', () => {
    const req = { cookies: {} };
    const res = mockResponse();
    const next = jest.fn();

    attachUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expectNoResponse(res);
  });

  it('calls next without req.user when cookies were never parsed', () => {
    const req = {};
    const res = mockResponse();
    const next = jest.fn();

    attachUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expectNoResponse(res);
  });

  it('calls next without req.user for an invalid token', () => {
    const req = { cookies: { token: 'not-a-real-token' } };
    const res = mockResponse();
    const next = jest.fn();

    attachUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expectNoResponse(res);
  });

  it('calls next without req.user for a token signed with another secret', () => {
    const forged = jwt.sign({ ...user, role: 'admin' }, 'some-other-secret');
    const req = { cookies: { token: forged } };
    const res = mockResponse();
    const next = jest.fn();

    attachUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expectNoResponse(res);
  });
});
