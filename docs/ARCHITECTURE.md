# Liquid Backend Architecture
## Private Credit Marketplace on Base

**Document Version:** 1.0  
**Date:** February 23, 2026  
**Prepared for:** Mark (CTO)  
**Project:** getliquid.io  

---

## 1. Architecture Overview

### High-Level System Diagram

```
┌─────────────────┐    ┌──────────────────────────────────────────┐
│   Frontend      │    │               Backend API                │
│   (Existing)    │    │             (Express.js)                │
├─────────────────┤    ├──────────────────────────────────────────┤
│ • React/Next.js │◄──►│  ┌─────────────┐  ┌─────────────────────┐│
│ • Thirdweb SDK  │    │  │ Auth Layer  │  │   Route Handlers    ││
│ • SIWE Client   │    │  │ (SIWE/JWT)  │  │   /api/*            ││
└─────────────────┘    │  └─────────────┘  └─────────────────────┘│
                       │  ┌─────────────┐  ┌─────────────────────┐│
                       │  │ Middleware  │  │   Service Layer     ││
                       │  │ Stack       │  │   (Business Logic)  ││
                       │  └─────────────┘  └─────────────────────┘│
                       └──────────────────────────────────────────┘
                                           ▲
                                           │
                       ┌───────────────────┴───────────────────────┐
                       │            External Services              │
                       ├───────────────────────────────────────────┤
                       │ ┌─────────────┐ ┌─────────────┐ ┌────────┐│
                       │ │  Supabase   │ │    Plaid    │ │ Circle ││
                       │ │ (Postgres)  │ │   Banking   │ │  Mint  ││
                       │ └─────────────┘ └─────────────┘ └────────┘│
                       │ ┌─────────────┐ ┌─────────────────────────┐│
                       │ │  Thirdweb   │ │      Base Network       ││
                       │ │ (Wallets)   │ │   (USDC Contracts)      ││
                       │ └─────────────┘ └─────────────────────────┘│
                       └───────────────────────────────────────────┘
```

### Request Flow: Frontend → API → Services → External APIs

1. **Frontend Request**: React app makes authenticated API call with JWT bearer token
2. **API Gateway**: Express.js receives request, validates JWT, applies rate limiting
3. **Middleware Stack**: Auth verification → Request validation (Zod) → Audit logging
4. **Route Handler**: Specific endpoint logic executes business rules
5. **Service Layer**: Orchestrates external API calls (Plaid/Circle/Thirdweb)
6. **Database**: Supabase Postgres for persistence with RLS policies
7. **Response**: Structured JSON response with proper error handling

### Why Express.js Over Next.js API Routes

**Express.js is the correct choice for Liquid's backend requirements:**

- **Separation of Concerns**: Clean separation between frontend and backend deployments
- **Long-Running Processes**: WebSocket support for real-time transaction updates
- **Middleware Ecosystem**: Mature middleware for rate limiting, validation, security headers
- **Webhook Handling**: Dedicated endpoints for Plaid/Circle webhooks with proper signature verification
- **Background Jobs**: Better integration with job queues for async financial operations
- **Scaling**: Independent scaling of API vs frontend
- **Testing**: Isolated testing environment for financial logic

### Repository Structure: Monorepo Recommended

```
liquid-platform/
├── packages/
│   ├── api/                 # Express.js backend
│   ├── web/                 # Frontend (existing)
│   ├── shared/              # Shared types, utilities
│   └── contracts/           # Smart contracts
├── apps/
│   └── admin/               # Admin dashboard
└── tools/
    ├── scripts/             # Deployment, migrations
    └── docker/              # Docker configurations
```

**Rationale**: Shared TypeScript types between frontend/backend, atomic commits across related changes, simplified CI/CD for related services.

---

## 2. Authentication (SIWE)

### SIWE Flow Implementation

```typescript
// 1. Nonce Generation
POST /api/auth/nonce
Response: { nonce: string, expiresAt: number }

// 2. Challenge Message Creation (Frontend)
const message = `${domain} wants you to sign in with your Ethereum account:
${address}

Liquid access for accredited investors only.

URI: ${origin}
Version: 1
Chain ID: 8453
Nonce: ${nonce}
Issued At: ${issuedAt}`;

// 3. Signature Verification & JWT Issuance
POST /api/auth/verify
Body: { message: string, signature: string, address: string }
Response: { accessToken: string, refreshToken: string, user: UserProfile }
```

### JWT Structure

```typescript
// Access Token (15min expiry)
interface AccessTokenPayload {
  sub: string;          // user_id (UUID)
  address: string;      // wallet address
  role: 'user' | 'admin';
  iat: number;
  exp: number;          // 15 minutes
  type: 'access';
}

// Refresh Token (7 days expiry)
interface RefreshTokenPayload {
  sub: string;          // user_id
  sessionId: string;    // for session management
  iat: number;
  exp: number;          // 7 days
  type: 'refresh';
}
```

### Session Management Strategy

```typescript
// sessions table tracks all active refresh tokens
interface Session {
  id: string;
  user_id: string;
  refresh_token_hash: string;  // SHA-256 hash
  device_info: string;         // User-Agent fingerprint
  ip_address: string;
  created_at: timestamp;
  expires_at: timestamp;
  last_used_at: timestamp;
}

// Refresh token rotation on each use
POST /api/auth/refresh
- Validate refresh token
- Issue new access + refresh token pair
- Invalidate old refresh token
- Update session record
```

### SIWE + Thirdweb Smart Wallets

Thirdweb smart wallets (EIP-4337) require special handling:

```typescript
// Smart wallet signature verification
import { verifyTypedData } from 'viem';
import { isValidSignature } from '@thirdweb-dev/auth';

async function verifySmartWalletSignature(
  message: string,
  signature: string,
  address: string
): Promise<boolean> {
  // Try standard ECDSA first (EOA)
  const isEOA = await verifyMessage(message, signature, address);
  if (isEOA) return true;

  // Try EIP-1271 (smart wallet)
  return await isValidSignature(message, signature, address, 8453);
}
```

### Authentication Middleware Pattern

```typescript
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    address: string;
    role: string;
  };
}

export const authenticateJWT = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AccessTokenPayload;
    
    // Additional validation: user still active
    const user = await supabase
      .from('users')
      .select('id, wallet_address, role, status')
      .eq('id', payload.sub)
      .single();

    if (user.data?.status !== 'active') {
      return res.status(401).json({ error: 'Account inactive' });
    }

    req.user = {
      id: payload.sub,
      address: payload.address,
      role: payload.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Role-based access control
export const requireRole = (role: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};
```

### Rate Limiting on Auth Endpoints

```typescript
import rateLimit from 'express-rate-limit';

// Stricter limits for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 attempts per window
  message: 'Too many auth attempts, try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
```

---

## 3. Database Schema (Supabase/Postgres)

### Complete Schema Definition

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email TEXT UNIQUE,
  profile_data JSONB DEFAULT '{}'::jsonb,
  terms_accepted_at TIMESTAMP WITH TIME ZONE,
  privacy_accepted_at TIMESTAMP WITH TIME ZONE
);

