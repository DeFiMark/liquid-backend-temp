import { z } from 'zod';

export const challengeQuerySchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
});

export const verifyBodySchema = z.object({
  message: z.string().min(1, 'Message is required'),
  signature: z.string().regex(/^0x/, 'Signature must start with 0x'),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
