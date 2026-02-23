import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';

function getPlaidEnv(): string {
  return process.env.PLAID_ENV || 'sandbox';
}

export function createPlaidClient(): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[getPlaidEnv()],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
        'Plaid-Version': '2020-09-14',
      },
    },
  });

  return new PlaidApi(config);
}

export const plaidClient = createPlaidClient();
