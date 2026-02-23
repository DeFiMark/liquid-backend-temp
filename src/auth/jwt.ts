import jwt from 'jsonwebtoken';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return secret;
}

export interface AccessTokenPayload {
  sub: string;
  address?: string;
  eoa?: string;
  role?: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

/**
 * Issue JWT tokens.
 * New signature: issueTokens({ sub, address, eoa, role })
 * Legacy signature: issueTokens(address, eoa?) — kept for backward compat
 */
export function issueTokens(
  subjectOrOpts: string | { sub: string; address: string; eoa?: string; role: string },
  eoa?: string
): { accessToken: string; refreshToken: string } {
  const secret = getSecret();

  let payload: AccessTokenPayload;
  let refreshPayload: RefreshTokenPayload;

  if (typeof subjectOrOpts === 'string') {
    // Legacy: issueTokens(address, eoa?)
    payload = { sub: subjectOrOpts, eoa, type: 'access' };
    refreshPayload = { sub: subjectOrOpts, type: 'refresh' };
  } else {
    // New: issueTokens({ sub, address, eoa, role })
    payload = {
      sub: subjectOrOpts.sub,
      address: subjectOrOpts.address,
      eoa: subjectOrOpts.eoa,
      role: subjectOrOpts.role,
      type: 'access',
    };
    refreshPayload = { sub: subjectOrOpts.sub, type: 'refresh' };
  }

  const accessToken = jwt.sign(payload, secret, { expiresIn: '15m' });
  const refreshToken = jwt.sign(refreshPayload, secret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
  const secret = getSecret();
  const payload = jwt.verify(token, secret) as AccessTokenPayload & { iat: number; exp: number };
  if (payload.type !== 'access') throw new Error('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & { iat: number; exp: number } {
  const secret = getSecret();
  const payload = jwt.verify(token, secret) as RefreshTokenPayload & { iat: number; exp: number };
  if (payload.type !== 'refresh') throw new Error('Invalid token type');
  return payload;
}
