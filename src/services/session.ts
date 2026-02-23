import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';

const SESSION_EXPIRY_DAYS = 7;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  refreshToken: string,
  req: { ip?: string; headers: Record<string, any> }
): Promise<void> {
  const hash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('sessions').insert({
    user_id: userId,
    refresh_token_hash: hash,
    device_info: req.headers['user-agent'] || null,
    ip_address: req.ip || null,
    expires_at: expiresAt,
  });
}

export async function validateSession(refreshToken: string): Promise<string | null> {
  const hash = hashToken(refreshToken);

  const { data } = await supabase
    .from('sessions')
    .select('id, user_id, expires_at')
    .eq('refresh_token_hash', hash)
    .single();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('id', data.id);
    return null;
  }

  return data.user_id;
}

export async function rotateSession(
  oldRefreshToken: string,
  newRefreshToken: string,
  userId: string,
  req: { ip?: string; headers: Record<string, any> }
): Promise<void> {
  const oldHash = hashToken(oldRefreshToken);
  await supabase.from('sessions').delete().eq('refresh_token_hash', oldHash);
  await createSession(userId, newRefreshToken, req);
}

export async function invalidateAllSessions(userId: string): Promise<void> {
  await supabase.from('sessions').delete().eq('user_id', userId);
}

export async function invalidateSession(refreshToken: string): Promise<void> {
  const hash = hashToken(refreshToken);
  await supabase.from('sessions').delete().eq('refresh_token_hash', hash);
}

export async function cleanupExpiredSessions(): Promise<number> {
  const { count } = await supabase
    .from('sessions')
    .delete()
    .lt('expires_at', new Date().toISOString());

  return count || 0;
}
