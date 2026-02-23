import { supabase } from '../lib/supabase.js';

/**
 * SMART WALLET FLOW
 * =================
 * 
 * 1. Frontend creates Thirdweb in-app wallet (EOA signer) + smart account
 * 2. SIWE message address = smart wallet address (the on-chain identity)
 * 3. Signature is ERC-6492 (pre-deployed) or EIP-1271 (deployed)
 * 4. viem verifyMessage handles both automatically
 * 5. Backend stores smart wallet as the PRIMARY identity
 * 6. EOA stored separately for audit trail only
 * 
 * The backend NEVER creates wallets. The frontend owns wallet creation
 * via Thirdweb SDK. The backend only stores and validates addresses.
 * 
 * SECURITY: Smart wallet address is IMMUTABLE after first registration.
 * A user cannot change their smart wallet. If they need to, contact support
 * (manual admin intervention required).
 */

/**
 * Register a smart wallet address for a user.
 * Called from POST /wallet/register after frontend creates the smart account.
 */
export async function registerSmartWallet(
  userId: string,
  smartWalletAddress: string
): Promise<string> {
  const normalized = smartWalletAddress.toLowerCase();

  // Check if user already has a smart wallet
  const { data: user } = await supabase
    .from('users')
    .select('smart_wallet_address')
    .eq('id', userId)
    .single();

  if (user?.smart_wallet_address) {
    if (user.smart_wallet_address === normalized) {
      return normalized; // Idempotent
    }
    throw new Error('Smart wallet already registered. Contact support to change.');
  }

  // Check no other user has claimed this smart wallet address
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('smart_wallet_address', normalized)
    .single();

  if (existing && existing.id !== userId) {
    throw new Error('This smart wallet address is already registered to another account');
  }

  // Store the smart wallet address
  const { error } = await supabase
    .from('users')
    .update({ smart_wallet_address: normalized })
    .eq('id', userId);

  if (error) throw new Error(`Failed to register smart wallet: ${error.message}`);

  return normalized;
}

/**
 * Get smart wallet address for a user.
 */
export async function getSmartWalletAddress(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('smart_wallet_address')
    .eq('id', userId)
    .single();

  return data?.smart_wallet_address || null;
}