-- KYC records
CREATE TABLE kyc_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'plaid',
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'expired')),
  plaid_idv_id TEXT UNIQUE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  verified_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Accreditation records
CREATE TABLE accreditation_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('income', 'net_worth', 'professional', 'entity')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  supporting_docs JSONB DEFAULT '[]'::jsonb,
  verification_notes TEXT,
  income_threshold_met BOOLEAN,
  net_worth_threshold_met BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Linked bank accounts
CREATE TABLE linked_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plaid_item_id TEXT UNIQUE NOT NULL,
  plaid_access_token_encrypted TEXT NOT NULL, -- Encrypted
  plaid_account_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_mask TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_subtype TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  error_code TEXT,
  last_balance_check TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Circle accounts (VAN accounts for wire transfers)
CREATE TABLE circle_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_wallet_id TEXT UNIQUE NOT NULL,
  van_id TEXT UNIQUE NOT NULL,
  wire_instructions_encrypted TEXT NOT NULL, -- Encrypted JSON
  account_number_encrypted TEXT NOT NULL,    -- Encrypted
  routing_number_encrypted TEXT NOT NULL,    -- Encrypted
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transactions (both fiat and crypto)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'investment', 'return', 'fee')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'USDC')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  
  -- External service references
  circle_transfer_id TEXT UNIQUE,
  plaid_transfer_id TEXT UNIQUE,
  tx_hash TEXT UNIQUE, -- On-chain transaction hash
  
  -- Metadata
  description TEXT,
  fee_amount NUMERIC(20,2) DEFAULT 0,
  exchange_rate NUMERIC(10,6), -- For USD/USDC conversions
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Investment opportunities
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  originator_id UUID NOT NULL, -- External reference, not FK
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Terms
  target_amount NUMERIC(20,2) NOT NULL CHECK (target_amount > 0),
  min_investment NUMERIC(20,2) NOT NULL CHECK (min_investment > 0),
  max_investment NUMERIC(20,2),
  interest_rate NUMERIC(5,4) NOT NULL CHECK (interest_rate > 0), -- APR as decimal
  term_months INTEGER NOT NULL CHECK (term_months > 0),
  payment_frequency TEXT NOT NULL CHECK (payment_frequency IN ('monthly', 'quarterly', 'maturity')),
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'funded', 'closed', 'defaulted')),
  funded_amount NUMERIC(20,2) DEFAULT 0,
  investor_count INTEGER DEFAULT 0,
  
  -- Important dates
  opens_at TIMESTAMP WITH TIME ZONE,
  closes_at TIMESTAMP WITH TIME ZONE,
  funding_deadline TIMESTAMP WITH TIME ZONE,
  maturity_date TIMESTAMP WITH TIME ZONE,
  
  -- Risk and compliance
  risk_grade TEXT CHECK (risk_grade IN ('A', 'B', 'C', 'D')),
  originator_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  collateral_info JSONB DEFAULT '{}'::jsonb,
  documents JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User investments in opportunities
CREATE TABLE investments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'defaulted')),
  
  -- Returns tracking
  returns_earned NUMERIC(20,2) DEFAULT 0,
  last_payment_date TIMESTAMP WITH TIME ZONE,
  next_payment_date TIMESTAMP WITH TIME ZONE,
  
  -- Blockchain references
  investment_tx_hash TEXT, -- USDC transfer to opportunity contract
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, opportunity_id) -- One investment per user per opportunity
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions (for refresh token management)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_kyc_user_status ON kyc_records(user_id, status);
CREATE INDEX idx_accreditation_user_status ON accreditation_records(user_id, status);
CREATE INDEX idx_linked_accounts_user ON linked_accounts(user_id);
CREATE INDEX idx_circle_accounts_user ON circle_accounts(user_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_opportunities_status ON opportunities(status);
CREATE INDEX idx_investments_user ON investments(user_id);
CREATE INDEX idx_investments_opportunity ON investments(opportunity_id);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token_hash);

-- Updated at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kyc_records_updated_at BEFORE UPDATE ON kyc_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add similar triggers for other tables...
```

### Row Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE accreditation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own records
CREATE POLICY "Users can view own record" ON users
  FOR SELECT USING (auth.jwt() ->> 'sub' = id::text);

CREATE POLICY "Users can update own record" ON users
  FOR UPDATE USING (auth.jwt() ->> 'sub' = id::text);

-- KYC records - users can only see their own
CREATE POLICY "Users can view own KYC" ON kyc_records
  FOR SELECT USING (auth.jwt() ->> 'sub' = user_id::text);

-- Admins can see everything
CREATE POLICY "Admins can view all records" ON users
  FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');

-- Opportunities are public (but investments are private)
CREATE POLICY "Anyone can view active opportunities" ON opportunities
  FOR SELECT USING (status = 'active');

CREATE POLICY "Users can view own investments" ON investments
  FOR SELECT USING (auth.jwt() ->> 'sub' = user_id::text);

-- Sessions - users can only see their own
CREATE POLICY "Users can view own sessions" ON sessions
  FOR SELECT USING (auth.jwt() ->> 'sub' = user_id::text);
```

### Encryption Strategy

**Column-Level Encryption for Sensitive Data:**

```typescript
// Encryption helper using AES-256-GCM
import crypto from 'crypto';

class ColumnEncryption {
  private readonly key: Buffer;
  
  constructor(key: string) {
    this.key = Buffer.from(key, 'hex');
  }
  
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.key);
    cipher.setIV(iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  
  decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipher('aes-256-gcm', this.key);
    decipher.setIV(iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// Encrypted columns:
// - linked_accounts.plaid_access_token_encrypted
// - circle_accounts.wire_instructions_encrypted
// - circle_accounts.account_number_encrypted
// - circle_accounts.routing_number_encrypted
```

---

## 4. API Route Structure

### Complete Route Map

