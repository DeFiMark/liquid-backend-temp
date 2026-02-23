import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must import after stubbing fetch
import {
  getConfiguration,
  getWalletBalance,
  createPayout,
  getPayoutStatus,
  listDeposits,
  listPayouts,
  getDepositInstructions,
  createWireBankAccount,
  getTransferStatus,
} from '../lib/circle.js';

function mockResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  process.env.CIRCLE_API_KEY = 'test-key';
  process.env.CIRCLE_ENV = 'sandbox';
});

describe('Circle Client', () => {
  describe('getConfiguration', () => {
    it('returns masterWalletId', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { payments: { masterWalletId: '1017371608' } },
      }));

      const result = await getConfiguration();
      expect(result).toEqual({ masterWalletId: '1017371608' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api-sandbox.circle.com/v1/configuration',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getWalletBalance', () => {
    it('returns balances array', async () => {
      // First call: getConfiguration
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { payments: { masterWalletId: '1017371608' } },
      }));
      // Second call: getWalletBalance
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { available: [{ amount: '5000.00', currency: 'USD' }] },
      }));

      const result = await getWalletBalance();
      expect(result).toEqual([{ amount: '5000.00', currency: 'USD' }]);
    });
  });

  describe('createPayout', () => {
    it('makes correct API call', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { id: 'payout-123', status: 'pending' },
      }));

      const result = await createPayout({
        amount: '1000.00',
        currency: 'USD',
        destinationBankAccountId: 'bank-456',
        memo: 'test@example.com',
      });

      expect(result).toEqual({ id: 'payout-123', status: 'pending' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api-sandbox.circle.com/v1/businessAccount/payouts',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"amount":"1000.00"'),
        }),
      );
    });
  });

  describe('getPayoutStatus', () => {
    it('fetches status', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: {
          id: 'payout-123',
          status: 'complete',
          amount: { amount: '1000.00', currency: 'USD' },
          createDate: '2024-01-01T00:00:00Z',
        },
      }));

      const result = await getPayoutStatus('payout-123');
      expect(result.status).toBe('complete');
      expect(result.id).toBe('payout-123');
    });
  });

  describe('error handling', () => {
    it('throws on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ message: 'Invalid token' }),
      });

      await expect(getConfiguration()).rejects.toThrow('Circle API error 401');
    });

    it('handles json parse failure on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('parse error')),
      });

      await expect(getConfiguration()).rejects.toThrow('Circle API error 500');
    });
  });

  describe('getDepositInstructions', () => {
    it('returns deposit instructions', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: {
          trackingRef: 'TRK-123',
          beneficiary: { name: 'Circle' },
          beneficiaryBank: { name: 'Test Bank' },
        },
      }));

      const result = await getDepositInstructions();
      expect(result.trackingRef).toBe('TRK-123');
    });
  });

  describe('listDeposits', () => {
    it('returns deposits list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: [{ id: 'dep-1' }],
      }));

      const result = await listDeposits({ pageSize: 10 });
      expect(result).toEqual([{ id: 'dep-1' }]);
    });
  });

  describe('listPayouts', () => {
    it('returns payouts list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: [{ id: 'pay-1' }],
      }));

      const result = await listPayouts({ pageSize: 10 });
      expect(result).toEqual([{ id: 'pay-1' }]);
    });
  });
});
