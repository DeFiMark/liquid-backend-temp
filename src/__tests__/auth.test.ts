import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateChallenge, consumeNonce, _getNonceStore } from '../auth/challenge.js';
import { issueTokens, verifyAccessToken, verifyRefreshToken } from '../auth/jwt.js';

// Set env for tests
process.env.JWT_SECRET = 'test-secret-key-for-vitest';
process.env.APP_DOMAIN = 'localhost';

describe('Challenge', () => {
  beforeEach(() => {
    _getNonceStore().clear();
  });

  it('generates a challenge with nonce and timestamps', () => {
    const result = generateChallenge('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.nonce).toBeDefined();
    expect(result.issuedAt).toBeDefined();
    expect(result.expirationTime).toBeDefined();
    expect(new Date(result.expirationTime).getTime()).toBeGreaterThan(new Date(result.issuedAt).getTime());
  });

  it('nonce is single-use', () => {
    const { nonce } = generateChallenge('0x1234567890abcdef1234567890abcdef12345678');
    const first = consumeNonce(nonce);
    expect(first).not.toBeNull();
    const second = consumeNonce(nonce);
    expect(second).toBeNull();
  });

  it('expired nonce returns null', () => {
    vi.useFakeTimers();
    const { nonce } = generateChallenge('0x1234567890abcdef1234567890abcdef12345678');

    // Advance 6 minutes
    vi.advanceTimersByTime(6 * 60 * 1000);

    const result = consumeNonce(nonce);
    expect(result).toBeNull();
    vi.useRealTimers();
  });
});

describe('JWT', () => {
  it('issues and verifies access token', () => {
    const { accessToken } = issueTokens('0xabc123', '0xeoa456');
    const payload = verifyAccessToken(accessToken);
    expect(payload.sub).toBe('0xabc123');
    expect(payload.eoa).toBe('0xeoa456');
    expect(payload.type).toBe('access');
  });

  it('issues and verifies refresh token', () => {
    const { refreshToken } = issueTokens('0xabc123');
    const payload = verifyRefreshToken(refreshToken);
    expect(payload.sub).toBe('0xabc123');
    expect(payload.type).toBe('refresh');
  });

  it('rejects expired access token', () => {
    vi.useFakeTimers();
    const { accessToken } = issueTokens('0xabc123');

    // Advance 16 minutes
    vi.advanceTimersByTime(16 * 60 * 1000);

    expect(() => verifyAccessToken(accessToken)).toThrow();
    vi.useRealTimers();
  });

  it('refresh token flow — issue new tokens from refresh', () => {
    const { refreshToken } = issueTokens('0xabc123');
    const payload = verifyRefreshToken(refreshToken);
    const newTokens = issueTokens(payload.sub);
    expect(newTokens.accessToken).toBeDefined();
    expect(newTokens.refreshToken).toBeDefined();
    const newPayload = verifyAccessToken(newTokens.accessToken);
    expect(newPayload.sub).toBe('0xabc123');
  });

  it('rejects access token used as refresh', () => {
    const { accessToken } = issueTokens('0xabc123');
    expect(() => verifyRefreshToken(accessToken)).toThrow('Invalid token type');
  });
});

describe('Address validation', () => {
  it('valid address format', () => {
    const valid = /^0x[0-9a-fA-F]{40}$/.test('0x1234567890abcdef1234567890abcdef12345678');
    expect(valid).toBe(true);
  });

  it('rejects short address', () => {
    const valid = /^0x[0-9a-fA-F]{40}$/.test('0x1234');
    expect(valid).toBe(false);
  });

  it('rejects missing 0x prefix', () => {
    const valid = /^0x[0-9a-fA-F]{40}$/.test('1234567890abcdef1234567890abcdef12345678');
    expect(valid).toBe(false);
  });
});
