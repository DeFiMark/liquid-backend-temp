import { Router } from 'express';
import { generateChallenge } from './challenge.js';
import { verifySiweMessage } from './verify.js';
import { issueTokens, verifyRefreshToken } from './jwt.js';

const router = Router();

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

router.get('/challenge', (req, res) => {
  const address = req.query.address as string;

  if (!address || !ADDRESS_REGEX.test(address)) {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  const challenge = generateChallenge(address);

  res.json({
    ...challenge,
    domain: process.env.APP_DOMAIN || 'localhost',
    chainId: 8453,
  });
});

router.post('/verify', async (req, res) => {
  try {
    const { message, signature } = req.body;

    if (!message || !signature) {
      res.status(400).json({ error: 'Missing message or signature' });
      return;
    }

    const result = await verifySiweMessage(message, signature);
    const tokens = issueTokens(result.address, result.eoa);

    res.json({
      ...tokens,
      address: result.address,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Verification failed', details: err.message });
  }
});

router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Missing refresh token' });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);
    const tokens = issueTokens(payload.sub);

    res.json(tokens);
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid refresh token', details: err.message });
  }
});

export default router;
