import { supabase } from '../lib/supabase.js';

export interface User {
  id: string;
  wallet_address: string;
  smart_wallet_address: string | null;
  status: string;
  role: string;
  email: string | null;
  profile_data: Record<string, any>;
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findUserByAddress(address: string): Promise<User | null> {
  const normalized = address.toLowerCase();

  const { data } = await supabase
    .from('users')
    .select('*')
    .or(`wallet_address.ilike.${normalized},smart_wallet_address.ilike.${normalized}`)
    .single();

  return data;
}

export async function findUserById(id: string): Promise<User | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  return data;
}

export async function createUser(walletAddress: string): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .insert({
      wallet_address: walletAddress.toLowerCase(),
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return data;
}

export async function updateUserProfile(
  userId: string,
  updates: {
    email?: string;
    profile_data?: Record<string, any>;
    terms_accepted_at?: string;
    privacy_accepted_at?: string;
  }
): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update profile: ${error.message}`);
  return data;
}

export async function setSmartWalletAddress(userId: string, smartWalletAddress: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ smart_wallet_address: smartWalletAddress.toLowerCase() })
    .eq('id', userId);

  if (error) throw new Error(`Failed to set smart wallet: ${error.message}`);
}

export async function getUserProfile(userId: string): Promise<any> {
  const { data: user, error } = await supabase
    .from('users')
    .select(`
      *,
      kyc_records(id, status, verified_at, expires_at),
      accreditation_records(id, status, method, verified_at, expires_at)
    `)
    .eq('id', userId)
    .single();

  if (error) throw new Error(`User not found: ${error.message}`);

  return {
    ...user,
    kyc: user.kyc_records?.[0] || null,
    accreditation: user.accreditation_records?.[0] || null,
  };
}
