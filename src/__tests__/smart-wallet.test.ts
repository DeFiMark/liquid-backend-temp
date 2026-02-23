import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

import { registerSmartWallet, getSmartWalletAddress } from '../services/smart-wallet.js';

describe('Smart Wallet Service', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('registerSmartWallet', () => {
    it('stores smart wallet address for new user', async () => {
      mocks.mockSingle
        .mockResolvedValueOnce({ data: { smart_wallet_address: null }, error: null })
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });

      const result = await registerSmartWallet('user-1', '0xAbC1234567890abcdef1234567890abcDEF12345');
      expect(result).toBe('0xabc1234567890abcdef1234567890abcdef12345');
    });

    it('returns existing address if same (idempotent)', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { smart_wallet_address: '0xabc1234567890abcdef1234567890abcdef12345' },
        error: null,
      });

      const result = await registerSmartWallet('user-1', '0xAbC1234567890abcdef1234567890abcDEF12345');
      expect(result).toBe('0xabc1234567890abcdef1234567890abcdef12345');
    });

    it('rejects different address if already registered', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { smart_wallet_address: '0xexisting0000000000000000000000000000000' },
        error: null,
      });

      await expect(
        registerSmartWallet('user-1', '0xDifferent000000000000000000000000000000')
      ).rejects.toThrow('already registered');
    });

    it('rejects if address claimed by another user', async () => {
      mocks.mockSingle
        .mockResolvedValueOnce({ data: { smart_wallet_address: null }, error: null })
        .mockResolvedValueOnce({ data: { id: 'other-user' }, error: null });

      await expect(
        registerSmartWallet('user-1', '0xClaimed00000000000000000000000000000000')
      ).rejects.toThrow('already registered to another account');
    });
  });

  describe('getSmartWalletAddress', () => {
    it('returns address when set', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { smart_wallet_address: '0xabc123' },
        error: null,
      });

      const result = await getSmartWalletAddress('user-1');
      expect(result).toBe('0xabc123');
    });

    it('returns null when not set', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { smart_wallet_address: null },
        error: null,
      });

      const result = await getSmartWalletAddress('user-1');
      expect(result).toBeNull();
    });
  });
});
