import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireKyc } from '../middleware/requireKyc.js';
import { validate } from '../middleware/validate.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  initiateDeposit,
  initiateWithdrawal,
  getTransaction,
  getTransactionHistory,
} from '../services/transaction.js';
import { z } from 'zod';

const router = Router();

const depositSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format'),
});

const withdrawalSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format'),
  linkedAccountId: z.string().uuid('Invalid account ID'),
});

const historyQuerySchema = z.object({
  type: z.enum(['deposit', 'withdrawal', 'investment', 'return', 'fee']).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// POST /transactions/deposit — Initiate a deposit (get wire instructions)
router.post('/deposit',
  requireAuth,
  requireKyc,
  validate(depositSchema),
  auditLog('initiate_deposit', 'transaction'),
  async (req, res) => {
    try {
      const result = await initiateDeposit(req.user!.id, req.body.amount);
      res.json(result);
    } catch (err: any) {
      console.error('Deposit error:', err);
      res.status(500).json({ error: 'Failed to initiate deposit' });
    }
  }
);

// POST /transactions/withdraw — Initiate a withdrawal
router.post('/withdraw',
  requireAuth,
  requireKyc,
  validate(withdrawalSchema),
  auditLog('initiate_withdrawal', 'transaction'),
  async (req, res) => {
    try {
      const result = await initiateWithdrawal(
        req.user!.id,
        req.body.amount,
        req.body.linkedAccountId
      );
      res.json(result);
    } catch (err: any) {
      if (err.message.includes('not found or inactive')) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Withdrawal error:', err);
      res.status(500).json({ error: 'Failed to initiate withdrawal' });
    }
  }
);

// GET /transactions — Transaction history
router.get('/',
  requireAuth,
  validate(historyQuerySchema, 'query'),
  async (req, res) => {
    try {
      const params = (req as any).validatedQuery;
      const result = await getTransactionHistory(req.user!.id, params);
      res.json(result);
    } catch (err: any) {
      console.error('History error:', err);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  }
);

// GET /transactions/:id — Single transaction
router.get('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const tx = await getTransaction(req.user!.id, req.params.id as string);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      res.json({ transaction: tx });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get transaction' });
    }
  }
);

export default router;