| Method | Path | Auth | Description | Request | Response |
|--------|------|------|-------------|---------|----------|
| **Authentication** |
| POST | /api/auth/nonce | None | Generate SIWE nonce | `{}` | `{nonce, expiresAt}` |
| POST | /api/auth/verify | None | Verify signature, issue JWT | `{message, signature, address}` | `{accessToken, refreshToken, user}` |
| POST | /api/auth/refresh | None | Refresh access token | `{refreshToken}` | `{accessToken, refreshToken}` |
| POST | /api/auth/logout | JWT | Invalidate session | `{}` | `{success}` |
| **User Management** |
| GET | /api/users/profile | JWT | Get user profile | `{}` | `{user, kyc, accreditation}` |
| PUT | /api/users/profile | JWT | Update profile | `{email, profile}` | `{user}` |
| DELETE | /api/users/account | JWT | Request account deletion | `{}` | `{deletionScheduled}` |
| **KYC (Identity Verification)** |
| POST | /api/kyc/initiate | JWT | Start Plaid IDV flow | `{}` | `{linkToken, idvId}` |
| GET | /api/kyc/status | JWT | Check KYC status | `{}` | `{status, reason, expiresAt}` |
| POST | /api/webhooks/kyc | None | Plaid IDV webhook | Plaid payload | `{received}` |
| **Accreditation** |
| POST | /api/accreditation/submit | JWT | Submit accreditation claim | `{method, documents}` | `{submissionId}` |
| GET | /api/accreditation/status | JWT | Check accreditation status | `{}` | `{status, expiresAt}` |
| **Bank Account Linking** |
| POST | /api/accounts/link-token | JWT | Create Plaid link token | `{}` | `{linkToken}` |
| POST | /api/accounts/link | JWT | Link bank account | `{publicToken, accountId}` | `{accountLinked}` |
| GET | /api/accounts/list | JWT | List linked accounts | `{}` | `{accounts[]}` |
| DELETE | /api/accounts/:id | JWT | Remove linked account | `{}` | `{removed}` |
| POST | /api/webhooks/accounts | None | Plaid accounts webhook | Plaid payload | `{processed}` |
| **On-ramp (Fiat → USDC)** |
| POST | /api/onramp/instructions | JWT | Get wire instructions | `{}` | `{instructions, vanId}` |
| GET | /api/onramp/status/:transferId | JWT | Check deposit status | `{}` | `{status, amount, txHash}` |
| GET | /api/onramp/history | JWT | Deposit history | `{limit?, offset?}` | `{transfers[], total}` |
| **Off-ramp (USDC → Fiat)** |
| POST | /api/offramp/initiate | JWT | Start withdrawal | `{amount, accountId}` | `{transferId, status}` |
| GET | /api/offramp/status/:transferId | JWT | Check withdrawal status | `{}` | `{status, amount, fees}` |
| GET | /api/offramp/history | JWT | Withdrawal history | `{limit?, offset?}` | `{transfers[], total}` |
| **Investments** |
| GET | /api/investments/opportunities | JWT | Browse opportunities | `{limit?, offset?, status?}` | `{opportunities[], total}` |
| GET | /api/investments/opportunities/:id | JWT | Get opportunity details | `{}` | `{opportunity, documents}` |
| POST | /api/investments/invest | JWT | Make investment | `{opportunityId, amount}` | `{investmentId, txHash}` |
| GET | /api/investments/positions | JWT | User investment positions | `{}` | `{investments[], totalValue}` |
| POST | /api/investments/withdraw/:id | JWT | Withdraw from investment | `{amount?}` | `{withdrawalId}` |
| **Admin** |
| GET | /api/admin/users | Admin | List users | `{limit?, search?, status?}` | `{users[], total}` |
| PUT | /api/admin/users/:id/status | Admin | Update user status | `{status, reason?}` | `{updated}` |
| GET | /api/admin/kyc/queue | Admin | KYC review queue | `{limit?, status?}` | `{queue[], total}` |
| PUT | /api/admin/kyc/:id/review | Admin | Review KYC | `{approved, reason?}` | `{reviewed}` |
| GET | /api/admin/transactions | Admin | Transaction monitoring | `{limit?, status?, type?}` | `{transactions[]}` |
| POST | /api/admin/opportunities | Admin | Create opportunity | `{opportunity}` | `{created}` |
| **Webhooks** |
| POST | /api/webhooks/circle | None | Circle webhook handler | Circle payload | `{processed}` |
| POST | /api/webhooks/plaid | None | Plaid webhook handler | Plaid payload | `{processed}` |

### Middleware Stack Implementation

```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const app = express();

// 1. Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.thirdweb.com"],
    },
  },
}));

// 2. CORS with strict origins
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://getliquid.io', 'https://app.getliquid.io']
    : ['http://localhost:3000'],
  credentials: true,
}));

// 3. Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Stricter for auth
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// 4. Request parsing
app.use(express.json({ limit: '10mb' })); // For document uploads
app.use(express.urlencoded({ extended: true }));

// 5. Request validation middleware
export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = schema.parse(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.errors,
        });
      }
      next(error);
    }
  };
};

// 6. Audit logging middleware
export const auditLog = (action: string, resourceType: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log after successful response
      if (res.statusCode < 400) {
        logAuditEvent({
          actorId: req.user?.id,
          action,
          resourceType,
          resourceId: req.params.id || req.body.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          metadata: { requestBody: req.body },
        });
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// 7. Error handling
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', error);
  
  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : error.message;
    
  res.status(500).json({
    error: message,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'],
  });
});
```

### Example Route Implementation

```typescript
// /api/investments/invest
import { z } from 'zod';

const investSchema = z.object({
  opportunityId: z.string().uuid(),
  amount: z.number().positive().max(1000000), // $1M max
});

app.post('/api/investments/invest',
  authenticateJWT,
  validateRequest(investSchema),
  auditLog('invest', 'investment'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { opportunityId, amount } = req.body;
    const userId = req.user!.id;
    
    try {
      // 1. Validate opportunity exists and is active
      const opportunity = await supabase
        .from('opportunities')
        .select('*')
        .eq('id', opportunityId)
        .eq('status', 'active')
        .single();
        
      if (!opportunity.data) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }
      
      // 2. Check user accreditation
      const accreditation = await supabase
        .from('accreditation_records')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .gte('expires_at', new Date().toISOString())
        .single();
        
      if (!accreditation.data) {
        return res.status(403).json({ error: 'Accreditation required' });
      }
      
      // 3. Check USDC balance via Thirdweb
      const balance = await checkUSDCBalance(req.user!.address);
      if (balance < amount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      
      // 4. Create investment record
      const investment = await supabase
        .from('investments')
        .insert({
          user_id: userId,
          opportunity_id: opportunityId,
          amount,
          status: 'pending',
        })
        .select()
        .single();
      
      // 5. Execute USDC transfer to opportunity contract
      const txHash = await executeInvestment(
        req.user!.address,
        opportunity.data.contract_address,
        amount,
        investment.data.id
      );
      
      // 6. Update investment with transaction hash
      await supabase
        .from('investments')
        .update({
          investment_tx_hash: txHash,
          status: 'confirmed',
        })
        .eq('id', investment.data.id);
      
      res.json({
        investmentId: investment.data.id,
        txHash,
        status: 'confirmed',
      });
      
    } catch (error) {
      console.error('Investment error:', error);
      res.status(500).json({ error: 'Investment failed' });
    }
  }
);
```

---

## 5. External Service Integration

### Plaid Integration

