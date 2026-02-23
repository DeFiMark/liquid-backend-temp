# Liquid Backend — Build Status

## Completed

### Phase 0: Project Setup
- [x] Express.js + TypeScript + vitest scaffolding
- [x] Git repo: `DeFiMark/liquid-backend-temp`
- [x] Architecture doc: `docs/ARCHITECTURE.md` (v1.2)

### Phase 1: Auth + User Management (commit `8c89454`)
- [x] SIWE authentication (challenge → verify → JWT)
- [x] EIP-1271 smart wallet support (viem auto-handles)
- [x] JWT tokens: 15m access + 7d refresh, role-aware
- [x] Supabase client (service role, test-env graceful)
- [x] Migration 001: 11 tables, indexes, triggers, RLS
- [x] User service: find/create/update, profile with KYC+accreditation joins
- [x] Session service: SHA-256 hashed tokens, create/validate/rotate/cleanup
- [x] Zod validation middleware
- [x] Audit logging middleware (fire-and-forget)
- [x] User routes: GET/PUT `/users/profile`
- [x] requireAuth + requireKyc middleware

### Phase 2: Encryption + KYC Pipeline (commit `5541bfb`)
- [x] AES-256-GCM encryption service (encrypt/decrypt)
- [x] Plaid client configured from env vars
- [x] KYC service: initiate IDV, status check, webhook handler
- [x] KYC routes: POST `/kyc/initiate`, GET `/kyc/status`
- [x] Webhook routes: Plaid (signature verified), Circle (stub), Goldsky (stub)
- [x] IDV approval auto-activates user, sets 1yr expiry

### Phase 3: Bank Account Linking (commit `f053407`)
- [x] Plaid Link token creation
- [x] Public token exchange + encrypted storage
- [x] Processor token creation (for Circle) — with IDOR fix
- [x] Account listing, detail, deactivation
- [x] ITEM webhook handling (errors, expiration)
- [x] Only checking/savings accounts allowed

### Phase 4: Circle Mint + Transactions + Admin (commit `174a76d`)
- [x] Circle client (native fetch, idempotency keys, sandbox/production toggle)
- [x] Deposit flow: wire instructions + user-specific memo for attribution
- [x] Withdrawal flow: linked account ownership check + transaction record
- [x] Transaction history with type/status filters + pagination
- [x] Circle webhook handling (deposit completion, payout status)
- [x] Admin routes: Circle balance, deposits, payouts, user management, audit log
- [x] Health check endpoint (`GET /health`)
- [x] requireAdmin middleware (role-based)

### Phase 5: Deal Management
- [ ] Goldsky webhook handler (deal events)
- [ ] Deal metadata CRUD (borrower-side)
- [ ] Deal document upload (Supabase Storage)
- [ ] Deal query endpoints (investor-side)

### Phase 6: Investment Flow
- [ ] Investment initiation (deposit → USDC → on-chain)
- [ ] Position tracking via contract reads
- [ ] Withdrawal/redemption flow
- [ ] Transaction history

### Phase 7: Smart Wallets (Thirdweb)
- [ ] Proactive smart wallet creation on registration
- [ ] Gas sponsorship configuration
- [ ] Wallet recovery / EOA rotation support

### Phase 8: Admin & Monitoring
- [ ] Admin routes (user management, deal oversight)
- [ ] Health check endpoint
- [ ] Error tracking setup (Sentry or similar)
- [ ] Rate limiting on public endpoints

### Phase 9: Production Hardening
- [ ] Railway deployment config
- [ ] Production encryption key rotation plan
- [ ] Webhook signature verification (all providers)
- [ ] CORS lockdown
- [ ] Request logging + audit trail export

## Test Coverage
| Phase | Tests | Files |
|-------|-------|-------|
| Auth | 11 | auth.test.ts |
| Middleware | 4 | middleware.test.ts |
| Schemas | 14 | schemas.test.ts |
| User Service | 6 | user.test.ts |
| Sessions | 6 | session.test.ts |
| Encryption | 10 | encryption.test.ts |
| KYC | 8 | kyc.test.ts |
| Bank Accounts | 10 | bank-account.test.ts |
| Circle Client | 9 | circle.test.ts |
| Transactions | 12 | transaction.test.ts |
| **Total** | **90** | **10 files** |

## API Routes
| Method | Path | Auth | KYC | Description |
|--------|------|------|-----|-------------|
| GET | `/auth/challenge` | ❌ | ❌ | Get SIWE challenge |
| POST | `/auth/verify` | ❌ | ❌ | Verify SIWE + get tokens |
| POST | `/auth/refresh` | ❌ | ❌ | Refresh JWT tokens |
| POST | `/auth/logout` | ✅ | ❌ | Invalidate session |
| GET | `/users/profile` | ✅ | ❌ | Get user profile |
| PUT | `/users/profile` | ✅ | ❌ | Update profile |
| POST | `/kyc/initiate` | ✅ | ❌ | Start Plaid IDV |
| GET | `/kyc/status` | ✅ | ❌ | Check KYC status |
| POST | `/accounts/link-token` | ✅ | ✅ | Get Plaid Link token |
| POST | `/accounts/exchange` | ✅ | ✅ | Exchange + store account |
| GET | `/accounts` | ✅ | ❌ | List linked accounts |
| GET | `/accounts/:id` | ✅ | ❌ | Get account detail |
| DELETE | `/accounts/:id` | ✅ | ❌ | Deactivate account |
| POST | `/accounts/:id/processor-token` | ✅ | ✅ | Create processor token |
| POST | `/transactions/deposit` | ✅ | ✅ | Initiate deposit (wire instructions) |
| POST | `/transactions/withdraw` | ✅ | ✅ | Initiate withdrawal |
| GET | `/transactions` | ✅ | ❌ | Transaction history |
| GET | `/transactions/:id` | ✅ | ❌ | Single transaction |
| GET | `/admin/circle/balance` | admin | ❌ | Circle wallet balance |
| GET | `/admin/circle/deposits` | admin | ❌ | Recent Circle deposits |
| GET | `/admin/circle/payouts` | admin | ❌ | Recent Circle payouts |
| GET | `/admin/users` | admin | ❌ | List users (paginated) |
| PUT | `/admin/users/:id/status` | admin | ❌ | Update user status |
| GET | `/admin/audit` | admin | ❌ | Audit log |
| GET | `/health` | ❌ | ❌ | Health check |
| POST | `/webhooks/plaid` | sig | ❌ | Plaid webhooks |
| POST | `/webhooks/circle` | sig | ❌ | Circle webhooks |
| POST | `/webhooks/goldsky` | — | ❌ | Goldsky webhooks (stub) |
