import { describe, it, expect } from 'vitest';
import { challengeQuerySchema, verifyBodySchema, refreshBodySchema } from '../schemas/auth.js';
import { updateProfileSchema } from '../schemas/user.js';

describe('Auth Schemas', () => {
  describe('challengeQuerySchema', () => {
    it('accepts valid address', () => {
      const result = challengeQuerySchema.safeParse({ address: '0x1234567890abcdef1234567890abcdef12345678' });
      expect(result.success).toBe(true);
    });

    it('rejects short address', () => {
      const result = challengeQuerySchema.safeParse({ address: '0x1234' });
      expect(result.success).toBe(false);
    });

    it('rejects missing 0x prefix', () => {
      const result = challengeQuerySchema.safeParse({ address: '1234567890abcdef1234567890abcdef12345678' });
      expect(result.success).toBe(false);
    });

    it('rejects missing address', () => {
      const result = challengeQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('verifyBodySchema', () => {
    it('accepts valid body', () => {
      const result = verifyBodySchema.safeParse({ message: 'hello', signature: '0xabc' });
      expect(result.success).toBe(true);
    });

    it('rejects empty message', () => {
      const result = verifyBodySchema.safeParse({ message: '', signature: '0xabc' });
      expect(result.success).toBe(false);
    });

    it('rejects signature without 0x', () => {
      const result = verifyBodySchema.safeParse({ message: 'hello', signature: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('refreshBodySchema', () => {
    it('accepts valid token', () => {
      const result = refreshBodySchema.safeParse({ refreshToken: 'some-token' });
      expect(result.success).toBe(true);
    });

    it('rejects empty token', () => {
      const result = refreshBodySchema.safeParse({ refreshToken: '' });
      expect(result.success).toBe(false);
    });
  });
});

describe('User Schemas', () => {
  describe('updateProfileSchema', () => {
    it('accepts valid email', () => {
      const result = updateProfileSchema.safeParse({ email: 'test@example.com' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = updateProfileSchema.safeParse({ email: 'not-an-email' });
      expect(result.success).toBe(false);
    });

    it('accepts empty body', () => {
      const result = updateProfileSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts profile_data object', () => {
      const result = updateProfileSchema.safeParse({ profile_data: { name: 'Test' } });
      expect(result.success).toBe(true);
    });

    it('accepts boolean flags', () => {
      const result = updateProfileSchema.safeParse({ terms_accepted: true, privacy_accepted: true });
      expect(result.success).toBe(true);
    });
  });
});
