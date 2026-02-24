import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  getDeal,
  listDeals,
  updateDealMetadata,
  addDealDocument,
  deleteDealDocument,
  getDealDocuments,
} from '../services/deal.js';
import { z } from 'zod';

const router = Router();

const updateDealSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  risk_grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  collateral_summary: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const addDocumentSchema = z.object({
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

const listDealsQuerySchema = z.object({
  category: z.string().optional(),
  riskGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
  borrower: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

router.get('/',
  requireAuth,
  validate(listDealsQuerySchema, 'query'),
  async (req, res) => {
    try {
      const params = (req as any).validatedQuery;
      const result = await listDeals({
        category: params.category,
        riskGrade: params.riskGrade,
        borrowerAddress: params.borrower,
        limit: params.limit,
        offset: params.offset,
      });
      res.json(result);
    } catch (err: any) {
      console.error('List deals error:', err);
      res.status(500).json({ error: 'Failed to list deals' });
    }
  }
);

router.get('/:dealId',
  requireAuth,
  async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId as string);
      if (isNaN(dealId)) {
        res.status(400).json({ error: 'Invalid deal ID' });
        return;
      }
      const deal = await getDeal(dealId);
      if (!deal) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }
      res.json({ deal });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get deal' });
    }
  }
);

router.put('/:dealId',
  requireAuth,
  validate(updateDealSchema),
  auditLog('update_deal', 'deal'),
  async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId as string);
      if (isNaN(dealId)) {
        res.status(400).json({ error: 'Invalid deal ID' });
        return;
      }
      const deal = await updateDealMetadata(dealId, req.user!.address, req.body);
      res.json({ deal });
    } catch (err: any) {
      if (err.message.includes('Not authorized') || err.message.includes('not the borrower')) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      console.error('Update deal error:', err);
      res.status(500).json({ error: 'Failed to update deal' });
    }
  }
);

router.get('/:dealId/documents',
  requireAuth,
  async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId as string);
      if (isNaN(dealId)) {
        res.status(400).json({ error: 'Invalid deal ID' });
        return;
      }
      const documents = await getDealDocuments(dealId);
      res.json({ documents });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list documents' });
    }
  }
);

router.post('/:dealId/documents',
  requireAuth,
  validate(addDocumentSchema),
  auditLog('add_deal_document', 'deal_document'),
  async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId as string);
      if (isNaN(dealId)) {
        res.status(400).json({ error: 'Invalid deal ID' });
        return;
      }
      const result = await addDealDocument({
        dealId,
        borrowerAddress: req.user!.address,
        ...req.body,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err.message.includes('Not authorized')) {
        res.status(403).json({ error: err.message });
        return;
      }
      console.error('Add document error:', err);
      res.status(500).json({ error: 'Failed to add document' });
    }
  }
);

router.delete('/:dealId/documents/:docId',
  requireAuth,
  auditLog('delete_deal_document', 'deal_document'),
  async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId as string);
      if (isNaN(dealId)) {
        res.status(400).json({ error: 'Invalid deal ID' });
        return;
      }
      await deleteDealDocument(req.params.docId as string, dealId, req.user!.address);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message.includes('Not authorized')) {
        res.status(403).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
);

export default router;
