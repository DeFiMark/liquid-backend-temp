import { Router } from 'express';
import { generateChallenge } from './challenge.js';
import { verifySiweMessage } from './verify.js';
import { issueTokens, verifyRefreshToken } from './jwt.js';
import { validate } from '../middleware/validate.js';
import { challengeQuerySchema, verifyBodySchema, refreshBodySchema } from '../schemas/auth.js';
import { findUserByAddress, createUser, findUserById } from '../services/user.js';
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

router.post('/verify', validate(verifyBodySchema), async (req, res) => {
  try {
    const { message, signature } = req.body;

    const result = await verifySiweMessage(message, signature);

    // Find or create user
    let user = await findUserByAddress(result.address);
    if (!user) {
      user = await createUser(result.address);
    }

    // Attempt to proactively create smart wallet (server-side prediction)
    if (!user.smart_wallet_address) {
      try {
        const { ensureSmartWallet, isThirdwebConfigured } = await import('../services/smart-wallet.js');
        if (isThirdwebConfigured()) {
          const smartWalletAddr = await ensureSmartWallet(user.id, result.address);
          user.smart_wallet_address = smartWalletAddr;
        }
      } catch (walletErr: any) {
        // Don't fail auth if wallet prediction fails
        console.error('Smart wallet setup during auth failed:', walletErr.message);
      }
    }

    const tokens = issueTokens({
      sub: user.id,
      address: user.smart_wallet_address || user.wallet_address,
      eoa: result.eoa,
      role: user.role,
    });

    // Create session
    await createSession(user.id, tokens.refreshToken, req);

    res.json({
      ...tokens,
      address: user.smart_wallet_address || user.wallet_address,
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
