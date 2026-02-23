import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';

export function auditLog(action: string, resourceType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Only log successful mutations
      if (res.statusCode < 400) {
        supabase.from('audit_log').insert({
          actor_id: null,
          actor_address: req.user?.address || null,
          action,
          resource_type: resourceType,
          resource_id: req.params.id || req.params.dealId || body?.id || null,
          ip_address: req.ip,
          user_agent: req.get('User-Agent') || null,
          metadata: {
            method: req.method,
            path: req.originalUrl,
          },
        }).then(); // Fire and forget

        return originalJson(body);
      }
      return originalJson(body);
    };

    next();
  };
}