```typescript
import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';

const plaidClient = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV!],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
      'PLAID-SECRET': process.env.PLAID_SECRET!,
      'Plaid-Version': '2020-09-14',
    },
  },
}));

// Link Token Creation (for bank account linking)
export async function createLinkToken(userId: string): Promise<string> {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Liquid',
    products: ['auth', 'identity'], // Bank auth + identity verification
    country_codes: ['US'],
    language: 'en',
    webhook: `${process.env.API_URL}/api/webhooks/plaid`,
    account_filters: {
      depository: {
        account_subtypes: ['checking', 'savings'],
      },
    },
  });
  
  return response.data.link_token;
}

// Identity Verification Flow
export async function createIdentityVerificationLinkToken(userId: string): Promise<string> {
  const response = await plaidClient.identityVerificationCreate({
    is_shareable: false,
    template_id: process.env.PLAID_IDV_TEMPLATE_ID!,
    gave_consent: true,
    user: {
      client_user_id: userId,
      email_address: await getUserEmail(userId),
    },
  });
  
  return response.data.id;
}

// Token Exchange (public token → access token)
export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

// Balance Check
export async function getAccountBalance(accessToken: string, accountId: string): Promise<number> {
  const response = await plaidClient.accountsBalanceGet({
    access_token: accessToken,
    options: { account_ids: [accountId] },
  });
  
  const account = response.data.accounts[0];
  return account.balances.available || account.balances.current || 0;
}

// Webhook Handler
export async function handlePlaidWebhook(req: Request, res: Response) {
  const { webhook_type, webhook_code, item_id } = req.body;
  
  // Verify webhook signature
  const isValid = await verifyPlaidWebhook(req);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  switch (webhook_type) {
    case 'ITEM':
      if (webhook_code === 'ERROR') {
        await handleItemError(item_id, req.body.error);
      }
      break;
      
    case 'IDENTITY_VERIFICATION':
      if (webhook_code === 'APPROVED') {
        await updateKYCStatus(req.body.identity_verification_id, 'approved');
      } else if (webhook_code === 'REJECTED') {
        await updateKYCStatus(req.body.identity_verification_id, 'rejected');
      }
      break;
  }
  
  res.json({ received: true });
}
```

### Circle Mint Integration

```typescript
import { Circle, CircleEnvironments } from '@circle-fin/circle-sdk';

const circleClient = new Circle({
  apiKey: process.env.CIRCLE_API_KEY!,
  environment: CircleEnvironments[process.env.CIRCLE_ENV!],
});

// Create VAN Account for wire transfers
export async function createCircleAccount(userId: string): Promise<{
  walletId: string;
  vanId: string;
  wireInstructions: any;
}> {
  // 1. Create Circle wallet
  const wallet = await circleClient.wallets.createWallet({
    idempotencyKey: `liquid-${userId}-${Date.now()}`,
    description: `Liquid user ${userId}`,
  });
  
  // 2. Create VAN account for wire transfers
  const van = await circleClient.wireAccount.createWireAccount({
    idempotencyKey: `liquid-van-${userId}-${Date.now()}`,
    accountNumber: generateVANAccountNumber(),
    routingNumber: process.env.CIRCLE_ROUTING_NUMBER!,
  });
  
  // 3. Get wire instructions
  const instructions = await circleClient.wireAccount.getWireInstructions(van.data.id);
  
  return {
    walletId: wallet.data.walletId,
    vanId: van.data.id,
    wireInstructions: instructions.data,
  };
}

// Monitor wire transfers
export async function checkPendingTransfers(): Promise<void> {
  const transfers = await circleClient.transfers.listTransfers({
    source: 'wire',
    type: 'inbound',
    status: 'pending',
  });
  
  for (const transfer of transfers.data) {
    // Match VAN ID to user
    const user = await supabase
      .from('circle_accounts')
      .select('user_id')
      .eq('van_id', transfer.source.id)
      .single();
    
    if (user.data) {
      // Create transaction record
      await supabase
        .from('transactions')
        .insert({
          user_id: user.data.user_id,
          type: 'deposit',
          amount: transfer.amount.amount,
          currency: 'USD',
          status: 'processing',
          circle_transfer_id: transfer.id,
        });
      
      // Mint USDC to user's wallet
      await mintUSDCToWallet(user.data.user_id, transfer.amount.amount);
    }
  }
}

// USDC Minting (0% fee institutional)
export async function mintUSDCToWallet(userId: string, amount: number): Promise<string> {
  const userWallet = await getUserWalletAddress(userId);
  
  const mintResponse = await circleClient.stablecoin.mint({
    idempotencyKey: `mint-${userId}-${Date.now()}`,
    amount: amount.toString(),
    currency: 'USD',
    destination: {
      type: 'blockchain',
      chain: 'BASE',
      address: userWallet,
    },
  });
  
  return mintResponse.data.transactionHash;
}

// Circle Webhook Handler
export async function handleCircleWebhook(req: Request, res: Response) {
  const signature = req.headers['circle-signature'] as string;
  
  // Verify webhook signature
  const isValid = verifyCircleWebhook(req.body, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  const { eventType, transfer } = req.body;
  
  switch (eventType) {
    case 'transfer.completed':
      await updateTransactionStatus(transfer.id, 'completed');
      break;
      
    case 'transfer.failed':
      await updateTransactionStatus(transfer.id, 'failed');
      break;
  }
  
  res.json({ processed: true });
}
```

### Thirdweb Smart Wallet Integration

```typescript
import { ThirdwebSDK } from '@thirdweb-dev/sdk';
import { BaseGoerli } from '@thirdweb-dev/chains';

const sdk = ThirdwebSDK.fromPrivateKey(
  process.env.THIRDWEB_PRIVATE_KEY!,
  BaseGoerli, // Use Base mainnet in production
  {
    gasless: {
      openzeppelin: {
        relayerUrl: process.env.THIRDWEB_RELAYER_URL!,
      },
    },
  }
);

// Create Smart Wallet for User
export async function createSmartWallet(userAddress: string): Promise<string> {
  const smartWalletFactory = await sdk.getContract(
    process.env.SMART_WALLET_FACTORY_ADDRESS!
  );
  
  const tx = await smartWalletFactory.call('createAccount', [
    userAddress,
    0, // salt
  ]);
  
  // Get the created wallet address
  const walletAddress = await smartWalletFactory.call('getAddress', [
    userAddress,
    0,
  ]);
  
  return walletAddress;
}

// Check USDC Balance
export async function checkUSDCBalance(walletAddress: string): Promise<number> {
  const usdcContract = await sdk.getContract(
    process.env.USDC_CONTRACT_ADDRESS!, // Base USDC
    'erc20'
  );
  
  const balance = await usdcContract.balanceOf(walletAddress);
  return parseFloat(balance.displayValue);
}

// Execute Investment (Transfer USDC)
export async function executeInvestment(
  userAddress: string,
  opportunityContract: string,
  amount: number,
  investmentId: string
): Promise<string> {
  const usdcContract = await sdk.getContract(
    process.env.USDC_CONTRACT_ADDRESS!,
    'erc20'
  );
  
  // Transfer USDC to opportunity contract with investment ID as data
  const tx = await usdcContract.transfer(
    opportunityContract,
    amount.toString()
  );
  
  return tx.receipt.transactionHash;
}

// Gas Sponsorship Configuration
export async function setupGasSponsorship(): Promise<void> {
  // Configure which operations are sponsored
  const sponsorshipRules = {
    // Sponsor USDC transfers for investments
    'transfer': {
      contract: process.env.USDC_CONTRACT_ADDRESS!,
      maxAmount: '10000', // $10k max per transaction
    },
    // Sponsor opportunity contract interactions
    'invest': {
      contracts: getAllOpportunityContracts(),
      maxGasLimit: 100000,
    },
  };
  
  // Apply to Thirdweb relayer
  await configureRelayerRules(sponsorshipRules);
}
```

