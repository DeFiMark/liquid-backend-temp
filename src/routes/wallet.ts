import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import { validate } from '../middleware/validate.js';
import { registerSmartWallet, getSmartWalletAddress, ensureSmartWallet, isThirdwebConfigured } from '../services/smart-wallet.js';
import { registerWalletSchema } from '../schemas/wallet.js';

const router = Router();

/**
 * POST /wallet/setup
 * 
 * Proactively create/predict smart wallet using server-side Thirdweb SDK.
 * Called by frontend after first login. Requires THIRDWEB_SECRET_KEY.
 */
router.post('/setup',
  requireAuth,
  auditLog('setup_smart_wallet', 'wallet'),
  async (req, res) => {
    try {
      if (!isThirdwebConfigured()) {
        res.status(503).json({ error: 'Smart wallet service not configured' });
        return;
      }

      const address = await ensureSmartWallet(req.user!.id, req.user!.address);
      res.json({ smartWalletAddress: address });
    } catch (err: any) {
      console.error('Wallet setup error:', err);
      res.status(500).json({ error: 'Failed to setup smart wallet' });
    }
  }
);

/**
 * POST /wallet/register
 * 
 * Frontend calls this after Thirdweb creates the smart account.
 * Stores the smart wallet address as the user's on-chain identity.
 * 
 * IMMUTABLE: Once set, cannot be changed (returns 409 if different address sent).
 * IDEMPOTENT: Sending the same address again is fine (returns 200).
 */
router.post('/register',
  requireAuth,
  validate(registerWalletSchema),
  auditLog('register_smart_wallet', 'wallet'),
  async (req, res) => {
    try {
      const { smartWalletAddress } = req.body;
      const stored = await registerSmartWallet(req.user!.id, smartWalletAddress);
      res.json({ smartWalletAddress: stored });
    } catch (err: any) {
      if (err.message.includes('already registered')) {
        res.status(409).json({ error: err.message });
        return;
      }
      console.error('Wallet register error:', err);
      res.status(500).json({ error: 'Failed to register smart wallet' });
    }
  }
);

/**
 * GET /wallet
 * 
 * Returns the user's wallet info:
 * - smartWalletAddress: their on-chain identity (null if not yet registered)
 * - eoaAddress: the signing EOA (from JWT, for reference only)
 * - configured: whether server-side Thirdweb prediction is available
 */
router.get('/',
  requireAuth,
  async (req, res) => {
    try {
      const address = await getSmartWalletAddress(req.user!.id);
      res.json({
        smartWalletAddress: address,
        eoaAddress: req.user!.eoa || req.user!.address,
        configured: isThirdwebConfigured(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get wallet info' });
    }
  }
);

export default router;
