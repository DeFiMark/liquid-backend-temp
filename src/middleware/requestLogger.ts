import type { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware.
 * Logs: method, path, status, response time, IP
 * Skips health checks to reduce noise.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip health checks
  if (req.path === '/health') {
    next();
    return;
  }

  const start = Date.now();
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '-';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    console.log(`[HTTP] [${level}] ${req.method} ${req.path} ${status} ${duration}ms ${ip}`);
  });

  next();
}
