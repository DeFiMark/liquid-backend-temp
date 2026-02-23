import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, mocks, resetMocks } from './helpers/mock-supabase.js';

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}));

import { createSession, validateSession, rotateSession, invalidateSession } from '../services/session.js';

const mockReq = { ip: '127.0.0.1', headers: { 'user-agent': 'test' } };

describe('Session Service', () => {
  beforeEach(() => resetMocks());

  it('createSession inserts a session', async () => {
    mocks.mockInsert.mockResolvedValueOnce({ error: null });
    await createSession('user-1', 'refresh-token-abc', mockReq);
    expect(mocks.mockFrom).toHaveBeenCalledWith('sessions');
    expect(mocks.mockInsert).toHaveBeenCalled();
    const insertArg = mocks.mockInsert.mock.calls[0][0];
    expect(insertArg.user_id).toBe('user-1');
    expect(insertArg.refresh_token_hash).toBeDefined();
    expect(insertArg.refresh_token_hash.length).toBe(64); // sha256 hex
  });

  it('validateSession returns userId for valid session', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    mocks.mockSingle.mockResolvedValueOnce({
      data: { id: 'sess-1', user_id: 'user-1', expires_at: futureDate },
      error: null,
    });
    const userId = await validateSession('refresh-token-abc');
    expect(userId).toBe('user-1');
  });

  it('validateSession returns null for unknown token', async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: null, error: null });
    const userId = await validateSession('unknown-token');
    expect(userId).toBeNull();
  });

  it('validateSession returns null for expired session', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mocks.mockSingle.mockResolvedValueOnce({
      data: { id: 'sess-1', user_id: 'user-1', expires_at: pastDate },
      error: null,
    });
    const userId = await validateSession('expired-token');
    expect(userId).toBeNull();
    // Should have called delete for cleanup
    expect(mocks.mockDelete).toHaveBeenCalled();
  });

  it('rotateSession deletes old and creates new', async () => {
    // delete old
    mocks.mockEq.mockResolvedValueOnce({ error: null });
    // insert new
    mocks.mockInsert.mockResolvedValueOnce({ error: null });

    await rotateSession('old-token', 'new-token', 'user-1', mockReq);
    expect(mocks.mockDelete).toHaveBeenCalled();
    expect(mocks.mockInsert).toHaveBeenCalled();
  });

  it('invalidateSession removes session', async () => {
    mocks.mockEq.mockResolvedValueOnce({ error: null });
    await invalidateSession('some-token');
    expect(mocks.mockFrom).toHaveBeenCalledWith('sessions');
    expect(mocks.mockDelete).toHaveBeenCalled();
  });
});
