# New Supabase Environment Setup

Complete checklist for setting up a fresh Supabase project for Liquid.

## Step 1: Create Supabase Project

1. Go to https://supabase.com/dashboard
2. Create new project (pick region closest to users — US East recommended)
3. Save the **database password** — you'll need it if connecting directly
4. Once provisioned, grab from **Settings → API**:
   - `SUPABASE_URL` (e.g. `https://xxxx.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY` (the `service_role` key — **secret**, never expose to frontend)

## Step 2: Run Migrations (SQL Editor)

Go to **SQL Editor** in the Supabase dashboard and run these in order:

### Migration 001: Schema
Run the contents of `migrations/001_initial_schema.sql`

Creates: 11 tables, indexes, triggers, RLS policies
- `users`, `kyc_records`, `accreditation_records`
- `linked_accounts`, `circle_accounts`
- `transactions`, `deals`, `deal_documents`
- `audit_log`, `sessions`

### Migration 002: KYC Encrypted Fields
Run the contents of `migrations/002_kyc_encrypted_fields.sql`

Adds: Encrypted PII columns to `kyc_records` for 5-year regulatory retention

### Verify
After both migrations, run this to confirm all tables exist:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

Expected: 11 tables (accreditation_records, audit_log, circle_accounts, deal_documents, deals, kyc_records, linked_accounts, sessions, transactions, users)

## Step 3: Create Storage Bucket

The `deal-documents` bucket stores borrower-uploaded files (PDFs, images, spreadsheets).

### Option A: Dashboard (Recommended)
1. Go to **Storage** in the left sidebar
2. Click **"New Bucket"**
3. Configure:
   - **Name:** `deal-documents`
   - **Public:** OFF (private)
   - **File size limit:** `52428800` (50MB)
   - **Allowed MIME types:**
     ```
     application/pdf
     image/jpeg
     image/png
     image/webp
     application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
     application/vnd.openxmlformats-officedocument.wordprocessingml.document
     ```

### Option B: SQL Editor
Run the contents of `migrations/003_storage_bucket.sql`

> **Note:** The SQL approach inserts directly into `storage.buckets`. This works on most Supabase instances but the dashboard method is more reliable.

### Verify
Go to **Storage** → you should see `deal-documents` listed as a private bucket.

## Step 4: Environment Variables

Generate fresh secrets for the new environment:

```bash
# JWT secret (64 bytes hex)
openssl rand -hex 64

# Encryption key (32 bytes hex) — AES-256
openssl rand -hex 32
```

Set in Railway (or `.env` for local):

```env
# Server
PORT=3001
NODE_ENV=production
CORS_ORIGINS=https://getliquid.io

# Auth
JWT_SECRET=<generated above>
APP_DOMAIN=getliquid.io

# Supabase (from Step 1)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from dashboard>

# Encryption
ENCRYPTION_KEY=<generated above>

# Plaid
PLAID_CLIENT_ID=<from Plaid dashboard>
PLAID_SECRET=<sandbox or production>
PLAID_ENV=sandbox
PLAID_IDV_TEMPLATE_ID=<from Plaid dashboard>
PLAID_WEBHOOK_URL=https://<railway-domain>/webhooks/plaid

# Circle
CIRCLE_API_KEY=<sandbox or production>

# Base
BASE_RPC_URL=https://mainnet.base.org
```

### ⚠️ CRITICAL: Encryption Key
The `ENCRYPTION_KEY` encrypts all KYC PII and bank account tokens. **If you lose this key, all encrypted data is permanently unrecoverable.** Store it in a password manager immediately.

## Step 5: Webhook Configuration

After Railway gives you a domain, update:

1. **Plaid Dashboard** → Webhooks → `https://<domain>/webhooks/plaid`
2. **Circle Dashboard** → Webhooks → `https://<domain>/webhooks/circle`
3. **Goldsky** → Webhook destination → `https://<domain>/webhooks/goldsky`

## Migration Checklist

| # | Migration | What it does | Method |
|---|-----------|-------------|--------|
| 001 | `001_initial_schema.sql` | 11 tables, indexes, triggers, RLS | SQL Editor |
| 002 | `002_kyc_encrypted_fields.sql` | Encrypted PII columns on kyc_records | SQL Editor |
| 003 | `003_storage_bucket.sql` | deal-documents storage bucket + policies | Dashboard or SQL |

## Switching Between Environments

Your current Supabase (`nqtoxctvcbfeyegergpb`) stays for local dev. To switch:

- **Local dev:** Use current `.env` (no changes needed)
- **Production:** Railway env vars point to the new Supabase project

The codebase is environment-agnostic — it reads everything from env vars.