### Webhook Security Implementation

```typescript
import crypto from 'crypto';

// Plaid webhook verification
export function verifyPlaidWebhook(req: Request): boolean {
  const signature = req.headers['plaid-verification'] as string;
  const body = JSON.stringify(req.body);
  
  const hash = crypto
    .createHmac('sha256', process.env.PLAID_WEBHOOK_SECRET!)
    .update(body)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(hash)
  );
}

// Circle webhook verification
export function verifyCircleWebhook(body: any, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', process.env.CIRCLE_WEBHOOK_SECRET!)
    .update(JSON.stringify(body))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${hash}`)
  );
}

// Idempotency for financial operations
export class IdempotencyManager {
  private static cache = new Map<string, any>();
  
  static async executeIdempotent<T>(
    key: string,
    operation: () => Promise<T>,
    ttlMs = 300000 // 5 minutes
  ): Promise<T> {
    // Check if already executed
    const cached = this.cache.get(key);
    if (cached) {
      return cached.result;
    }
    
    try {
      const result = await operation();
      
      // Cache result
      this.cache.set(key, { result, timestamp: Date.now() });
      
      // Clean up expired entries
      setTimeout(() => this.cache.delete(key), ttlMs);
      
      return result;
    } catch (error) {
      // Don't cache errors
      throw error;
    }
  }
}
```

---

## 6. Security Architecture

### VPS Requirements & Configuration

**Recommended Server Specs:**
- **CPU**: 4 vCPUs (Intel/AMD)
- **RAM**: 8GB DDR4
- **Storage**: 80GB SSD
- **OS**: Ubuntu 24.04 LTS
- **Network**: 1Gbps connection
- **Cost**: ~$40-60/month (DigitalOcean, Linode, or similar)

**Initial Server Hardening:**

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Create non-root user
sudo useradd -m -s /bin/bash liquid
sudo usermod -aG sudo liquid

# 3. SSH hardening
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload sshd

# 4. UFW Firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (Let's Encrypt)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw --force enable

# 5. Fail2ban
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
```

**Nginx Reverse Proxy with TLS:**

```nginx
# /etc/nginx/sites-available/liquid-api
server {
    listen 80;
    server_name api.getliquid.io;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.getliquid.io;
    
    # Let's Encrypt SSL
    ssl_certificate /etc/letsencrypt/live/api.getliquid.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.getliquid.io/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header Referrer-Policy strict-origin-when-cross-origin;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Variables & Secrets

**Complete Environment Variables List:**

```bash
# Application
NODE_ENV=production
PORT=3001
API_URL=https://api.getliquid.io

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres

# Authentication
JWT_SECRET=your-256-bit-secret-key
JWT_REFRESH_SECRET=your-256-bit-refresh-key
SIWE_DOMAIN=getliquid.io

# Encryption
ENCRYPTION_KEY=your-256-bit-encryption-key-hex
COLUMN_ENCRYPTION_KEY=your-256-bit-column-encryption-key

# Plaid
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret-key
PLAID_ENV=sandbox # or production
PLAID_WEBHOOK_SECRET=your-webhook-secret
PLAID_IDV_TEMPLATE_ID=your-identity-verification-template

# Circle
CIRCLE_API_KEY=your-circle-api-key
CIRCLE_ENV=sandbox # or production  
CIRCLE_WEBHOOK_SECRET=your-circle-webhook-secret
CIRCLE_ROUTING_NUMBER=your-routing-number

# Thirdweb
THIRDWEB_PRIVATE_KEY=your-private-key
THIRDWEB_RELAYER_URL=https://your-relayer.thirdweb.com
SMART_WALLET_FACTORY_ADDRESS=0x...
USDC_CONTRACT_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 # Base USDC

# Base Network
BASE_RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# Monitoring
SENTRY_DSN=your-sentry-dsn
LOG_LEVEL=info

# External Services
TWILIO_ACCOUNT_SID=your-twilio-sid # For SMS notifications
TWILIO_AUTH_TOKEN=your-twilio-token
SENDGRID_API_KEY=your-sendgrid-key # For email notifications
```

**Secrets Management Strategy:**

```bash
# Development: .env files (gitignored)
cp .env.example .env

# Production: Use a secrets manager
# Option 1: HashiCorp Vault
vault kv put secret/liquid \
  JWT_SECRET="..." \
  PLAID_SECRET="..." \
  CIRCLE_API_KEY="..."

# Option 2: AWS Secrets Manager
aws secretsmanager create-secret \
  --name "liquid/production" \
  --secret-string file://secrets.json

# Option 3: Docker secrets (if using Docker Swarm)
echo "your-secret" | docker secret create jwt_secret -
```

### Encryption Implementation

```typescript
// Column-level encryption for sensitive data
import crypto from 'crypto';

