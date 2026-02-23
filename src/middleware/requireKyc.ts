import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';

export async function requireKyc(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { data } = await supabase
    .from('kyc_records')
    .select('status')
    .eq('user_id', req.user.id)
    .eq('status', 'approved')
    .limit(1)
    .single();

  if (!data) {
    res.status(403).json({ error: 'KYC verification required' });
    return;
  }

  next();
}
