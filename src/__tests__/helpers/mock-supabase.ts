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

const chain: Record<string, any> = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  eq: mockEq,
  or: mockOr,
  single: mockSingle,
  lt: mockLt,
  in: mockIn,
  order: mockOrder,
  limit: mockLimit,
};

Object.values(chain).forEach((fn: any) => fn.mockReturnValue(chain));
mockFrom.mockReturnValue(chain);

export const mockSupabase = { from: mockFrom };
export const mocks = { mockFrom, mockSelect, mockInsert, mockUpdate, mockDelete, mockEq, mockOr, mockSingle, mockLt, mockIn, mockOrder, mockLimit };

export function resetMocks() {
  Object.values(mocks).forEach(fn => {
    fn.mockClear();
    fn.mockReturnValue(chain);
  });
  mockFrom.mockReturnValue(chain);
}
