import { ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validate(schema: ZodSchema, source: 'body' | 'query' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(source === 'body' ? req.body : req.query);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation error',
        details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (source === 'body') req.body = result.data;
    else (req as any).validatedQuery = result.data;
    next();
  };
}
