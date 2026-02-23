-- Migration 003: Create Supabase Storage bucket for deal documents
-- 
-- NOTE: This CANNOT be run via SQL Editor alone. 
-- The storage bucket must be created via one of these methods:
--
-- Option A: Supabase Dashboard (RECOMMENDED)
--   1. Go to Storage in the left sidebar
--   2. Click "New Bucket"
--   3. Name: deal-documents
--   4. Toggle Public: OFF (private bucket)
--   5. File size limit: 52428800 (50MB)
--   6. Allowed MIME types: 
--      application/pdf,image/jpeg,image/png,image/webp,
--      application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
--      application/vnd.openxmlformats-officedocument.wordprocessingml.document
--
-- Option B: Via Supabase JS client (run once from any Node environment)
--   
--   import { createClient } from '@supabase/supabase-js';
--   const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
--   await supabase.storage.createBucket('deal-documents', {
--     public: false,
--     fileSizeLimit: 52428800,
--     allowedMimeTypes: [
--       'application/pdf',
--       'image/jpeg',
--       'image/png',
--       'image/webp',
--       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
--       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
--     ],
--   });
--
-- Option C: SQL (if your Supabase plan supports storage schema access)
--   The SQL below may work depending on your Supabase version:

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-documents',
  'deal-documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: only authenticated users can upload (service_role key bypasses RLS anyway,
-- but this is defense-in-depth for any direct Supabase client access)
CREATE POLICY "Authenticated users can upload deal documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'deal-documents');

CREATE POLICY "Authenticated users can read deal documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'deal-documents');
