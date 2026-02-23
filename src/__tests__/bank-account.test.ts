import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

vi.mock('../lib/plaid.js', () => ({
  plaidClient: {
    linkTokenCreate: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
    accountsGet: vi.fn(),
    processorTokenCreate: vi.fn(),
  },
}));

vi.mock('../lib/encryption.js', () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted:', '')),
}));

import {
  createLinkToken,
  exchangeAndStoreAccount,
  createProcessorToken,
  getUserAccounts,
  deactivateAccount,
  handleItemWebhook,
  getAccountById,
} from '../services/bank-account.js';
import { plaidClient } from '../lib/plaid.js';
import { encrypt, decrypt } from '../lib/encryption.js';

describe('Bank Account Service', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('createLinkToken', () => {
    it('calls plaidClient.linkTokenCreate and returns link_token', async () => {
      (plaidClient.linkTokenCreate as any).mockResolvedValue({
        data: { link_token: 'link-token-123' },
      });

      const result = await createLinkToken('user-1');

      expect(plaidClient.linkTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { client_user_id: 'user-1' },
          client_name: 'Liquid',
          products: ['auth'],
          country_codes: ['US'],
          language: 'en',
        })
      );
      expect(result).toBe('link-token-123');
    });
  });

  describe('exchangeAndStoreAccount', () => {
    const setup = (subtype = 'checking') => {
      (plaidClient.itemPublicTokenExchange as any).mockResolvedValue({
        data: { access_token: 'access-token-abc', item_id: 'item-1' },
      });
      (plaidClient.accountsGet as any).mockResolvedValue({
        data: {
          accounts: [{
            account_id: 'acct-1',
            name: 'My Checking',
            official_name: 'Official Checking',
            mask: '1234',
            type: 'depository',
            subtype,
          }],
        },
      });
      mocks.mockSingle.mockResolvedValue({ data: { id: 'linked-1' }, error: null });
    };

    it('exchanges token, encrypts access token, stores in DB', async () => {
      setup();

      const result = await exchangeAndStoreAccount(
        'user-1', 'public-token', 'acct-1', { id: 'inst-1', name: 'Chase' }
      );

      expect(plaidClient.itemPublicTokenExchange).toHaveBeenCalledWith({ public_token: 'public-token' });
      expect(plaidClient.accountsGet).toHaveBeenCalledWith({ access_token: 'access-token-abc' });
      expect(encrypt).toHaveBeenCalledWith('access-token-abc');
      expect(mocks.mockFrom).toHaveBeenCalledWith('linked_accounts');
      expect(mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        plaid_item_id: 'item-1',
        plaid_access_token_encrypted: 'encrypted:access-token-abc',
        plaid_account_id: 'acct-1',
        institution_name: 'Chase',
        institution_id: 'inst-1',
        account_name: 'My Checking',
        account_mask: '1234',
        account_type: 'depository',
        account_subtype: 'checking',
        status: 'active',
      }));
      expect(result).toEqual({ id: 'linked-1' });
    });

    it('rejects non-checking/savings accounts', async () => {
      setup('credit card');

      await expect(
        exchangeAndStoreAccount('user-1', 'public-token', 'acct-1', { id: 'inst-1', name: 'Chase' })
      ).rejects.toThrow('Only checking and savings accounts are supported');
    });
  });

  describe('createProcessorToken', () => {
    it('decrypts access token, calls Plaid, stores processor token', async () => {
      mocks.mockSingle.mockResolvedValue({
        data: { plaid_access_token_encrypted: 'encrypted:access-token-abc', plaid_account_id: 'acct-1' },
        error: null,
      });
      (plaidClient.processorTokenCreate as any).mockResolvedValue({
        data: { processor_token: 'processor-token-xyz' },
      });

      const result = await createProcessorToken('linked-1');

      expect(decrypt).toHaveBeenCalledWith('encrypted:access-token-abc');
      expect(plaidClient.processorTokenCreate).toHaveBeenCalledWith({
        access_token: 'access-token-abc',
        account_id: 'acct-1',
        processor: 'circle',
      });
      expect(mocks.mockUpdate).toHaveBeenCalledWith({ processor_token: 'processor-token-xyz' });
      expect(result).toBe('processor-token-xyz');
    });
  });

  describe('getUserAccounts', () => {
    it('returns list without sensitive fields', async () => {
      const accounts = [
        { id: '1', institution_name: 'Chase', account_name: 'Checking', account_mask: '1234', account_type: 'depository', account_subtype: 'checking', status: 'active', created_at: '2024-01-01' },
      ];
      mocks.mockOrder.mockResolvedValue({ data: accounts, error: null });

      const result = await getUserAccounts('user-1');

      expect(mocks.mockFrom).toHaveBeenCalledWith('linked_accounts');
      expect(mocks.mockSelect).toHaveBeenCalledWith('id, institution_name, account_name, account_mask, account_type, account_subtype, status, created_at');
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(result).toEqual(accounts);
    });
  });

  describe('deactivateAccount', () => {
    it('updates status to inactive', async () => {
      await deactivateAccount('user-1', 'acct-1');

      expect(mocks.mockUpdate).toHaveBeenCalledWith({ status: 'inactive' });
      expect(mocks.mockEq).toHaveBeenCalledWith('id', 'acct-1');
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    });
  });

  describe('handleItemWebhook', () => {
    it('ERROR: marks account as error', async () => {
      await handleItemWebhook('ERROR', {
        item_id: 'item-1',
        error: { error_code: 'ITEM_LOGIN_REQUIRED' },
      });

      expect(mocks.mockUpdate).toHaveBeenCalledWith({ status: 'error', error_code: 'ITEM_LOGIN_REQUIRED' });
      expect(mocks.mockEq).toHaveBeenCalledWith('plaid_item_id', 'item-1');
    });

    it('PENDING_EXPIRATION: marks account for re-linking', async () => {
      await handleItemWebhook('PENDING_EXPIRATION', { item_id: 'item-1' });

      expect(mocks.mockUpdate).toHaveBeenCalledWith({ status: 'error', error_code: 'PENDING_EXPIRATION' });
      expect(mocks.mockEq).toHaveBeenCalledWith('plaid_item_id', 'item-1');
    });
  });

  describe('getAccountById', () => {
    it('returns account with ownership check', async () => {
      const account = { id: '1', institution_name: 'Chase', account_name: 'Checking', account_mask: '1234', account_type: 'depository', account_subtype: 'checking', status: 'active', created_at: '2024-01-01' };
      mocks.mockSingle.mockResolvedValue({ data: account, error: null });

      const result = await getAccountById('user-1', 'acct-1');

      expect(mocks.mockEq).toHaveBeenCalledWith('id', 'acct-1');
      expect(mocks.mockEq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(result).toEqual(account);
    });

    it('returns null for wrong user', async () => {
      mocks.mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      const result = await getAccountById('wrong-user', 'acct-1');

      expect(result).toBeNull();
    });
  });
});
