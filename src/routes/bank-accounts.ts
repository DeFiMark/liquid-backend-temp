import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireKyc } from '../middleware/requireKyc.js';
import { validate } from '../middleware/validate.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  createLinkToken,
  exchangeAndStoreAccount,
  getUserAccounts,
  getAccountById,
  deactivateAccount,
  createProcessorToken,
} from '../services/bank-account.js';
import { z } from 'zod';

const router = Router();

const exchangeSchema = z.object({
  publicToken: z.string().min(1),
  accountId: z.string().min(1),
  institution: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
});

router.post('/link-token',
  requireAuth,
  requireKyc,
  async (req, res) => {
    try {
      const linkToken = await createLinkToken(req.user!.id);
      res.json({ linkToken });
    } catch (err: any) {
      console.error('Link token error:', err);
      res.status(500).json({ error: 'Failed to create link token' });
    }
  }
);

router.post('/exchange',
  requireAuth,
  requireKyc,
  validate(exchangeSchema),
  auditLog('link_bank_account', 'linked_account'),
  async (req, res) => {
    try {
      const { publicToken, accountId, institution } = req.body;
      const result = await exchangeAndStoreAccount(
        req.user!.id,
        publicToken,
        accountId,
        institution
      );
      res.json({ accountId: result.id });
    } catch (err: any) {
      if (err.message.includes('Only checking and savings')) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Exchange error:', err);
      res.status(500).json({ error: 'Failed to link account' });
    }
  }
);

router.get('/',
  requireAuth,
  async (req, res) => {
    try {
      const accounts = await getUserAccounts(req.user!.id);
      res.json({ accounts });
    } catch (err: any) {
      console.error('List accounts error:', err);
      res.status(500).json({ error: 'Failed to list accounts' });
    }
  }
);

router.get('/:id',
  requireAuth,
  async (req, res) => {
    try {
      const account = await getAccountById(req.user!.id, req.params.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      res.json({ account });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get account' });
    }
  }
);

router.delete('/:id',
  requireAuth,
  auditLog('deactivate_bank_account', 'linked_account'),
  async (req, res) => {
    try {
      await deactivateAccount(req.user!.id, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error('Deactivate error:', err);
      res.status(500).json({ error: 'Failed to deactivate account' });
    }
  }
);

router.post('/:id/processor-token',
  requireAuth,
  requireKyc,
  auditLog('create_processor_token', 'linked_account'),
  async (req, res) => {
    try {
      const token = await createProcessorToken(req.user!.id, req.params.id);
      res.json({ processorToken: token });
    } catch (err: any) {
      console.error('Processor token error:', err);
      res.status(500).json({ error: 'Failed to create processor token' });
    }
  }
);

export default router;
