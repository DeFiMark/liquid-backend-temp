import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

import {
  createDealFromEvent,
  updateDealMetadata,
  getDeal,
  listDeals,
  addDealDocument,
  deleteDealDocument,
  getDealDocuments,
} from '../services/deal.js';

beforeEach(() => {
  resetMocks();
});

describe('Deal Service', () => {
  describe('createDealFromEvent', () => {
    it('upserts a deal from on-chain event', async () => {
      mocks.mockUpsert.mockResolvedValueOnce({ error: null });

      await createDealFromEvent({ dealId: 42, borrowerAddress: '0xABC123' });

      expect(mocks.mockFrom).toHaveBeenCalledWith('deals');
      expect(mocks.mockUpsert).toHaveBeenCalledWith(
        { deal_id: 42, borrower_address: '0xabc123' },
        { onConflict: 'deal_id' }
      );
    });

    it('throws on upsert error', async () => {
      mocks.mockUpsert.mockResolvedValueOnce({ error: { message: 'duplicate' } });

      await expect(createDealFromEvent({ dealId: 1, borrowerAddress: '0xabc' }))
        .rejects.toThrow('Failed to create deal: duplicate');
    });

    it('lowercases borrower address', async () => {
      mocks.mockUpsert.mockResolvedValueOnce({ error: null });

      await createDealFromEvent({ dealId: 1, borrowerAddress: '0xABCDEF' });

      expect(mocks.mockUpsert).toHaveBeenCalledWith(
        { deal_id: 1, borrower_address: '0xabcdef' },
        { onConflict: 'deal_id' }
      );
    });
  });

  describe('updateDealMetadata', () => {
    it('succeeds for the borrower', async () => {
      // First single() call: verify borrower
      mocks.mockSingle
        .mockResolvedValueOnce({
          data: { deal_id: 1, borrower_address: '0xabc' },
          error: null,
        })
        // Second single() call: update result
        .mockResolvedValueOnce({
          data: { deal_id: 1, title: 'Updated', borrower_address: '0xabc' },
          error: null,
        });

      const result = await updateDealMetadata(1, '0xABC', { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });

    it('rejects non-borrower', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { deal_id: 1, borrower_address: '0xabc' },
        error: null,
      });

      await expect(updateDealMetadata(1, '0xDEF', { title: 'Hack' }))
        .rejects.toThrow('Not authorized');
    });

    it('rejects unknown deal', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await expect(updateDealMetadata(999, '0xabc', { title: 'X' }))
        .rejects.toThrow('Deal not found');
    });
  });

  describe('getDeal', () => {
    it('returns deal with documents', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: {
          deal_id: 1,
          borrower_address: '0xabc',
          title: 'Test Deal',
          deal_documents: [{ id: 'doc-1', type: 'legal' }],
        },
        error: null,
      });

      const result = await getDeal(1);
      expect(result.deal_id).toBe(1);
      expect(result.deal_documents).toHaveLength(1);
    });

    it('returns null for unknown deal', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const result = await getDeal(999);
      expect(result).toBeNull();
    });
  });

  describe('listDeals', () => {
    it('returns paginated results', async () => {
      mocks.mockLimit.mockResolvedValueOnce({
        data: [{ deal_id: 1 }, { deal_id: 2 }],
        error: null,
        count: 5,
      });

      const result = await listDeals({ limit: 2 });
      expect(result.deals).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    it('filters by category', async () => {
      // When only category filter is used (no limit/offset), the chain ends at eq
      // order -> eq (category) -> resolves
      mocks.mockEq.mockResolvedValueOnce({
        data: [{ deal_id: 1, category: 'real_estate' }],
        error: null,
        count: 1,
      });

      const result = await listDeals({ category: 'real_estate' });
      expect(mocks.mockEq).toHaveBeenCalledWith('category', 'real_estate');
      expect(result.deals).toHaveLength(1);
    });

    it('filters by risk grade', async () => {
      mocks.mockEq.mockResolvedValueOnce({
        data: [],
        error: null,
        count: 0,
      });

      const result = await listDeals({ riskGrade: 'A' });
      expect(mocks.mockEq).toHaveBeenCalledWith('risk_grade', 'A');
      expect(result.deals).toEqual([]);
    });

    it('returns empty array on no results', async () => {
      mocks.mockOrder.mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });

      const result = await listDeals();
      expect(result.deals).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('addDealDocument', () => {
    it('succeeds for borrower', async () => {
      // First single(): verify borrower
      mocks.mockSingle
        .mockResolvedValueOnce({
          data: { deal_id: 1, borrower_address: '0xabc' },
          error: null,
        })
        // Second single(): insert result
        .mockResolvedValueOnce({
          data: { id: 'doc-123' },
          error: null,
        });

      const result = await addDealDocument({
        dealId: 1,
        borrowerAddress: '0xABC',
        type: 'legal',
        fileUrl: 'https://example.com/doc.pdf',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
      });

      expect(result.id).toBe('doc-123');
    });

    it('rejects non-borrower', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { deal_id: 1, borrower_address: '0xabc' },
        error: null,
      });

      await expect(addDealDocument({
        dealId: 1,
        borrowerAddress: '0xDEF',
        type: 'legal',
        fileUrl: 'https://example.com/doc.pdf',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
      })).rejects.toThrow('Not authorized');
    });

    it('rejects when deal not found', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await expect(addDealDocument({
        dealId: 999,
        borrowerAddress: '0xabc',
        type: 'legal',
        fileUrl: 'https://example.com/doc.pdf',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
      })).rejects.toThrow('Deal not found');
    });
  });

  describe('deleteDealDocument', () => {
    it('succeeds for borrower', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { borrower_address: '0xabc' },
        error: null,
      });
      // delete().eq().eq() — last eq resolves
      mocks.mockEq
        .mockReturnValueOnce({ single: mocks.mockSingle }) // select.eq for lookup
        .mockReturnValueOnce({ eq: mocks.mockEq }) // delete.eq(id)
        .mockResolvedValueOnce({ error: null }); // delete.eq(deal_id)

      await deleteDealDocument('doc-1', 1, '0xABC');
      expect(mocks.mockFrom).toHaveBeenCalledWith('deal_documents');
    });

    it('rejects non-borrower', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: { borrower_address: '0xabc' },
        error: null,
      });

      await expect(deleteDealDocument('doc-1', 1, '0xDEF'))
        .rejects.toThrow('Not authorized');
    });

    it('rejects when deal not found', async () => {
      mocks.mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      await expect(deleteDealDocument('doc-1', 999, '0xabc'))
        .rejects.toThrow('Not authorized');
    });
  });

  describe('getDealDocuments', () => {
    it('returns list of documents', async () => {
      mocks.mockOrder.mockResolvedValueOnce({
        data: [
          { id: 'doc-1', type: 'legal', filename: 'contract.pdf' },
          { id: 'doc-2', type: 'appraisal', filename: 'appraisal.pdf' },
        ],
        error: null,
      });

      const result = await getDealDocuments(1);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('legal');
    });

    it('returns empty array when no documents', async () => {
      mocks.mockOrder.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await getDealDocuments(999);
      expect(result).toEqual([]);
    });
  });
});
