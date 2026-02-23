import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../lib/circle.js', () => ({
  getDepositInstructions: vi.fn().mockResolvedValue({
    trackingRef: 'TRK-ABC123',
    beneficiary: { name: 'Circle Internet Financial' },
    beneficiaryBank: { name: 'Test Bank', swiftCode: 'TESTUS00' },
  }),
}));

import {
  initiateDeposit,
  initiateWithdrawal,
  getTransaction,
  getTransactionHistory,
  handleCircleDeposit,
  handleCirclePayout,
} from '../services/transaction.js';

beforeEach(() => {
  resetMocks();
});

describe('Transaction Service', () => {
  describe('initiateDeposit', () => {
    it('creates transaction and returns wire instructions', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'tx-001' },
        error: null,
      });

      const result = await initiateDeposit('user-12345678-abcd', '1000.00');

      expect(result.transactionId).toBe('tx-001');
      expect(result.wireInstructions).toBeDefined();
      expect(result.wireInstructions.trackingRef).toBe('TRK-ABC123');
      expect(result.memo).toMatch(/^LQ-USER-123/);
      expect(mocks.mockFrom).toHaveBeenCalledWith('transactions');
      expect(mocks.mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'deposit',
          amount: 1000,
          currency: 'USD',
          status: 'pending',
        }),
      );
    });

    it('throws on insert error', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error' },
      });

      await expect(initiateDeposit('user-123', '500.00'))
        .rejects.toThrow('Failed to create transaction');
    });
  });

  describe('initiateWithdrawal', () => {
    it('creates transaction with ownership check', async () => {
      // First single() — linked account lookup
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'acct-1', status: 'active' },
        error: null,
      });
      // Second single() — transaction insert
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'tx-002' },
        error: null,
      });

      const result = await initiateWithdrawal('user-123', '500.00', 'acct-1');

      expect(result.transactionId).toBe('tx-002');
      expect(mocks.mockFrom).toHaveBeenCalledWith('linked_accounts');
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mocks.mockEq).toHaveBeenCalledWith('status', 'active');
    });

    it('rejects inactive account', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      await expect(initiateWithdrawal('user-123', '500.00', 'acct-bad'))
        .rejects.toThrow('Linked account not found or inactive');
    });
  });

  describe('getTransaction', () => {
    it('returns transaction with ownership check', async () => {
      const txData = {
        id: 'tx-001',
        type: 'deposit',
        amount: 1000,
        currency: 'USD',
        status: 'completed',
        description: 'Wire deposit',
        initiated_at: null,
        completed_at: '2024-01-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      };

      mocks.mockSingle.mockResolvedValueOnce({ data: txData, error: null });

      const result = await getTransaction('user-123', 'tx-001');

      expect(result).toEqual(txData);
      expect(mocks.mockEq).toHaveBeenCalledWith('id', 'tx-001');
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('returns null when not found', async () => {
      mocks.mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

      const result = await getTransaction('user-123', 'tx-999');
      expect(result).toBeNull();
    });
  });

  describe('getTransactionHistory', () => {
    it('returns transactions with filters', async () => {
      const mockData = [
        { id: 'tx-1', type: 'deposit', amount: 1000, currency: 'USD', status: 'completed' },
      ];

      // The chain ends without single(), so we need to mock the final return
      mocks.mockLimit.mockResolvedValueOnce({
        data: mockData,
        error: null,
        count: 1,
      });

      const result = await getTransactionHistory('user-123', {
        type: 'deposit',
        limit: 10,
      });

      expect(result.transactions).toEqual(mockData);
      expect(result.total).toBe(1);
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mocks.mockEq).toHaveBeenCalledWith('type', 'deposit');
    });
  });

  describe('handleCircleDeposit', () => {
    it('updates transaction on complete', async () => {
      // single() for finding the tx, then eq() at end of update chain
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'tx-001' },
        error: null,
      });

      await handleCircleDeposit({
        transfer: {
          id: 'circle-transfer-1',
          status: 'complete',
          trackingRef: 'TRK-ABC',
          amount: { amount: '1000.00', currency: 'USD' },
        },
      });

      expect(mocks.mockContains).toHaveBeenCalledWith('metadata', { tracking_ref: 'TRK-ABC' });
      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          circle_transfer_id: 'circle-transfer-1',
        }),
      );
    });

    it('skips when no transfer id', async () => {
      await handleCircleDeposit({ transfer: {} });
      expect(mocks.mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('handleCirclePayout', () => {
    it('updates transaction on complete', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'tx-002' },
        error: null,
      });

      await handleCirclePayout({
        payout: {
          id: 'payout-1',
          status: 'complete',
        },
      });

      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });

    it('updates transaction on failed', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: 'tx-003' },
        error: null,
      });

      await handleCirclePayout({
        payout: {
          id: 'payout-2',
          status: 'failed',
        },
      });

      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });

    it('skips when no payout id', async () => {
      await handleCirclePayout({ payout: {} });
      expect(mocks.mockFrom).not.toHaveBeenCalled();
    });
  });
});
