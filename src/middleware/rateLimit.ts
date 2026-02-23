import type { Request, Response, NextFunction } from 'express';

// In-memory sliding window store
const windows = new Map<string, { count: number; start: number }>();

function inMemoryCheck(key: string, max: number, windowMs: number): { success: boolean; reset: number } {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || now - entry.start >= windowMs) {
    windows.set(key, { count: 1, start: now });
    return { success: true, reset: now + windowMs };
  }
  entry.count++;
  const reset = entry.start + windowMs;
  return { success: entry.count <= max, reset };
}

function getIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || 'unknown';
}

function getUserIdOrIp(req: Request): string {
  return (req as any).user?.id || getIp(req);
}

interface LimiterConfig {
  prefix: string;
  max: number;
  windowMs: number;
  keyFn: (req: Request) => string;
}

function createLimiter(config: LimiterConfig) {
  // Try to set up Upstash
  let upstashLimiter: any = null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const { Redis } = require('@upstash/redis');
      const { Ratelimit } = require('@upstash/ratelimit');
      const redis = new Redis({ url, token });
      upstashLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.max, `${config.windowMs} ms`),
        prefix: config.prefix,
        analytics: false,
      });
    } catch {
      // fall through to in-memory
    }
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = config.keyFn(req);
      let success: boolean;
      let reset: number;

      if (upstashLimiter) {
        const result = await upstashLimiter.limit(`${config.prefix}:${key}`);
        success = result.success;
        reset = result.reset;
      } else {
        const result = inMemoryCheck(`${config.prefix}:${key}`, config.max, config.windowMs);
        success = result.success;
        reset = result.reset;
      }

      if (!success) {
        const retryAfter = Math.max(Math.ceil((reset - Date.now()) / 1000), 1);
        res.status(429).json({ error: 'Too many requests', retryAfter });
        return;
      }
      next();
    } catch {
      next(); // fail open
    }
  };
}

export const rateLimitAuth = createLimiter({ prefix: 'auth', max: 20, windowMs: 60_000, keyFn: getIp });
export const rateLimitApi = createLimiter({ prefix: 'api', max: 100, windowMs: 60_000, keyFn: getUserIdOrIp });
export const rateLimitUpload = createLimiter({ prefix: 'upload', max: 10, windowMs: 300_000, keyFn: getUserIdOrIp });
export const rateLimitWebhook = createLimiter({ prefix: 'webhook', max: 200, windowMs: 60_000, keyFn: getIp });
