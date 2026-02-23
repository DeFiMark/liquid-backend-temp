import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../lib/plaid.js', () => ({
  plaidClient: {
    identityVerificationCreate: vi.fn(),
    identityVerificationGet: vi.fn(),
    linkTokenCreate: vi.fn(),
  },
}));

import { initiateKYC, getKYCStatus, handleIDVWebhook } from '../services/kyc.js';
import { plaidClient } from '../lib/plaid.js';

const mockPlaid = plaidClient as any;

describe('KYC Service', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('initiateKYC', () => {
    it('creates a new KYC record', async () => {
      // single() for the existing check returns null
      mocks.mockSingle.mockResolvedValueOnce({ data: null, error: null });
      mockPlaid.identityVerificationCreate.mockResolvedValueOnce({
        data: { id: 'idv_123' },
      });
      // insert returns a thenable that resolves
      mocks.mockInsert.mockResolvedValueOnce({ data: null, error: null });
      mockPlaid.linkTokenCreate.mockResolvedValueOnce({
        data: { link_token: 'link-token-abc' },
      });

      const result = await initiateKYC('user-1', 'test@example.com');
      expect(result.linkToken).toBe('link-token-abc');
      expect(result.idvId).toBe('idv_123');
      expect(mocks.mockFrom).toHaveBeenCalledWith('kyc_records');
    });

    it('throws if KYC already approved', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { id: '1', status: 'approved', plaid_idv_id: 'idv_old' },
        error: null,
      });

      await expect(initiateKYC('user-1')).rejects.toThrow('KYC already approved');
    });
  });

  describe('getKYCStatus', () => {
    it('returns status when record exists', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: {
          status: 'approved',
          verified_at: '2026-01-01',
          expires_at: '2027-01-01',
          rejection_reason: null,
        },
        error: null,
      });

      const result = await getKYCStatus('user-1');
      expect(result).toEqual({
        status: 'approved',
        verifiedAt: '2026-01-01',
        expiresAt: '2027-01-01',
        rejectionReason: null,
      });
    });

    it('returns null for unknown user', async () => {
      mocks.mockSingle.mockResolvedValueOnce({ data: null, error: null });
      const result = await getKYCStatus('unknown');
      expect(result).toBeNull();
    });
  });

  describe('handleIDVWebhook', () => {
    it('updates status on success', async () => {
      mockPlaid.identityVerificationGet.mockResolvedValueOnce({
        data: { status: 'success' },
      });
      // single() called for select user_id after approval
      mocks.mockSingle.mockResolvedValueOnce({
        data: { user_id: 'user-1' },
        error: null,
      });

      await handleIDVWebhook('IDENTITY_VERIFICATION', 'STATUS_UPDATED', {
        identity_verification_id: 'idv_123',
      });

      expect(mockPlaid.identityVerificationGet).toHaveBeenCalledWith({
        identity_verification_id: 'idv_123',
      });
      expect(mocks.mockUpdate).toHaveBeenCalled();
    });

    it('updates status on failure', async () => {
      mockPlaid.identityVerificationGet.mockResolvedValueOnce({
        data: { status: 'failed' },
      });

      await handleIDVWebhook('IDENTITY_VERIFICATION', 'STATUS_UPDATED', {
        identity_verification_id: 'idv_456',
      });

      expect(mocks.mockUpdate).toHaveBeenCalled();
    });

    it('ignores non-IDV webhook types', async () => {
      await handleIDVWebhook('OTHER_TYPE', 'STATUS_UPDATED', {});
      expect(mockPlaid.identityVerificationGet).not.toHaveBeenCalled();
    });

    it('ignores non-STATUS_UPDATED codes', async () => {
      await handleIDVWebhook('IDENTITY_VERIFICATION', 'OTHER_CODE', {
        identity_verification_id: 'idv_789',
      });
      expect(mockPlaid.identityVerificationGet).not.toHaveBeenCalled();
    });
  });
});
