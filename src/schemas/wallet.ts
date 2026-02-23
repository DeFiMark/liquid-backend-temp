import { z } from 'zod';

export const registerWalletSchema = z.object({
  smartWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});
