import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

export const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});
