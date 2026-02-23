import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../middleware/requireAuth.js';
import { issueTokens } from '../auth/jwt.js';
import type { Request, Response, NextFunction } from 'express';

process.env.JWT_SECRET = 'test-secret-key-for-vitest';

function mockReqRes(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('requireAuth middleware', () => {
  it('passes with valid token', () => {
    const { accessToken } = issueTokens('0xabc123', '0xeoa456');
    const { req, res, next } = mockReqRes(`Bearer ${accessToken}`);

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ address: '0xabc123', eoa: '0xeoa456' });
  });

  it('rejects missing header', () => {
    const { req, res, next } = mockReqRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects expired token', () => {
    vi.useFakeTimers();
    const { accessToken } = issueTokens('0xabc123');
    vi.advanceTimersByTime(16 * 60 * 1000);

    const { req, res, next } = mockReqRes(`Bearer ${accessToken}`);
    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    vi.useRealTimers();
  });

  it('rejects malformed token', () => {
    const { req, res, next } = mockReqRes('Bearer not.a.valid.token');

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
