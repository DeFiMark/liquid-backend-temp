# AGENTS.md — Liquid Backend Handoff & Sync Document

> **Purpose**: Single source of truth for any AI agent (or human) working on this codebase.
> Read this FIRST after cloning. It tells you what exists, what's left, and where everything lives.
>
> **Maintainers**: DeFiClawd (security/architecture), incoming agent (development)
> **Last updated**: 2026-03-03

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Codebase Map](#3-codebase-map)
4. [What's Built (Phases 1-9)](#4-whats-built)
5. [What's Remaining](#5-whats-remaining)
6. [Open Questions & Blockers](#6-open-questions--blockers)
7. [Key Design Decisions](#7-key-design-decisions)
8. [Auth Deep Dive](#8-auth-deep-dive)
9. [External Services](#9-external-services)
10. [Database & Migrations](#10-database--migrations)
11. [Deployment](#11-deployment)
12. [Frontend Integration Notes](#12-frontend-integration-notes)
13. [Security Requirements](#13-security-requirements)
14. [Testing](#14-testing)
15. [Environment Variables](#15-environment-variables)
16. [Changelog / Sync Log](#16-changelog--sync-log)

---

## 1. Project Overview

**Liquid** (getliquid.io) is a blockchain marketplace for private credit — connecting accredited investors with lending opportunities on Base (Coinbase L2).

### Core Concepts
- **Non-custodial**: Liquid NEVER holds user funds. Money flows User ↔ Circle directly. Liquid orchestrates.
- **Smart wallets**: Thirdweb account abstraction on Base. User doesn't know they have a wallet.
- **USDC only**: All investments denominated in USDC on Base.
- **US accredited investors only** (Reg D exemption to start).
- **Contract is source of truth**: Deal financial terms (APY, amounts, status) live on-chain. Backend stores metadata only.
- **No MTL (Money Transmitter License)**: Architecture deliberately avoids custodial money handling.

### The Flow
```
Signup → KYC (Plaid IDV) → Link Bank (Plaid) → Deposit (wire to Circle → USDC minted)
→ Invest in deals (on-chain) → Earn returns (on-chain) → Withdraw (USDC → Circle → wire to bank)
```

### Key People
- **Mark (DeFi Mark)**: CTO, building the smart contracts + frontend. Highly technical.
- **DeFiClawd**: Security/architecture, built this backend, ongoing reviewer.
- **You (new agent)**: Primary backend development going forward.

---

## 2. Architecture Summary

**Full architecture doc**: `docs/ARCHITECTURE.md` (v1.3, very detailed — read it)

```
Frontend (Next.js 16 + Thirdweb v5)  ←→  Backend API (Express.js + TypeScript)
                                              ↕
                                     ┌────────┴────────┐
                                     │   Supabase      │  (Postgres + Storage)
                                     │   Plaid         │  (KYC + Bank linking)
                                     │   Circle Mint   │  (Fiat ↔ USDC)
                                     │   Goldsky       │  (On-chain indexer)
                                     │   Base Network  │  (Smart contracts)
                                     └─────────────────┘
```

**Why Express over Next.js API routes**: Separation of concerns, webhook handling, middleware ecosystem, independent scaling. See `docs/ARCHITECTURE.md` §1 for full rationale.

---

## 3. Codebase Map

```
liquid-backend/
├── src/
│   ├── index.ts                    # App entry — Express setup, route mounting
│   ├── auth/
│   │   ├── challenge.ts            # SIWE challenge generation
│   │   ├── verify.ts               # SIWE signature verification (viem)
│   │   ├── jwt.ts                  # JWT token creation/validation
│   │   └── router.ts               # /auth/* routes
│   ├── routes/
│   │   ├── user.ts                 # /users/* — profile CRUD
│   │   ├── kyc.ts                  # /kyc/* — Plaid IDV initiation + status
│   │   ├── bank-accounts.ts        # /accounts/* — Plaid bank linking
│   │   ├── transactions.ts         # /transactions/* — deposit/withdraw
│   │   ├── deals.ts                # /deals/* — deal metadata + documents
│   │   ├── wallet.ts               # /wallet/* — smart wallet registration
│   │   ├── admin.ts                # /admin/* — user mgmt, Circle balance, audit
│   │   ├── webhooks.ts             # /webhooks/* — Plaid, Circle, Goldsky
│   │   └── upload.ts               # /upload/* — Supabase Storage uploads
│   ├── services/
│   │   ├── user.ts                 # User CRUD, profile with KYC/accreditation joins
│   │   ├── session.ts              # Refresh token management (SHA-256 hashed)
│   │   ├── kyc.ts                  # Plaid IDV orchestration, PII encryption
│   │   ├── bank-account.ts         # Plaid token exchange, account management
│   │   ├── transaction.ts          # Deposit/withdrawal orchestration
│   │   ├── deal.ts                 # Deal metadata CRUD, document management
│   │   └── smart-wallet.ts         # Wallet address storage (immutable once set)
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client initialization
│   │   ├── plaid.ts                # Plaid client initialization
│   │   ├── circle.ts               # Circle client (native fetch, idempotency)
│   │   ├── encryption.ts           # AES-256-GCM encrypt/decrypt
│   │   └── base-client.ts          # viem client for Base reads (stub)
│   ├── middleware/
│   │   ├── requireAuth.ts          # JWT verification + user lookup
│   │   ├── requireKyc.ts           # Requires approved KYC status
│   │   ├── validate.ts             # Zod schema validation
│   │   ├── auditLog.ts             # Fire-and-forget audit logging
│   │   ├── rateLimit.ts            # Upstash Redis sliding window + in-memory fallback
│   │   ├── errorHandler.ts         # Global error handler
│   │   └── requestLogger.ts        # Request logging (method, path, status, duration)
│   ├── schemas/                    # Zod schemas for request validation
│   │   ├── auth.ts, user.ts, bank-account.ts, deal.ts, transaction.ts, wallet.ts
│   │   └── index.ts                # Re-exports
│   ├── types/
│   │   └── express.d.ts            # Express Request augmentation (req.user)
│   └── __tests__/                  # 122 tests across 14 files
│       └── helpers/mock-supabase.ts
├── migrations/
│   ├── 001_initial_schema.sql      # 11 tables, indexes, triggers, RLS (211 lines)
│   ├── 002_kyc_encrypted_fields.sql # KYC PII columns + AML + document refs
│   └── 003_storage_bucket.sql      # Supabase Storage for deal documents
├── docs/
│   ├── ARCHITECTURE.md             # Full architecture doc v1.3 (READ THIS)
│   ├── BUILD_STATUS.md             # Phase completion status + route table
│   ├── DEPLOYMENT.md               # General deployment notes
│   ├── NEW_ENVIRONMENT_SETUP.md    # Fresh Supabase project setup guide
│   └── RAILWAY_SETUP.md            # Step-by-step Railway deployment
├── .env.example                    # All env vars with descriptions
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. What's Built

### Phase 1: Auth + User Management ✅ (commit `8c89454`)
- SIWE challenge/verify with EIP-1271 + ERC-6492 smart wallet support
- JWT (15m access + 7d refresh), role-aware, session management
- User CRUD with profile, KYC, and accreditation joins
- **41 tests**

### Phase 2: Encryption + KYC Pipeline ✅ (commit `5541bfb`)
- AES-256-GCM column-level encryption for PII
- Plaid Identity Verification (IDV) integration
- KYC status state machine: pending → submitted → approved/rejected/expired
- IDV approval auto-activates user account, sets 1yr expiry
- **59 tests cumulative**

### Phase 3: Bank Account Linking ✅ (commits `8713c34`, `f053407`)
- Plaid Link token creation, public token exchange
- Encrypted access token storage
- Processor token creation (for Circle) — **IDOR bug caught and fixed**
- Only checking/savings accounts allowed
- ITEM webhook handling
- **69 tests cumulative**

### Phase 4: Circle Mint + Transactions + Admin ✅ (commit `174a76d`)
- Circle client (native fetch, NOT SDK — idempotency keys, sandbox/prod toggle)
- Deposit flow: wire instructions + user-specific memo
- Withdrawal flow: ownership check + transaction record
- Transaction history with filters + pagination
- Admin routes: Circle balance, deposits, payouts, user mgmt, audit log
- **90 tests cumulative**

### Phase 5: Deal Management ✅ (commit `51a3998`)
- Goldsky webhook: DealCreated → auto-create DB row (idempotent)
- Deal metadata CRUD (borrower-only writes, anyone reads)
- Document upload via Supabase Storage (50MB/file, PDF/JPEG/PNG/WebP/XLSX/DOCX)
- **110 tests cumulative**

### Phase 7: Smart Wallet Auth ✅ (commit `f7d497f`)
- Smart wallet IS the SIWE signer — no separate registration needed
- viem `verifyMessage` handles EOA, EIP-1271, and ERC-6492 natively
- `/wallet/register` exists as edge-case fallback only
- Smart wallet address is IMMUTABLE after first auth
- **116 tests cumulative**

### Phase 8-9: Production Hardening ✅ (commit `26ea8e7`)
- Rate limiting: Upstash Redis (sliding window) + in-memory fallback
- Global error handler, request logging, CORS lockdown
- Content-type enforcement, helmet security headers, 1MB body limit
- Graceful shutdown (SIGTERM → drain → exit)
- **122 tests, 35 routes**

### Post-deploy fixes:
- `6694d1d`: TypeScript strict mode fixes for clean Railway build
- `39847c5`: ESM/CJS interop fix for jsonwebtoken
- `74423e7`: CORS `origin: true` (reflects request origin for credentials)
- `535e58a`: SIWE nonce must be alphanumeric (strip UUID dashes)

---

## 5. What's Remaining

### Phase 6: On-Chain Integration 🔒 BLOCKED on smart contract
- **KYC whitelist call**: When Plaid IDV approves a user, call `addToWhitelist(smartWalletAddress)` on the deal contract. Needs: contract address, ABI, server-side signer EOA with admin role + Base ETH for gas.
- **Goldsky webhook expansion**: Handle `InvestmentMade`, `RedemptionProcessed`, `PaymentMade`, `DealClosed` events for notifications/activity feeds.
- **Estimated effort**: ~4-6 hours once contract is deployed.

### Deposit/Withdrawal Flow — Needs Circle Decision ⚠️
The deposit/withdrawal routes exist (`src/routes/transactions.ts`) but the actual Circle integration path depends on an outstanding decision. Three options documented below in §6. The current code handles Option 1 (manual wire) flow.

### NOT Backend Work (important clarification)
- **Investing/redeeming USDC into deals** = 100% on-chain + frontend
- **Position tracking / portfolio views** = frontend reads from contract + Goldsky subgraph
- **Interest/return distribution** = on-chain via smart contract
- The backend does NOT touch investment funds. Non-custodial.

### Accreditation Verification (future)
- Table exists (`accreditation_records`) but no routes/services built yet
- Needs: verification vendor (Verify Investor, Parallel Markets) OR custom flow
- Mark hasn't decided on vendor yet

### Email Notifications (future)
- No email service integrated yet
- Likely: Resend (free tier 100/day)
- Triggers: KYC approved, deposit received, withdrawal complete, deal updates

---

## 6. Open Questions & Blockers

### 🔴 CRITICAL: Circle Integration Path
Mark was checking with Circle on **Option 3** (as of 2026-02-27). No answer yet.

| Option | Flow | Status |
|--------|------|--------|
| **1: Manual Wire** | User wires to Circle VAN manually → USDC mints | Works today, high friction |
| **2: Third-Party ACH** | Plaid processor partner with MTL handles ACH | "For another day" — Mark has a provider |
| **3: Circle ACH** | Circle accepts ACH directly from end users | ⭐ Mark checking with Circle sales |

**Impact**: Option determines frontend deposit UX and whether we need additional backend ACH routes. Current code supports Option 1.

### 🔴 CRITICAL: Smart Contract
- Mark is building the deal contract on Base
- Once deployed, we need: address, ABI, admin role for our server signer
- Blocks Phase 6 (KYC whitelist call)

### 🟡 Compliance Counsel
- No compliance counsel identified yet
- Needed for: MTL exemption legal opinion, Reg D filing, privacy policy, ToS
- Mark knows this is a gap

### 🟡 Accreditation Vendor
- Who checks if investors are accredited? Not decided.
- Options: Verify Investor, Parallel Markets, Plaid Income+Assets, custom flow

### 🟢 Plaid Webhook Secret
- Plaid supports webhook signature verification
- We have `PLAID_WEBHOOK_SECRET` in .env.example but it's optional
- Should be required for production

---

## 7. Key Design Decisions

These are SETTLED. Don't revisit without Mark's approval.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Smart wallet = user identity | Yes | KYC ties to smart wallet, survives EOA rotation |
| Contract = source of truth | Yes | Never cache APY/rates/status in Supabase |
| Event-driven deal creation | Goldsky webhook | Zero trust in frontend — on-chain event creates DB row |
| No Thirdweb on backend | Correct | Wallet creation is 100% frontend. Backend uses viem only. |
| Column-level encryption | AES-256-GCM | For PII: SSN, bank tokens, KYC docs, wire instructions |
| Non-custodial | Mandatory | Liquid never holds funds. No MTL needed. |
| Express.js (not Next API routes) | Correct | Webhooks, background jobs, independent scaling |
| Supabase for DB + Storage | Yes | Mark has prior experience, consolidates services |
| Railway for hosting | Yes | Managed, SOC 2, Mark has admin access |
| CORS `origin: true` for sandbox | Yes | Lock to specific origins in production |
| SIWE nonce = alphanumeric | Yes | siwe library rejects dashes. Strip from UUID. |
| APP_DOMAIN = string match | Yes | SIWE `domain` field must match APP_DOMAIN env var |

---

## 8. Auth Deep Dive

**Full details**: `docs/ARCHITECTURE.md` §2 and `src/auth/`

### The SIWE Flow (invisible to user)
1. Frontend: Thirdweb SDK creates in-app wallet + smart account
2. Frontend: `GET /auth/challenge?wallet=<SMART_WALLET_ADDRESS>` → nonce
3. Frontend: Thirdweb `SiweAuthOptions` builds SIWE message + signs via smart account
4. Frontend: `POST /auth/verify { message, signature }` → JWT tokens + user profile
5. User doesn't know any of this happened — just clicked "Connect"

### Critical Implementation Details
- **SIWE message format**: Must match Thirdweb's `createLoginMessage` exactly, including `Not Before` field. See frontend commit `6a6428a`.
- **Nonce**: UUID with dashes stripped (siwe lib requires alphanumeric). See `535e58a`.
- **Domain**: Must match `APP_DOMAIN` env var on both frontend and backend. Currently `getliquid.io`.
- **Smart wallet signatures**: ERC-6492 for pre-deployed wallets. viem handles transparently.
- Mark's test wallet: `0x37eCBF9d18E5EB4245B804ee5Bf50200DC0041BF`

### Auth files
- `src/auth/challenge.ts` — nonce generation, SIWE message construction
- `src/auth/verify.ts` — signature verification via viem, user find-or-create
- `src/auth/jwt.ts` — JWT creation/validation, refresh token rotation
- `src/auth/router.ts` — /auth/challenge, /auth/verify, /auth/refresh, /auth/logout

---

## 9. External Services

### Plaid (KYC + Banking)
- **Products**: Identity Verification (KYC), Auth (bank account linking)
- **NOT using**: Transfer (would make us custodial), Balance (future consideration)
- **Sandbox**: `sandbox.plaid.com` — test credentials work
- **Client**: `src/lib/plaid.ts`
- **IDV template**: Configured in Plaid Dashboard, ID stored in `PLAID_IDV_TEMPLATE_ID`
- **Webhooks**: `POST /webhooks/plaid` — handles IDENTITY_VERIFICATION + ITEM events
- **Key point**: Plaid only useful for KYC unless Circle Option 3 works (see §6)

### Circle Mint (Fiat ↔ USDC)
- **Client**: `src/lib/circle.ts` — native fetch (NOT the `@circle-fin/circle-sdk`)
- **Features**: Wire instructions (VAN), deposits, payouts, balance check
- **Idempotency**: Every mutation uses UUID idempotency key
- **Sandbox**: `api-sandbox.circle.com` — has `POST /v1/mocks/payments/wire` for testing
- **0% fee**: Institutional Mint account, no fees on mint/redeem
- **Webhooks**: `POST /webhooks/circle` — transfer.completed, transfer.failed

### Goldsky (On-Chain Indexer)
- **Purpose**: Index DealFlow contract events → GraphQL API + webhooks
- **Already in use**: Mark's team uses Goldsky for subgraph operations
- **Webhook**: `POST /webhooks/goldsky` — DealCreated auto-creates DB row
- **Future events**: InvestmentMade, RedemptionProcessed, PaymentMade, DealClosed

### Supabase
- **Project**: `nqtoxctvcbfeyegergpb.supabase.co` (sandbox)
- **Uses**: Postgres (11 tables), Storage (deal documents), RLS policies
- **Client**: `src/lib/supabase.ts` — service role key (bypasses RLS for server ops)
- **Migrations**: `migrations/001-003` — all run on sandbox

### Base Network
- **Client**: `src/lib/base-client.ts` — viem public client (stub, ready for contract reads)
- **RPC**: `https://mainnet.base.org` (configurable via `BASE_RPC_URL`)
- **Not yet wired**: Needs contract address + ABI for Phase 6

---

## 10. Database & Migrations

### Tables (11 total, defined in migration 001)
| Table | Purpose |
|-------|---------|
| `users` | Core user record, wallet_address is primary identity |
| `kyc_records` | Plaid IDV status + encrypted PII (migration 002 adds columns) |
| `accreditation_records` | Investor accreditation status (schema exists, no routes yet) |
| `linked_accounts` | Plaid bank accounts, encrypted access tokens |
| `circle_accounts` | Circle VAN + wire instructions (encrypted) |
| `transactions` | All deposits/withdrawals/investments with status tracking |
| `deals` | Off-chain deal metadata (on-chain terms via Goldsky) |
| `deal_documents` | Document refs (Supabase Storage URLs) |
| `audit_log` | Every sensitive action logged |
| `sessions` | Refresh token hashes, device info, expiry |
| `wallets` | Smart wallet address per user (migration 001) |

### Running Migrations
Run in Supabase SQL Editor in order:
1. `migrations/001_initial_schema.sql` ✅ deployed
2. `migrations/002_kyc_encrypted_fields.sql` ✅ deployed
3. `migrations/003_storage_bucket.sql` ✅ deployed

### Encryption
- **Service**: `src/lib/encryption.ts` — AES-256-GCM
- **Key**: `ENCRYPTION_KEY` env var (hex-encoded 32 bytes)
- **Encrypted columns**: `plaid_access_token_encrypted`, `wire_instructions_encrypted`, `account_number_encrypted`, `routing_number_encrypted`, `full_name_encrypted`, `date_of_birth_encrypted`, `address_encrypted`, `phone_encrypted`, `id_document_number_encrypted`, `verification_summary_encrypted`
- ⚠️ **Losing ENCRYPTION_KEY = all encrypted data unrecoverable**

---

## 11. Deployment

### Current: Railway (sandbox)
- **URL**: `https://api.getliquid.io`
- **Health check**: `GET /health` ✅ confirmed working
- **Account**: Client's Railway account, Mark has admin access
- **Guide**: `docs/RAILWAY_SETUP.md`
- **Build**: `npm run build` (TypeScript → `dist/`)
- **Start**: `npm start` (runs `node dist/index.js`)

### Environment
- `NODE_ENV=sandbox` (not "development" or "production" — specifically "sandbox")
- `CORS_ORIGINS=*` for sandbox (lock down for production)
- `APP_DOMAIN=getliquid.io` on both backend and frontend

### New Environment Setup
Full guide in `docs/NEW_ENVIRONMENT_SETUP.md` — covers Supabase project, migrations, storage buckets, env vars.

---

## 12. Frontend Integration Notes

**Frontend repo**: `liquid-investor-frontend-sandbox` (Next.js 16 + React 19 + Thirdweb v5 + TailwindCSS 4)

### What's Built on Frontend
- **Phase 1**: Invisible SIWE auth after Thirdweb wallet connect (commit `6fa0aa2`)
- **Phase 2**: Plaid IDV modal, bank account linking, settings tab (commit `bc1753d`)
- **Phase 3 (deposit/withdrawal)**: BLOCKED on Circle decision

### Critical Frontend-Backend Contracts
- **SIWE message format**: Frontend uses Thirdweb's `SiweAuthOptions` — `buildSiweMessage` must match `createLoginMessage` exactly. Always include `Not Before`. See `lib/siwe-auth.ts`.
- **API client**: `lib/api.ts` — Axios instance with JWT interceptor, auto-refresh
- **Auth context**: `lib/auth-context.tsx` — manages JWT state, auto-SIWE after wallet connect
- **Env vars**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_DOMAIN`, `NEXT_PUBLIC_THIRDWEB_CLIENT_ID`

### Thirdweb Configuration
- **Client ID**: Set in `components/thirdweb-client.ts`
- **Chain**: Base (id: 8453)
- **Wallet**: In-app wallet (email/social) → smart account (ERC-4337)
- **Gas sponsorship**: Configured in Thirdweb dashboard paymaster
- **NO Thirdweb keys on backend** — ever

---

## 13. Security Requirements

### Non-Negotiable
- All PII encrypted at rest (AES-256-GCM column-level)
- TLS everywhere (Railway provides this)
- Plaid access tokens encrypted, never exposed to frontend
- Circle API key in env vars only, IP-restricted in production
- Webhook signature verification on all webhook endpoints
- Audit logging on all sensitive operations
- SIWE prevents replay attacks (nonce + expiry)
- Smart wallet address immutable after first auth

### Production Checklist (when ready)
- [ ] Lock CORS to specific origins
- [ ] Enable Plaid webhook signature verification (currently optional)
- [ ] Set up Upstash Redis for persistent rate limiting
- [ ] IP allowlist for Circle production API
- [ ] Review RLS policies in Supabase
- [ ] Enable Supabase database backups
- [ ] Set up monitoring/alerting

---

## 14. Testing

```bash
npm test              # Run all 122 tests
npm test -- --watch   # Watch mode
npm test -- src/__tests__/auth.test.ts  # Single file
```

### Test Architecture
- **Framework**: Vitest
- **Mocking**: Supabase client mocked via `src/__tests__/helpers/mock-supabase.ts`
- **No real DB calls in tests** — all mocked
- **No real external API calls** — Plaid/Circle mocked

| File | Tests | What it covers |
|------|-------|----------------|
| auth.test.ts | 11 | SIWE challenge/verify, JWT, smart wallet signatures |
| middleware.test.ts | 4 | requireAuth, requireKyc |
| schemas.test.ts | 14 | Zod validation for all request schemas |
| user.test.ts | 6 | User service CRUD |
| session.test.ts | 6 | Refresh token lifecycle |
| encryption.test.ts | 10 | AES-256-GCM encrypt/decrypt |
| kyc.test.ts | 8 | KYC initiation, status, webhook |
| bank-account.test.ts | 10 | Plaid link, exchange, list, deactivate |
| circle.test.ts | 9 | Circle client, deposits, payouts |
| transaction.test.ts | 12 | Deposit/withdrawal flows |
| deal.test.ts | 20 | Deal CRUD, documents, Goldsky webhook |
| smart-wallet.test.ts | 6 | Wallet registration, immutability |
| rate-limit.test.ts | 3 | Rate limiting behavior |
| error-handler.test.ts | 3 | Error middleware |

---

## 15. Environment Variables

See `.env.example` for full list with descriptions. Key ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Server port (3001) |
| `NODE_ENV` | Yes | `sandbox` or `production` |
| `JWT_SECRET` | Yes | 64-byte hex for JWT signing |
| `ENCRYPTION_KEY` | Yes | 32-byte hex for AES-256-GCM. **DO NOT LOSE** |
| `APP_DOMAIN` | Yes | Must match frontend's SIWE domain (`getliquid.io`) |
| `CORS_ORIGINS` | Yes | `*` for sandbox, specific origins for prod |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS) |
| `PLAID_CLIENT_ID` | Yes | Plaid client ID |
| `PLAID_SECRET` | Yes | Plaid secret (sandbox or prod) |
| `PLAID_ENV` | Yes | `sandbox` or `production` |
| `PLAID_IDV_TEMPLATE_ID` | Yes | Plaid IDV template ID |
| `CIRCLE_API_KEY` | Yes | Circle Mint API key |
| `BASE_RPC_URL` | Yes | Base network RPC endpoint |
| `UPSTASH_REDIS_REST_URL` | No | For persistent rate limiting (falls back to in-memory) |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash auth token |

---

## 16. Changelog / Sync Log

> **Convention**: When either agent makes changes, add a dated entry here.
> Keep entries brief — link to commits. Don't duplicate code.

### 2026-03-03
- Created this AGENTS.md handoff document (DeFiClawd)

### 2026-02-27
- Auth flow confirmed working end-to-end by Mark
- SIWE nonce fix: strip UUID dashes (`535e58a`)
- CORS fix: `origin: true` for wildcard+credentials (`74423e7`)
- SIWE message format fix on frontend (`6a6428a`)

### 2026-02-26
- Deployed to Railway: `https://api.getliquid.io` — health check confirmed
- TS strict mode fixes for Railway build (`6694d1d`)
- ESM/CJS interop fix for jsonwebtoken (`39847c5`)

### 2026-02-24
- Frontend Phase 2 complete: KYC + Bank Linking (frontend commit `bc1753d`)
- Circle integration decision documented — 3 options, Mark checking Option 3

### 2026-02-23
- Phases 1-5, 7, 8-9 built in one session
- Production hardened: rate limiting, error handling, CORS, graceful shutdown
- 122 tests, 35 routes
- Supabase sandbox configured, all 3 migrations deployed

---

## Quick Reference: What To Tell The Agent After Cloning

```
After cloning the repo, read these files in order:
1. AGENTS.md (this file) — full project context, what's built, what's remaining
2. docs/ARCHITECTURE.md — detailed architecture with code examples
3. docs/BUILD_STATUS.md — phase completion status + full route table
4. .env.example — all environment variables with descriptions
5. docs/NEW_ENVIRONMENT_SETUP.md — if setting up a fresh environment
```
