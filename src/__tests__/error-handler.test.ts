import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(): Request {
  return { method: 'POST', path: '/test' } as any;
}

function mockRes(): Response & { _status: number; _json: any } {
  const res: any = { _status: 0, _json: null };
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: any) => { res._json = body; return res; };
  return res;
}

describe('errorHandler middleware', () => {
  const next: NextFunction = () => {};

  it('returns 500 with generic message for unhandled errors in production', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = mockRes();
      errorHandler(new Error('something broke'), mockReq(), res as any, next);
      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'Internal server error' });
    } finally {
      process.env.NODE_ENV = origEnv;
      consoleSpy.mockRestore();
    }
  });

  it('returns 413 for multer LIMIT_FILE_SIZE error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const multer = await import('multer');
    const res = mockRes();
    // Create a MulterError
    const err = new (multer.default as any).MulterError('LIMIT_FILE_SIZE');
    errorHandler(err, mockReq(), res as any, next);
    expect(res._status).toBe(413);
    expect(res._json.error).toContain('File too large');
    consoleSpy.mockRestore();
  });

  it('returns 400 for JSON parse errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    const err: any = new Error('Unexpected token');
    err.type = 'entity.parse.failed';
    errorHandler(err, mockReq(), res as any, next);
    expect(res._status).toBe(400);
    expect(res._json.error).toContain('Invalid JSON');
    consoleSpy.mockRestore();
  });
});
