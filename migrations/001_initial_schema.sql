-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  smart_wallet_address TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  role TEXT NOT NULL DEFAULT 'investor' CHECK (role IN ('investor', 'borrower', 'admin')),
  email TEXT UNIQUE,
  profile_data JSONB DEFAULT '{}'::jsonb,
  terms_accepted_at TIMESTAMPTZ,
  privacy_accepted_at TIMESTAMPTZ
);

-- KYC records
CREATE TABLE kyc_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'plaid',
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'expired')),
  plaid_idv_id TEXT UNIQUE,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accreditation records
CREATE TABLE accreditation_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('income', 'net_worth', 'professional', 'entity')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  supporting_docs JSONB DEFAULT '[]'::jsonb,
  verification_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Linked bank accounts
CREATE TABLE linked_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_item_id TEXT UNIQUE NOT NULL,
  plaid_access_token_encrypted TEXT NOT NULL,
  plaid_account_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_mask TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_subtype TEXT,
  processor_token TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  error_code TEXT,
  last_balance_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circle accounts
CREATE TABLE circle_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_wallet_id TEXT UNIQUE NOT NULL,
  van_id TEXT UNIQUE NOT NULL,
  wire_instructions_encrypted TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  routing_number_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'investment', 'return', 'fee')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'USDC')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  circle_transfer_id TEXT UNIQUE,
  plaid_transfer_id TEXT UNIQUE,
  tx_hash TEXT UNIQUE,
  description TEXT,
  fee_amount NUMERIC(20,2) DEFAULT 0,
  exchange_rate NUMERIC(10,6),
  metadata JSONB DEFAULT '{}'::jsonb,
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deals (off-chain companion to on-chain DealFlow)
CREATE TABLE deals (
  deal_id BIGINT PRIMARY KEY,
  borrower_address TEXT NOT NULL,
  title TEXT,
  description TEXT,
  category TEXT,
  risk_grade TEXT CHECK (risk_grade IN ('A', 'B', 'C', 'D')),
  collateral_summary TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deal documents
CREATE TABLE deal_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id BIGINT NOT NULL REFERENCES deals(deal_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'property_image', 'financial_statement', 'appraisal',
    'legal', 'insurance', 'tax_return', 'borrower_photo',
    'collateral_image', 'term_sheet', 'other'
  )),
  file_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id),
  actor_address TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_wallet ON users(wallet_address);
CREATE INDEX idx_users_smart_wallet ON users(smart_wallet_address);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_kyc_user_status ON kyc_records(user_id, status);
CREATE INDEX idx_accreditation_user ON accreditation_records(user_id, status);
CREATE INDEX idx_linked_accounts_user ON linked_accounts(user_id);
CREATE INDEX idx_circle_accounts_user ON circle_accounts(user_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_deals_borrower ON deals(borrower_address);
CREATE INDEX idx_deals_category ON deals(category);
CREATE INDEX idx_deal_docs_deal ON deal_documents(deal_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token_hash);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_kyc_updated BEFORE UPDATE ON kyc_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_accreditation_updated BEFORE UPDATE ON accreditation_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_linked_accounts_updated BEFORE UPDATE ON linked_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_circle_accounts_updated BEFORE UPDATE ON circle_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_deals_updated BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE accreditation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
