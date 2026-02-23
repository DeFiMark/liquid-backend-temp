import crypto from 'crypto';

const CIRCLE_BASE_URL = process.env.CIRCLE_ENV === 'production'
  ? 'https://api.circle.com'
  : 'https://api-sandbox.circle.com';

async function circleRequest(method: string, path: string, body?: any): Promise<any> {
  const url = `${CIRCLE_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`Circle API error ${response.status}: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// Generate idempotency key
function idempotencyKey(): string {
  return crypto.randomUUID();
}

// Get master wallet configuration
export async function getConfiguration(): Promise<{ masterWalletId: string }> {
  const res = await circleRequest('GET', '/v1/configuration');
  return { masterWalletId: res.data.payments.masterWalletId };
}

// Get master wallet balance
export async function getWalletBalance(): Promise<Array<{ amount: string; currency: string }>> {
  const config = await getConfiguration();
  const res = await circleRequest('GET', `/v1/wallets/${config.masterWalletId}/balances`);
  return res.data.available || [];
}

// Create a wire bank account (for payouts to users)
export async function createWireBankAccount(params: {
  accountNumber: string;
  routingNumber: string;
  billingDetails: {
    name: string;
    line1: string;
    city: string;
    postalCode: string;
    district: string;
    country: string;
  };
  bankAddress: {
    bankName: string;
    city: string;
    country: string;
  };
}): Promise<{ id: string; status: string }> {
  const res = await circleRequest('POST', '/v1/businessAccount/banks/wires', {
    idempotencyKey: idempotencyKey(),
    accountNumber: params.accountNumber,
    routingNumber: params.routingNumber,
    billingDetails: params.billingDetails,
    bankAddress: params.bankAddress,
  });
  return { id: res.data.id, status: res.data.status };
}

// Get wire deposit instructions (VAN for receiving deposits)
export async function getDepositInstructions(): Promise<{
  trackingRef: string;
  beneficiary: any;
  beneficiaryBank: any;
}> {
  const res = await circleRequest('POST', '/v1/businessAccount/wallets/addresses/deposit', {
    idempotencyKey: idempotencyKey(),
    currency: 'USD',
    chain: 'wire',
  });
  return res.data;
}

// Create a payout (send USD wire to user's bank)
export async function createPayout(params: {
  amount: string;
  currency: string;
  destinationBankAccountId: string;
  memo?: string;
}): Promise<{ id: string; status: string }> {
  const res = await circleRequest('POST', '/v1/businessAccount/payouts', {
    idempotencyKey: idempotencyKey(),
    destination: {
      type: 'wire',
      id: params.destinationBankAccountId,
    },
    amount: {
      amount: params.amount,
      currency: params.currency,
    },
    ...(params.memo ? { metadata: { beneficiaryEmail: params.memo } } : {}),
  });
  return { id: res.data.id, status: res.data.status };
}

// Get payout status
export async function getPayoutStatus(payoutId: string): Promise<{
  id: string;
  status: string;
  amount: { amount: string; currency: string };
  createDate: string;
}> {
  const res = await circleRequest('GET', `/v1/businessAccount/payouts/${payoutId}`);
  return res.data;
}

// Get transfer status (for deposits)
export async function getTransferStatus(transferId: string): Promise<{
  id: string;
  status: string;
  amount: { amount: string; currency: string };
  createDate: string;
}> {
  const res = await circleRequest('GET', `/v1/businessAccount/transfers/${transferId}`);
  return res.data;
}

// List recent deposits
export async function listDeposits(params?: {
  from?: string;
  to?: string;
  pageSize?: number;
}): Promise<any[]> {
  const query = new URLSearchParams();
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));

  const res = await circleRequest('GET', `/v1/businessAccount/deposits?${query.toString()}`);
  return res.data || [];
}

// List recent payouts
export async function listPayouts(params?: {
  from?: string;
  to?: string;
  pageSize?: number;
}): Promise<any[]> {
  const query = new URLSearchParams();
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));

  const res = await circleRequest('GET', `/v1/businessAccount/payouts?${query.toString()}`);
  return res.data || [];
}
