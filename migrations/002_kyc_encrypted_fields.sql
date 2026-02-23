-- Migration 002: Add encrypted KYC data fields to kyc_records
-- Run this in Supabase SQL Editor

-- Encrypted PII fields (AES-256-GCM encrypted text)
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS full_name_encrypted TEXT;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS date_of_birth_encrypted TEXT;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS address_encrypted TEXT;          -- encrypted JSON
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS phone_encrypted TEXT;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS id_document_type TEXT;            -- passport, drivers_license, etc.
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS id_document_number_encrypted TEXT;

-- Verification results (not PII but important for compliance)
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS aml_screening_result TEXT CHECK (aml_screening_result IN ('pass', 'fail', 'review', 'pending'));
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS verification_summary_encrypted TEXT;  -- full Plaid response, encrypted

-- Document storage references (Supabase Storage private bucket)
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS selfie_storage_path TEXT;
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS id_document_storage_path TEXT;

-- Retention tracking
ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS data_retention_until TIMESTAMPTZ;  -- 5 years after account closure
