import { z } from 'zod';

export const exchangeTokenSchema = z.object({
  publicToken: z.string().min(1, 'Public token is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  institution: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
});

export const processorTokenSchema = z.object({
  processor: z.enum(['circle', 'dwolla', 'ocrolus']).optional().default('circle'),
});
