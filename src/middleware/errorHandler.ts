import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';

/**
 * Global error handler — must be registered LAST in the middleware chain.
 * Express identifies error handlers by the 4-arg signature.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  // Log full error in all environments
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message || err);

  // Multer errors (file upload issues)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large (max 50MB)' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }

  // Multer file filter rejection
  if (err.message === 'File type not allowed') {
    res.status(400).json({ error: 'File type not allowed' });
    return;
  }

  // JSON parse errors
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON in request body' });
    return;
  }

  // Entity too large
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }

  // Default: 500 with generic message in production, detailed in dev
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
  });
}
