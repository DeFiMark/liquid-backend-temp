import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import { validate } from '../middleware/validate.js';
import { registerSmartWallet, getSmartWalletAddress } from '../services/smart-wallet.js';
import { registerWalletSchema } from '../schemas/wallet.js';

const router = Router();

/**
 * POST /wallet/register
 * 
 * FALLBACK ONLY — normally the smart wallet address is captured during SIWE auth
 * (the SIWE message address IS the smart wallet, verified via ERC-6492/EIP-1271).
 * 
 * This endpoint exists for edge cases where:
 * - User authenticated with EOA before smart wallet was created
 * - Migration from old auth flow
 * - Manual address correction by support
 * 
 * IMMUTABLE: Once set, cannot be changed (returns 409 if different address sent).
 * IDEMPOTENT: Sending the same address again returns 200.
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
 * - smartWalletAddress: their on-chain identity (= wallet_address from SIWE)
 * - eoaAddress: the signing EOA (from JWT, for reference only)
 */
router.get('/',
  requireAuth,
  async (req, res) => {
    try {
      const address = await getSmartWalletAddress(req.user!.id);
      res.json({
        smartWalletAddress: address,
        eoaAddress: req.user!.eoa || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get wallet info' });
    }
  }
);

export default router;
