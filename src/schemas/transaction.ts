import { z } from 'zod';

export const depositSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal (e.g., "1000.00")'),
});

export const withdrawalSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid decimal'),
  linkedAccountId: z.string().uuid('Invalid account ID'),
});

export const historyQuerySchema = z.object({
  type: z.enum(['deposit', 'withdrawal', 'investment', 'return', 'fee']).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