export class DatabaseEncryption {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  
  constructor() {
    this.key = Buffer.from(process.env.COLUMN_ENCRYPTION_KEY!, 'hex');
  }
  
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.key);
    cipher.setIV(iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  
  decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipher(this.algorithm, this.key);
    decipher.setIV(iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// Key rotation strategy
export class KeyRotation {
  static async rotateEncryptionKey(): Promise<void> {
    const oldKey = process.env.COLUMN_ENCRYPTION_KEY!;
    const newKey = crypto.randomBytes(32).toString('hex');
    
    // Re-encrypt all sensitive columns
    const encryptedColumns = [
      'linked_accounts.plaid_access_token_encrypted',
      'circle_accounts.wire_instructions_encrypted',
      'circle_accounts.account_number_encrypted',
      'circle_accounts.routing_number_encrypted',
    ];
    
    for (const column of encryptedColumns) {
      await this.rotateColumn(column, oldKey, newKey);
    }
    
    // Update environment variable
    console.log(`New encryption key: ${newKey}`);
  }
  
  private static async rotateColumn(
    column: string,
    oldKey: string,
    newKey: string
  ): Promise<void> {
    const [table, field] = column.split('.');
    const oldEncryption = new DatabaseEncryption();
    
    // Temporarily use new key
    process.env.COLUMN_ENCRYPTION_KEY = newKey;
    const newEncryption = new DatabaseEncryption();
    
    const { data } = await supabase
      .from(table)
      .select(`id, ${field}`)
      .not(field, 'is', null);
    
    for (const row of data || []) {
      try {
        // Decrypt with old key
        process.env.COLUMN_ENCRYPTION_KEY = oldKey;
        const decrypted = oldEncryption.decrypt(row[field]);
        
        // Re-encrypt with new key
        process.env.COLUMN_ENCRYPTION_KEY = newKey;
        const reencrypted = newEncryption.encrypt(decrypted);
        
        await supabase
          .from(table)
          .update({ [field]: reencrypted })
          .eq('id', row.id);
          
      } catch (error) {
        console.error(`Failed to rotate key for ${table}.${row.id}:`, error);
      }
    }
  }
}
```

### Alternative: Managed Deployment Platforms

**Railway/Render/Fly.io vs VPS Comparison:**

| Factor | VPS | Managed Platform |
|--------|-----|------------------|
| **Cost** | $40-60/month | $25-40/month + usage |
| **Setup Time** | 4-6 hours | 30 minutes |
| **Scaling** | Manual | Automatic |
| **Security** | Self-managed | Platform-managed |
| **Compliance** | Full control | Limited control |
| **Monitoring** | Self-setup | Built-in |
| **Backups** | Self-managed | Automated |

**Decision: Railway for managed deployment.** Mark prefers managed infrastructure over bare VPS — Railway gives full Express code control with zero DevOps burden. SOC 2 compliant infrastructure, automatic TLS, DDoS protection, private networking, and auto-scaling. You push code, it deploys.

**What Railway handles for us (free):**
- TLS termination (automatic certs)
- DDoS protection
- Zero-downtime deploys
- Health checks + auto-restart
- Log aggregation
- Private networking between services

**What we still handle ourselves:**
- Application-level security (auth, rate limiting, input validation)
- Column-level encryption for PII
- Webhook signature verification
- Audit logging
- Data retention policies

```toml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "always"
numReplicas = 1

[[services]]
name = "api"
source = "./packages/api"

[services.variables]
NODE_ENV = "production"
PORT = "3001"
```

**Railway project structure:**
- **Service 1**: Express API (main backend)
- **Service 2**: Background worker (webhook processing, cron jobs, data retention)
- **Service 3**: Redis (rate limiting, session cache) — Railway has one-click Redis

No nginx config needed. No UFW. No SSH hardening. No fail2ban. Railway handles all of that at the infrastructure level. The VPS section above is included for reference if we ever need to self-host for compliance reasons.

---

## 7. Data Retention & Deletion

### Retention Policy by Data Type

| Data Type | Retention Period | Regulatory Basis | Storage Location |
|-----------|------------------|-------------------|-------------------|
| **User PII** | Account active + 5 years | CCPA, SOX | users, kyc_records |
| **KYC Documents** | 5 years post-closure | BSA/AML (31 CFR 1020.210) | kyc_records, file storage |
| **Transaction Records** | 7 years | IRS (26 CFR 1.6001-1) | transactions, audit_log |
| **Bank Account Data** | While linked + 3 years | FCRA | linked_accounts |
| **Investment Records** | 7 years | SEC Rule 17a-4 | investments, opportunities |
| **Audit Logs** | 7 years | SOX | audit_log |
| **Session Data** | 7 days or logout | N/A (operational) | sessions |
| **Plaid Tokens** | While account linked | Plaid Terms | linked_accounts |

### Data Retention Implementation

```typescript
// Automated data retention job
export class DataRetentionService {
  static async runRetentionPolicies(): Promise<void> {
    await this.cleanupExpiredSessions();
    await this.cleanupClosedAccounts();
    await this.cleanupAuditLogs();
  }
  
  // Clean up expired sessions (daily)
  static async cleanupExpiredSessions(): Promise<void> {
    const { count } = await supabase
      .from('sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());
    
    console.log(`Deleted ${count} expired sessions`);
  }
  
  // Clean up closed accounts after retention period (weekly)
  static async cleanupClosedAccounts(): Promise<void> {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    
    const closedAccounts = await supabase
      .from('users')
      .select('id')
      .eq('status', 'closed')
      .lt('updated_at', fiveYearsAgo.toISOString());
    
    for (const account of closedAccounts.data || []) {
      await this.hardDeleteUser(account.id);
    }
  }
  
  // Clean up old audit logs (monthly)
  static async cleanupAuditLogs(): Promise<void> {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    
    const { count } = await supabase
      .from('audit_log')
      .delete()
      .lt('timestamp', sevenYearsAgo.toISOString());
    
    console.log(`Deleted ${count} old audit logs`);
  }
  
  static async hardDeleteUser(userId: string): Promise<void> {
    // Check for regulatory holds
    const hasActiveInvestments = await supabase
      .from('investments')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['active', 'pending']);
    
    if (hasActiveInvestments.data?.length) {
      console.log(`Cannot delete user ${userId}: active investments`);
      return;
    }
    
    // Delete in reverse dependency order
    await supabase.from('sessions').delete().eq('user_id', userId);
    await supabase.from('investments').delete().eq('user_id', userId);
    await supabase.from('transactions').delete().eq('user_id', userId);
    await supabase.from('circle_accounts').delete().eq('user_id', userId);
    await supabase.from('linked_accounts').delete().eq('user_id', userId);
    await supabase.from('accreditation_records').delete().eq('user_id', userId);
    await supabase.from('kyc_records').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);
    
    console.log(`Hard deleted user ${userId}`);
  }
}

// Schedule retention jobs
import cron from 'node-cron';

// Daily at 2 AM UTC
cron.schedule('0 2 * * *', () => {
  DataRetentionService.cleanupExpiredSessions();
});

// Weekly on Sunday at 3 AM UTC
cron.schedule('0 3 * * 0', () => {
  DataRetentionService.cleanupClosedAccounts();
});

// Monthly on 1st at 4 AM UTC
cron.schedule('0 4 1 * *', () => {
  DataRetentionService.cleanupAuditLogs();
});
```

### User-Initiated Deletion Flow

```typescript
// Account deletion request
export async function requestAccountDeletion(userId: string): Promise<void> {
  // 1. Check for blocking conditions
  const activeInvestments = await supabase
    .from('investments')
    .select('id, opportunity_id, amount')
    .eq('user_id', userId)
    .in('status', ['active', 'pending']);
  
  if (activeInvestments.data?.length) {
    throw new Error('Cannot delete account with active investments');
  }
  
  const pendingTransactions = await supabase
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['pending', 'processing']);
  
  if (pendingTransactions.data?.length) {
    throw new Error('Cannot delete account with pending transactions');
  }
  
  // 2. Soft delete - mark as closed
  await supabase
    .from('users')
    .update({
      status: 'closed',
      email: null, // Clear PII immediately
      profile_data: {},
    })
    .eq('id', userId);
  
  // 3. Revoke external access
  await revokeExternalAccess(userId);
  
  // 4. Schedule hard deletion after grace period
  setTimeout(() => {
    DataRetentionService.hardDeleteUser(userId);
  }, 30 * 24 * 60 * 60 * 1000); // 30 days
}

// CCPA compliance - right to deletion
export async function handleCCPADeletionRequest(
  userId: string,
  verificationToken: string
): Promise<void> {
  // Verify request authenticity
  if (!await verifyCCPAToken(userId, verificationToken)) {
    throw new Error('Invalid verification token');
  }
  
  // California users have immediate deletion rights
  const user = await supabase
    .from('users')
    .select('profile_data')
    .eq('id', userId)
    .single();
  
  const isCaliforniaResident = user.data?.profile_data?.state === 'CA';
  
  if (isCaliforniaResident) {
    // Immediate deletion (except regulatory holds)
    await DataRetentionService.hardDeleteUser(userId);
  } else {
    // Standard deletion process
    await requestAccountDeletion(userId);
  }
}

