import { Router } from 'express';
import { generateChallenge } from './challenge.js';
import { verifySiweMessage } from './verify.js';
import { issueTokens, verifyRefreshToken } from './jwt.js';
import { validate } from '../middleware/validate.js';
import { challengeQuerySchema, verifyBodySchema, refreshBodySchema } from '../schemas/auth.js';
import { findUserByAddress, createUser, findUserById, setSmartWalletAddress } from '../services/user.js';
import { createSession, validateSession, rotateSession, invalidateSession } from '../services/session.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/challenge', validate(challengeQuerySchema, 'query'), (req, res) => {
  const { address } = (req as any).validatedQuery;
  const challenge = generateChallenge(address);

  res.json({
    ...challenge,
    domain: process.env.APP_DOMAIN || 'localhost',
    chainId: 8453,
  });
});

/**
 * POST /auth/verify
 * 
 * SMART WALLET AUTH FLOW:
 * 
 * 1. Frontend creates Thirdweb in-app wallet (EOA) + smart account
 * 2. SIWE message address = SMART WALLET address (the on-chain identity)
 * 3. Thirdweb SDK signs as smart account (ERC-6492 for pre-deployed, EIP-1271 for deployed)
 * 4. viem.verifyMessage validates the signature on-chain
 * 5. The SIWE address IS the smart wallet — cryptographically proven
 * 6. wallet_address in DB = smart wallet (the verified address from SIWE)
 * 7. EOA sent optionally for audit trail only
 * 
 * This means: NO separate wallet registration step. The signature IS the proof.
 */
router.post('/verify', validate(verifyBodySchema), async (req, res) => {
  try {
    const { message, signature, eoa } = req.body;

    // Verify SIWE — viem handles EOA, EIP-1271 (deployed), and ERC-6492 (pre-deployed)
    const result = await verifySiweMessage(message, signature);

    // result.address = the address from the SIWE message
    // With smart wallet flow, this IS the smart wallet address (cryptographically verified)
    const verifiedAddress = result.address;

    // Find or create user by the verified address (smart wallet)
    let user = await findUserByAddress(verifiedAddress);
    if (!user) {
      user = await createUser(verifiedAddress);
    }

    // If frontend sent the EOA for audit, store it as smart_wallet_address context
    // wallet_address = verified SIWE address (smart wallet)
    // smart_wallet_address = same (for backward compat with existing code that reads this field)
    if (!user.smart_wallet_address && verifiedAddress) {
      await setSmartWalletAddress(user.id, verifiedAddress);
      user.smart_wallet_address = verifiedAddress.toLowerCase();
    }

    const tokens = issueTokens({
      sub: user.id,
      address: verifiedAddress,
      eoa: eoa || undefined, // Optional EOA for audit trail in JWT
      role: user.role,
    });

    // Create session
    await createSession(user.id, tokens.refreshToken, req);

    res.json({
      ...tokens,
      address: verifiedAddress,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        smart_wallet_address: user.smart_wallet_address,
        status: user.status,
        role: user.role,
      },
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Verification failed', details: err.message });
  }
});

router.post('/refresh', validate(refreshBodySchema), async (req, res) => {
  try {
    const { refreshToken } = req.body;

    const payload = verifyRefreshToken(refreshToken);

    // Validate session in DB
    const userId = await validateSession(refreshToken);
    if (!userId) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    // Load user to get current role + address
    const user = await findUserById(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const tokens = issueTokens({
      sub: user.id,
      address: user.smart_wallet_address || user.wallet_address,
      role: user.role,
    });

    // Rotate session
    await rotateSession(refreshToken, tokens.refreshToken, userId, req);

    res.json(tokens);
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid refresh token', details: err.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await invalidateSession(refreshToken);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
