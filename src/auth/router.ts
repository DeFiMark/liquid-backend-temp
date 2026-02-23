import { Router } from 'express';
import { generateChallenge } from './challenge.js';
import { verifySiweMessage } from './verify.js';
import { issueTokens, verifyRefreshToken } from './jwt.js';
import { validate } from '../middleware/validate.js';
import { challengeQuerySchema, verifyBodySchema, refreshBodySchema } from '../schemas/auth.js';
import { findUserByAddress, createUser } from '../services/user.js';
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

    const tokens = issueTokens({
      sub: payload.sub,
      address: payload.sub,
      role: 'investor', // Will be overridden when we load user
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
