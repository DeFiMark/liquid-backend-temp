import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import { initiateKYC, getKYCStatus } from '../services/kyc.js';

const router = Router();

router.post('/initiate',
  requireAuth,
  auditLog('initiate_kyc', 'kyc'),
  async (req, res) => {
    try {
      const result = await initiateKYC(req.user!.id, req.body.email);
      res.json(result);
    } catch (err: any) {
      if (err.message === 'KYC already approved') {
        res.status(409).json({ error: err.message });
        return;
      }
      console.error('KYC initiation error:', err);
      res.status(500).json({ error: 'Failed to initiate KYC' });
    }
  }
);

router.get('/status',
  requireAuth,
  async (req, res) => {
    try {
      const status = await getKYCStatus(req.user!.id);
      if (!status) {
        res.json({ status: 'not_started' });
        return;
      }
      res.json(status);
    } catch (err: any) {
      console.error('KYC status error:', err);
      res.status(500).json({ error: 'Failed to get KYC status' });
    }
  }
);

export default router;
