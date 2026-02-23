import jwt from 'jsonwebtoken';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return secret;
}

export interface AccessTokenPayload {
  sub: string;
  eoa?: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export function issueTokens(
  smartWalletAddress: string,
  eoa?: string
): { accessToken: string; refreshToken: string } {
  const secret = getSecret();

  const accessToken = jwt.sign(
    { sub: smartWalletAddress, eoa, type: 'access' } satisfies AccessTokenPayload,
    secret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { sub: smartWalletAddress, type: 'refresh' } satisfies RefreshTokenPayload,
    secret,
    { expiresIn: '7d' }
  );

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
