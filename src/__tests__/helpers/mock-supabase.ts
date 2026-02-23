import { vi } from 'vitest';

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockOr = vi.fn();
const mockSingle = vi.fn();
const mockLt = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockContains = vi.fn();
const mockRange = vi.fn();
const mockUpsert = vi.fn();

const chain: Record<string, any> = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  upsert: mockUpsert,
  eq: mockEq,
  or: mockOr,
  single: mockSingle,
  lt: mockLt,
  in: mockIn,
  order: mockOrder,
  limit: mockLimit,
  contains: mockContains,
  range: mockRange,
};

Object.values(chain).forEach((fn: any) => fn.mockReturnValue(chain));
mockFrom.mockReturnValue(chain);

const mockStorageUpload = vi.fn().mockResolvedValue({ error: null });
const mockStorageGetPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.example.com/file' } });
const mockStorageFrom = vi.fn().mockReturnValue({ upload: mockStorageUpload, getPublicUrl: mockStorageGetPublicUrl });

export const mockSupabase = { from: mockFrom, storage: { from: mockStorageFrom } };
export const mocks = { mockFrom, mockSelect, mockInsert, mockUpdate, mockDelete, mockUpsert, mockEq, mockOr, mockSingle, mockLt, mockIn, mockOrder, mockLimit, mockContains, mockRange, mockStorageUpload, mockStorageGetPublicUrl, mockStorageFrom };

export function resetMocks() {
  Object.values(mocks).forEach(fn => {
    fn.mockClear();
    fn.mockReturnValue(chain);
  });
  mockFrom.mockReturnValue(chain);
  mockStorageFrom.mockReturnValue({ upload: mockStorageUpload, getPublicUrl: mockStorageGetPublicUrl });
  mockStorageUpload.mockResolvedValue({ error: null });
  mockStorageGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://storage.example.com/file' } });
}
