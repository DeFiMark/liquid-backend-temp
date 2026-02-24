import { z } from 'zod';

export const updateDealSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  risk_grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  collateral_summary: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const addDocumentSchema = z.object({
  type: z.enum([
    'property_image', 'financial_statement', 'appraisal',
    'legal', 'insurance', 'tax_return', 'borrower_photo',
    'collateral_image', 'term_sheet', 'other'
  ]),
  fileUrl: z.string().url(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive().optional(),
});

export const listDealsQuerySchema = z.object({
  category: z.string().optional(),
  riskGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
  borrower: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
