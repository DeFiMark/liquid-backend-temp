import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ensure no Upstash env vars so we get in-memory fallback
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { rateLimitAuth, rateLimitApi, rateLimitUpload, rateLimitWebhook } from '../middleware/rateLimit.js';

function mockReqRes(ip = '1.2.3.4') {
  const req: any = {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    user: undefined,
  };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    statusCode: 200,
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('Rate Limiting Middleware', () => {
  it('exports all four rate limiters as functions', () => {
    expect(typeof rateLimitAuth).toBe('function');
    expect(typeof rateLimitApi).toBe('function');
    expect(typeof rateLimitUpload).toBe('function');
    expect(typeof rateLimitWebhook).toBe('function');
  });

  it('in-memory fallback allows requests within limit', async () => {
    const { req, res, next } = mockReqRes('10.0.0.1');
    await rateLimitAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('in-memory fallback blocks after exceeding limit', async () => {
    const ip = '10.0.0.99'; // unique IP to avoid collision
    // Exhaust the auth limit (20 req/min)
    for (let i = 0; i < 20; i++) {
      const { req, res, next } = mockReqRes(ip);
      await rateLimitAuth(req, res, next);
    }
    // 21st should be blocked
    const { req, res, next } = mockReqRes(ip);
    await rateLimitAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Too many requests', retryAfter: expect.any(Number) })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