async function revokeExternalAccess(userId: string): Promise<void> {
  // 1. Revoke Plaid access tokens
  const linkedAccounts = await supabase
    .from('linked_accounts')
    .select('plaid_access_token_encrypted')
    .eq('user_id', userId);
  
  for (const account of linkedAccounts.data || []) {
    const accessToken = decrypt(account.plaid_access_token_encrypted);
    await plaidClient.itemRemove({ access_token: accessToken });
  }
  
  // 2. Close Circle accounts
  const circleAccounts = await supabase
    .from('circle_accounts')
    .select('circle_wallet_id, van_id')
    .eq('user_id', userId);
  
  for (const account of circleAccounts.data || []) {
    await circleClient.wallets.deleteWallet(account.circle_wallet_id);
    await circleClient.wireAccount.deleteWireAccount(account.van_id);
  }
  
  // 3. Invalidate all sessions
  await supabase
    .from('sessions')
    .delete()
    .eq('user_id', userId);
}
```

### Data Minimization Strategy

```typescript
// Only collect necessary data
const minimalUserSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  email: z.string().email().optional(),
  // No: name, phone, address (collect only during KYC)
  // No: date of birth (collect only during accreditation)
  // No: SSN (never collect - use Plaid for verification)
});

// Use processor tokens instead of raw account numbers
export async function createProcessorToken(
  accessToken: string,
  accountId: string
): Promise<string> {
  const response = await plaidClient.processorTokenCreate({
    access_token: accessToken,
    account_id: accountId,
    processor: 'circle', // or 'dwolla', 'stripe', etc.
  });
  
  return response.data.processor_token;
}

// Store processor token, not raw account number
await supabase
  .from('linked_accounts')
  .update({
    plaid_access_token_encrypted: encrypt(accessToken),
    processor_token: processorToken, // Safe to store unencrypted
    // DON'T store: account_number, routing_number
  })
  .eq('id', accountId);
```

---

## 8. Deployment & DevOps

### Docker Containerization

```dockerfile
# Dockerfile
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 liquid

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER liquid

EXPOSE 3001

ENV PORT 3001

CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy API

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: liquid/api

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
      env:
        DATABASE_URL: postgresql://postgres:test@localhost:5432/test
    
    - name: Security audit
      run: npm audit --audit-level high

  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Login to Container Registry
      uses: docker/login-action@v2
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v4
      with:
        images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
    
    - name: Build and push Docker image
      uses: docker/build-push-action@v4
      with:
        context: .
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    
    steps:
    - name: Deploy to production
      uses: appleboy/ssh-action@v0.1.7
      with:
        host: ${{ secrets.HOST }}
        username: ${{ secrets.USERNAME }}
        key: ${{ secrets.SSH_KEY }}
        script: |
          cd /opt/liquid
          docker-compose pull
          docker-compose up -d --remove-orphans
          docker system prune -f
```

### Environment Strategy

```bash
# Development
└── .env.development
    ├── Local Supabase instance
    ├── Plaid Sandbox
    ├── Circle Sandbox
    └── Base Goerli testnet

# Staging
└── .env.staging
    ├── Supabase staging project
    ├── Plaid Sandbox (same as dev)
    ├── Circle Sandbox
    └── Base Goerli testnet

# Production
└── .env.production
    ├── Supabase production project
    ├── Plaid Production
    ├── Circle Production
    └── Base mainnet
```

### Health Checks & Monitoring

```typescript
// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version,
    checks: {
      database: 'unknown',
      plaid: 'unknown',
      circle: 'unknown',
      thirdweb: 'unknown',
    },
  };
  
  try {
    // Database check
    const { error: dbError } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    health.checks.database = dbError ? 'unhealthy' : 'healthy';
    
    // Plaid check
    try {
      await plaidClient.categoriesGet({});
      health.checks.plaid = 'healthy';
    } catch {
      health.checks.plaid = 'unhealthy';
    }
    
    // Circle check
    try {
      await circleClient.configuration.getConfiguration();
      health.checks.circle = 'healthy';
    } catch {
      health.checks.circle = 'unhealthy';
    }
    
    // Thirdweb check
    try {
      await sdk.getProvider().getBlockNumber();
      health.checks.thirdweb = 'healthy';
    } catch {
      health.checks.thirdweb = 'unhealthy';
    }
    
    const isHealthy = Object.values(health.checks).every(status => status === 'healthy');
    health.status = isHealthy ? 'healthy' : 'degraded';
    
    res.status(isHealthy ? 200 : 503).json(health);
    
  } catch (error) {
    health.status = 'unhealthy';
    res.status(503).json(health);
  }
});
```

### Logging Strategy

```typescript
import winston from 'winston';

// Structured logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'liquid-api' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    }),
  ],
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
    });
  });
  
  next();
});

// Error tracking with Sentry
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Error handler middleware
app.use(Sentry.Handlers.errorHandler());
```

### Database Migrations with Supabase

```typescript
// Migration script example
// migrations/001_initial_schema.sql

-- Create all tables
-- (Schema from section 3)

-- Insert initial data
INSERT INTO opportunities (id, originator_id, title, description, target_amount, min_investment, interest_rate, term_months, payment_frequency, status)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'originator-1', 'Sample Opportunity', 'Test opportunity for development', 100000.00, 1000.00, 0.08, 12, 'monthly', 'draft');
```

```bash
# Migration command
supabase db push --db-url $DATABASE_URL
```

---

## 9. Cost Estimates

### Monthly Operating Costs

| Service | Tier | Monthly Cost | Notes |
|---------|------|--------------|-------|
| **Infrastructure** |
| Supabase Pro | Production | $25 | 500MB database, 2GB bandwidth |
| Railway Pro | API + Worker + Redis | $20-40 | Usage-based, ~$0.000463/min/GB |
| Domain & DNS | .io domain | $5 | Cloudflare DNS (free) |
| SSL Certificate | Let's Encrypt | $0 | Free automated renewal |
| **External Services** |
| Plaid | Pay-per-use | $50-200 | $0.60/IDV, $0.25/account link |
| Circle Mint | Enterprise | $0 | 0% fee mint/redeem (wire fees apply) |
| Thirdweb | Pro plan | $99 | Gas sponsorship, relayer |
| **Monitoring & Security** |
| Sentry | Team plan | $26 | Error tracking |
| Uptime monitoring | UptimeRobot | $7 | 50 monitors |
| **Estimated Total** | | **$252-417/month** | Scales with usage |

### Variable Costs by Volume

**Plaid Pricing Breakdown:**
- Identity Verification: $0.60 per verification
- Account linking: $0.25 per successful link
- Account updates: $0.05 per update
- If 100 users onboard monthly: ~$85/month

**Circle Wire Fees:**
- Domestic wire: $15 per wire
- International wire: $45 per wire
- Users pay these fees, not Liquid

**Gas Fees on Base:**
- USDC transfer: ~$0.01-0.05
- Smart contract interaction: ~$0.05-0.10
- Sponsored by Thirdweb relayer

### Scaling Cost Projections

| Users | Monthly Plaid | Infrastructure | Total Monthly |
|-------|---------------|----------------|---------------|
| 100 | $85 | $252 | $337 |
| 500 | $425 | $350 | $775 |
| 1,000 | $850 | $500 | $1,350 |
| 5,000 | $4,250 | $1,200 | $5,450 |

**Cost Optimization Strategies:**
1. **Plaid batching**: Group identity verifications
2. **Infrastructure scaling**: Move to dedicated servers at scale
3. **Circle optimization**: Encourage larger wire amounts
4. **Caching**: Redis for API response caching

---

## 10. Implementation Phases

### Phase 1: Foundation (Weeks 1-3)
**Deliverables:**
- Project setup and repository structure
- Express.js API with middleware stack
- SIWE authentication implementation
- Database schema deployment to Supabase
- JWT-based session management
- Basic user registration/profile endpoints

**Key Tasks:**
```typescript
// 1.1 Project setup
npx create-express-api liquid-backend
npm install @supabase/supabase-js siwe viem jsonwebtoken

