import type { Request, Response, NextFunction } from 'express';

// TODO: Replace with actual Supabase KYC status lookup
async function isKycVerified(_address: string): Promise<boolean> {
  // TODO: Query Supabase for KYC verification status
  return false;
}

export async function requireKyc(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const verified = await isKycVerified(req.user.address);

  if (!verified) {
    res.status(403).json({ error: 'KYC verification required' });
    return;
  }

  next();
}
