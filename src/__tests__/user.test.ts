import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

import { findUserByAddress, createUser, updateUserProfile, getUserProfile } from '../services/user.js';

const mockUser = {
  id: 'uuid-1',
  wallet_address: '0xabc123',
  smart_wallet_address: null,
  status: 'active',
  role: 'investor',
  email: null,
  profile_data: {},
  terms_accepted_at: null,
  privacy_accepted_at: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

describe('User Service', () => {
  beforeEach(() => resetMocks());

  it('findUserByAddress returns user', async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: mockUser, error: null });
    const user = await findUserByAddress('0xABC123');
    expect(user).toEqual(mockUser);
    expect(mocks.mockFrom).toHaveBeenCalledWith('users');
  });

  it('findUserByAddress returns null for unknown', async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: null, error: null });
    const user = await findUserByAddress('0x000000');
    expect(user).toBeNull();
  });

  it('createUser creates and returns user', async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: mockUser, error: null });
    const user = await createUser('0xABC123');
    expect(user).toEqual(mockUser);
    expect(mocks.mockInsert).toHaveBeenCalledWith({
      wallet_address: '0xabc123',
      status: 'active',
    });
  });

  it('createUser throws on error', async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'duplicate' } });
    await expect(createUser('0xABC123')).rejects.toThrow('Failed to create user');
  });

  it('updateUserProfile updates fields', async () => {
    const updated = { ...mockUser, email: 'test@example.com' };
    mocks.mockSingle.mockResolvedValueOnce({ data: updated, error: null });
    const user = await updateUserProfile('uuid-1', { email: 'test@example.com' });
    expect(user.email).toBe('test@example.com');
  });

  it('getUserProfile includes KYC and accreditation', async () => {
    const userWithRelations = {
      ...mockUser,
      kyc_records: [{ id: 'kyc-1', status: 'approved', verified_at: '2024-01-01', expires_at: null }],
      accreditation_records: [{ id: 'acc-1', status: 'approved', method: 'income', verified_at: '2024-01-01', expires_at: null }],
    };
    mocks.mockSingle.mockResolvedValueOnce({ data: userWithRelations, error: null });
    const profile = await getUserProfile('uuid-1');
    expect(profile.kyc).toEqual(userWithRelations.kyc_records[0]);
    expect(profile.accreditation).toEqual(userWithRelations.accreditation_records[0]);
  });
});
