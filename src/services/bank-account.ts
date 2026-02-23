import { plaidClient } from '../lib/plaid.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { supabase } from '../lib/supabase.js';

export async function createLinkToken(userId: string): Promise<string> {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Liquid',
    products: ['auth'] as any,
    country_codes: ['US'] as any,
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL || 'https://api.getliquid.io/webhooks/plaid',
  });
  return response.data.link_token;
}

export async function exchangeAndStoreAccount(
  userId: string,
  publicToken: string,
  accountId: string,
  institution: { id: string; name: string }
): Promise<{ id: string }> {
  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId = exchangeResponse.data.item_id;

  const accountsResponse = await plaidClient.accountsGet({
    access_token: accessToken,
  });

  const account = accountsResponse.data.accounts.find((a: any) => a.account_id === accountId);
  if (!account) throw new Error('Account not found in Plaid response');

  if (!['checking', 'savings'].includes(account.subtype || '')) {
    throw new Error('Only checking and savings accounts are supported');
  }

  const encryptedAccessToken = encrypt(accessToken);

  const { data, error } = await supabase
    .from('linked_accounts')
    .insert({
      user_id: userId,
      plaid_item_id: itemId,
      plaid_access_token_encrypted: encryptedAccessToken,
      plaid_account_id: accountId,
      institution_name: institution.name,
      institution_id: institution.id,
      account_name: account.name || account.official_name || 'Account',
      account_mask: account.mask || '****',
      account_type: account.type,
      account_subtype: account.subtype || null,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to store account: ${error.message}`);
  return { id: data.id };
}

export async function createProcessorToken(
  linkedAccountId: string,
  processor: string = 'circle'
): Promise<string> {
  const { data: account, error } = await supabase
    .from('linked_accounts')
    .select('plaid_access_token_encrypted, plaid_account_id')
    .eq('id', linkedAccountId)
    .eq('status', 'active')
    .single();

  if (error || !account) throw new Error('Linked account not found or inactive');

  const accessToken = decrypt(account.plaid_access_token_encrypted);

  const response = await plaidClient.processorTokenCreate({
    access_token: accessToken,
    account_id: account.plaid_account_id,
    processor: processor as any,
  });

  await supabase
    .from('linked_accounts')
    .update({ processor_token: response.data.processor_token })
    .eq('id', linkedAccountId);

  return response.data.processor_token;
}

export async function getUserAccounts(userId: string): Promise<Array<{
  id: string;
  institution_name: string;
  account_name: string;
  account_mask: string;
  account_type: string;
  account_subtype: string | null;
  status: string;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('linked_accounts')
    .select('id, institution_name, account_name, account_mask, account_type, account_subtype, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch accounts: ${error.message}`);
  return data || [];
}

export async function deactivateAccount(userId: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('linked_accounts')
    .update({ status: 'inactive' })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to deactivate account: ${error.message}`);
}

export async function handleItemWebhook(webhookCode: string, body: any): Promise<void> {
  const itemId = body.item_id;
  if (!itemId) return;

  switch (webhookCode) {
    case 'ERROR': {
      const errorCode = body.error?.error_code || 'UNKNOWN';
      await supabase
        .from('linked_accounts')
        .update({ status: 'error', error_code: errorCode })
        .eq('plaid_item_id', itemId);
      break;
    }
    case 'PENDING_EXPIRATION': {
      await supabase
        .from('linked_accounts')
        .update({ status: 'error', error_code: 'PENDING_EXPIRATION' })
        .eq('plaid_item_id', itemId);
      break;
    }
  }
}

export async function getAccountById(userId: string, accountId: string): Promise<any> {
  const { data, error } = await supabase
    .from('linked_accounts')
    .select('id, institution_name, account_name, account_mask, account_type, account_subtype, status, created_at')
    .eq('id', accountId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}
