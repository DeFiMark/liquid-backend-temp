import { createClient, SupabaseClient } from '@supabase/supabase-js';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

if (!isTest) {
  if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL not configured');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
}

// Service role client — bypasses RLS, use server-side only
export const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
);