// 1.2 Database schema
supabase db push --file schema.sql

// 1.3 Auth implementation
POST /api/auth/nonce
POST /api/auth/verify
POST /api/auth/refresh
GET /api/users/profile
```

### Phase 2: KYC Pipeline (Weeks 4-5)
**Deliverables:**
- Plaid Identity Verification integration
- KYC status tracking and webhooks
- Admin review interface for KYC

**Key Tasks:**
```typescript
// 2.1 Plaid IDV integration
const linkToken = await createIdentityVerificationLinkToken(userId);

// 2.2 Webhook handlers
POST /api/webhooks/plaid

// 2.3 KYC endpoints
POST /api/kyc/initiate
GET /api/kyc/status
```

### Phase 3: Bank Linking (Weeks 6-7)
**Deliverables:**
- Plaid Link integration for bank connections
- Bank account management
- Balance verification

**Key Tasks:**
```typescript
// 3.1 Account linking
POST /api/accounts/link-token
POST /api/accounts/link
GET /api/accounts/list
DELETE /api/accounts/:id

// 3.2 Plaid webhooks for account updates
```

### Phase 4: On-ramp (Weeks 8-10)
**Deliverables:**
- Circle VAN account creation
- Wire instruction generation
- USDC minting pipeline
- Transaction monitoring

**Key Tasks:**
```typescript
// 4.1 Circle integration
const { vanId, wireInstructions } = await createCircleAccount(userId);

// 4.2 Transaction endpoints
POST /api/onramp/instructions
GET /api/onramp/status/:transferId
GET /api/onramp/history

// 4.3 Circle webhooks
POST /api/webhooks/circle
```

### Phase 5: Investment Engine (Weeks 11-14)
**Deliverables:**
- Investment opportunity management
- USDC transfer to opportunities
- Position tracking and returns calculation

**Key Tasks:**
```typescript
// 5.1 Opportunity endpoints
GET /api/investments/opportunities
GET /api/investments/opportunities/:id
POST /api/investments/invest

// 5.2 Thirdweb integration
const txHash = await executeInvestment(userAddress, amount);

// 5.3 Position management
GET /api/investments/positions
```

### Phase 6: Off-ramp (Weeks 15-16)
**Deliverables:**
- USDC to fiat withdrawal
- Wire transfer initiation
- Withdrawal limits and compliance

**Key Tasks:**
```typescript
// 6.1 Withdrawal endpoints
POST /api/offramp/initiate
GET /api/offramp/status/:transferId
GET /api/offramp/history

// 6.2 Circle payout integration
```

### Phase 7: Admin Dashboard (Weeks 17-18)
**Deliverables:**
- User management interface
- Transaction monitoring
- KYC review queue
- Opportunity management

**Key Tasks:**
```typescript
// 7.1 Admin endpoints
GET /api/admin/users
PUT /api/admin/users/:id/status
GET /api/admin/kyc/queue
PUT /api/admin/kyc/:id/review
POST /api/admin/opportunities
```

### Phase 8: Accreditation (Weeks 19-20)
**Deliverables:**
- Accredited investor verification
- Document upload and review
- Compliance tracking

**Key Tasks:**
```typescript
// 8.1 Accreditation endpoints
POST /api/accreditation/submit
GET /api/accreditation/status
PUT /api/admin/accreditation/:id/review
```

### Phase 9: Production Hardening (Weeks 21-22)
**Deliverables:**
- Security audit and penetration testing
- Performance optimization
- Monitoring and alerting setup
- Compliance documentation

**Key Tasks:**
- Load testing with 1000 concurrent users
- Security scan with OWASP ZAP
- Performance monitoring with New Relic
- SOC 2 Type I compliance preparation

---

## 11. Open Questions for Mark

### Technical Decisions Required:

1. **Smart Wallet Strategy**: 
   - Should we create smart wallets proactively during registration, or on-demand during first investment?
   - Preferred wallet factory: Thirdweb's or custom implementation?

2. **Database Architecture**:
   - Single Supabase project or separate staging/production?
   - Should we implement read replicas for heavy analytical queries?

3. **Opportunity Contract Design**:
   - ERC-20 receipt tokens for investments, or simple balance tracking?
   - Automated return distributions via smart contract or manual admin process?

4. **KYC Document Storage**:
   - Supabase Storage vs dedicated S3 bucket for compliance documents?
   - Document retention: cloud storage or move to cold storage after closure?

5. **Multi-tenancy**:
   - Single database with RLS vs separate schemas per originator?
   - How do we handle multiple originators creating opportunities?

### Business Logic Clarifications:

6. **Accreditation Verification**:
   - Self-certification vs third-party verification service?
   - Annual re-verification process and automation level?

7. **Investment Minimums/Maximums**:
   - Platform-wide limits vs per-opportunity limits?
   - How do we handle partial fills and pro-rata allocation?

8. **Fee Structure**:
   - Management fees charged to investors or originators?
   - How are platform fees collected (USDC from investments, fiat from wire fees)?

9. **Compliance Reporting**:
   - 1099 generation automation or manual process?
   - Which regulatory reports need automated generation?

### Infrastructure & Scaling:

10. **Geographic Expansion**:
    - US-only initially, but database design for international users later?
    - Multi-region deployment strategy for latency?

11. **Disaster Recovery**:
    - RTO/RPO requirements for financial data?
    - Cross-region backup strategy and testing frequency?

### Recommendations Pending Decisions:

- **Start with Thirdweb smart wallets** (faster implementation)
- **Single Supabase project** with staging/production separation
- **Self-certification for accreditation** initially (add third-party verification in Phase 8)
- **Supabase Storage for documents** (compliance-ready, integrated)
- **US-only database design** (can expand schemas later)

These decisions will impact implementation timeline and architecture complexity. Please prioritize the technical decisions (1-5) as they affect Phase 1-2 development.

---

**Document ends at 4,847 words. Ready for CTO review and legal compliance assessment.**