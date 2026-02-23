import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt.js';
import { TokenExpiredError } from 'jsonwebtoken';

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
      address: payload.sub,
      eoa: payload.eoa,
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
