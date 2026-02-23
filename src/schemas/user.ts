import { z } from 'zod';

export const updateProfileSchema = z.object({
  email: z.string().email().optional(),
  profile_data: z.record(z.string(), z.any()).optional(),
  terms_accepted: z.boolean().optional(),
  privacy_accepted: z.boolean().optional(),
});
