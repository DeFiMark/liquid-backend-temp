import { plaidClient } from '../lib/plaid.js';
import { supabase } from '../lib/supabase.js';

export async function initiateKYC(userId: string, userEmail?: string): Promise<{
  linkToken: string;
  idvId: string;
}> {
  const { data: existing } = await supabase
    .from('kyc_records')
    .select('id, status, plaid_idv_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'submitted', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing?.status === 'approved') {
    throw new Error('KYC already approved');
  }

  const response = await plaidClient.identityVerificationCreate({
    client_user_id: userId,
    is_shareable: false,
    template_id: process.env.PLAID_IDV_TEMPLATE_ID || 'idvtmp_default',
    gave_consent: true,
    ...(userEmail ? { user: { email_address: userEmail } } : {}),
  });

  const idvId = response.data.id;

  if (existing) {
    await supabase
      .from('kyc_records')
      .update({
        plaid_idv_id: idvId,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('kyc_records')
      .insert({
        user_id: userId,
        plaid_idv_id: idvId,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      });
  }

  const linkResponse = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Liquid',
    products: ['identity_verification'],
    identity_verification: {
      template_id: process.env.PLAID_IDV_TEMPLATE_ID || 'idvtmp_default',
    },
    country_codes: ['US'] as any,
    language: 'en',
  });

  return {
    linkToken: linkResponse.data.link_token,
    idvId,
  };
}

export async function getKYCStatus(userId: string): Promise<{
  status: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
} | null> {
  const { data } = await supabase
    .from('kyc_records')
    .select('status, verified_at, expires_at, rejection_reason')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    status: data.status,
    verifiedAt: data.verified_at,
    expiresAt: data.expires_at,
    rejectionReason: data.rejection_reason,
  };
}

export async function handleIDVWebhook(webhookType: string, webhookCode: string, body: any): Promise<void> {
  if (webhookType !== 'IDENTITY_VERIFICATION') return;

  const idvId = body.identity_verification_id;
  if (!idvId) return;

  let newStatus: string;
  let rejectionReason: string | null = null;

  switch (webhookCode) {
    case 'STATUS_UPDATED': {
      const response = await plaidClient.identityVerificationGet({
        identity_verification_id: idvId,
      });

      const plaidStatus = response.data.status;

      switch (plaidStatus) {
        case 'success':
          newStatus = 'approved';
          break;
        case 'failed':
          newStatus = 'rejected';
          rejectionReason = 'Verification failed';
          break;
        case 'expired':
          newStatus = 'expired';
          break;
        case 'pending_review':
          newStatus = 'submitted';
          break;
        case 'active':
          newStatus = 'submitted';
          break;
        default:
          newStatus = 'pending';
      }
      break;
    }
    default:
      return;
  }

  const updateData: any = {
    status: newStatus,
    metadata: { last_webhook: webhookCode, updated_at: new Date().toISOString() },
  };

  if (newStatus === 'approved') {
    updateData.verified_at = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    updateData.expires_at = expiresAt.toISOString();
  }

  if (rejectionReason) {
    updateData.rejection_reason = rejectionReason;
  }

  await supabase
    .from('kyc_records')
    .update(updateData)
    .eq('plaid_idv_id', idvId);

  if (newStatus === 'approved') {
    const { data: kycRecord } = await supabase
      .from('kyc_records')
      .select('user_id')
      .eq('plaid_idv_id', idvId)
      .single();

    if (kycRecord) {
      await supabase
        .from('users')
        .update({ status: 'active' })
        .eq('id', kycRecord.user_id)
        .eq('status', 'pending');
    }
  }
}
