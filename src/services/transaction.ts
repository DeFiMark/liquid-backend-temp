import { supabase } from '../lib/supabase.js';
import * as circle from '../lib/circle.js';

// Initiate a deposit — returns wire instructions for the user
export async function initiateDeposit(userId: string, amount: string): Promise<{
  transactionId: string;
  wireInstructions: any;
  memo: string;
}> {
  const instructions = await circle.getDepositInstructions();

  const memo = `LQ-${userId.slice(0, 8)}-${Date.now().toString(36)}`.toUpperCase();

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: 'deposit',
      amount: parseFloat(amount),
      currency: 'USD',
      status: 'pending',
      description: `Wire deposit - ref: ${memo}`,
      metadata: {
        wire_reference: memo,
        tracking_ref: instructions.trackingRef,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create transaction: ${error.message}`);

  return {
    transactionId: data.id,
    wireInstructions: {
      ...instructions,
      memo,
    },
    memo,
  };
}

// Initiate a withdrawal — sends USDC redemption + wire payout
export async function initiateWithdrawal(
  userId: string,
  amount: string,
  linkedAccountId: string
): Promise<{ transactionId: string }> {
  const { data: account, error: accountError } = await supabase
    .from('linked_accounts')
    .select('id, status')
    .eq('id', linkedAccountId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (accountError || !account) {
    throw new Error('Linked account not found or inactive');
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type: 'withdrawal',
      amount: parseFloat(amount),
      currency: 'USD',
      status: 'pending',
      description: `Withdrawal to linked account`,
      metadata: {
        linked_account_id: linkedAccountId,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create transaction: ${error.message}`);

  return { transactionId: data.id };
}

// Get transaction by ID (with ownership check)
export async function getTransaction(userId: string, transactionId: string): Promise<any> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, type, amount, currency, status, description, initiated_at, completed_at, created_at')
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

// Get transaction history for a user
export async function getTransactionHistory(
  userId: string,
  params?: { type?: string; status?: string; limit?: number; offset?: number }
): Promise<{ transactions: any[]; total: number }> {
  let query = supabase
    .from('transactions')
    .select('id, type, amount, currency, status, description, initiated_at, completed_at, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (params?.type) query = query.eq('type', params.type);
  if (params?.status) query = query.eq('status', params.status);
  if (params?.limit) query = query.limit(params.limit);
  if (params?.offset) query = query.range(params.offset, params.offset + (params.limit || 20) - 1);

  const { data, error, count } = await query;

  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

  return {
    transactions: data || [],
    total: count || 0,
  };
}

// Handle Circle deposit webhook
export async function handleCircleDeposit(event: any): Promise<void> {
  const transferId = event.transfer?.id;
  if (!transferId) return;

  const status = event.transfer?.status;
  const trackingRef = event.transfer?.trackingRef;

  if (trackingRef) {
    const { data: tx } = await supabase
      .from('transactions')
      .select('id')
      .eq('status', 'pending')
      .eq('type', 'deposit')
      .contains('metadata', { tracking_ref: trackingRef })
      .single();

    if (tx) {
      const updateData: any = {
        circle_transfer_id: transferId,
        status: status === 'complete' ? 'completed' : 'processing',
      };
      if (status === 'complete') {
        updateData.completed_at = new Date().toISOString();
      }

      await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', tx.id);
    }
  }
}

// Handle Circle payout webhook
export async function handleCirclePayout(event: any): Promise<void> {
  const payoutId = event.payout?.id;
  if (!payoutId) return;

  const status = event.payout?.status;

  const { data: tx } = await supabase
    .from('transactions')
    .select('id')
    .eq('circle_transfer_id', payoutId)
    .single();

  if (tx) {
    const updateData: any = {};

    switch (status) {
      case 'complete':
        updateData.status = 'completed';
        updateData.completed_at = new Date().toISOString();
        break;
      case 'failed':
        updateData.status = 'failed';
        updateData.failed_at = new Date().toISOString();
        break;
      default:
        updateData.status = 'processing';
    }

    await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', tx.id);
  }
}
