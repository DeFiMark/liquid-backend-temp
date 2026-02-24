import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt.js';
import pkg from 'jsonwebtoken';
const { TokenExpiredError } = pkg;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      address: payload.address || payload.sub,
      eoa: payload.eoa,
      role: payload.role || 'investor',
    };
    next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }
}
