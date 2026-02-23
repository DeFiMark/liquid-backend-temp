# Liquid Backend — Deployment Guide

## Target: Railway (Managed)

### Prerequisites
- Railway account with Pro plan (for custom domains, persistent storage)
- Custom domain for API (e.g., `api.getliquid.io`)
- All environment variables configured (see below)

### Environment Variables

```env
# === REQUIRED ===

# Server
PORT=3001
NODE_ENV=production
CORS_ORIGINS=https://getliquid.io

# Auth
JWT_SECRET=<generate: openssl rand -hex 64>
APP_DOMAIN=getliquid.io

# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>

# Encryption (REQUIRED in production — do NOT fall back to JWT_SECRET)
ENCRYPTION_KEY=<generate: openssl rand -hex 32>

# Plaid (Production)
PLAID_CLIENT_ID=<from Plaid dashboard>
PLAID_SECRET=<production secret>
PLAID_ENV=production
PLAID_IDV_TEMPLATE_ID=<from Plaid IDV Templates>
PLAID_WEBHOOK_URL=https://api.getliquid.io/webhooks/plaid
PLAID_WEBHOOK_SECRET=<from Plaid webhook settings>

# Circle (Production)
CIRCLE_API_KEY=<production API key>

# Base
BASE_RPC_URL=https://mainnet.base.org

# === OPTIONAL ===

# Thirdweb (for smart wallet creation)
THIRDWEB_SECRET_KEY=<if needed for server-side AA>
```

### Database Setup

1. Create Supabase project (or use existing)
2. Run migration in SQL Editor:
   - `migrations/001_initial_schema.sql` — creates all 11 tables, indexes, triggers, RLS
3. Future migrations will be numbered sequentially (002, 003, etc.)

### Railway Setup

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create project
railway init

# Link to repo
railway link

# Set env vars (or use Railway dashboard)
railway variables set JWT_SECRET=xxx ...

# Deploy
railway up
```

### Railway Config (`railway.toml`)
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
healthcheckTimeout = 10
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### Build Command
```bash
npm ci && npm run build
```

### Post-Deploy Checklist
- [ ] Verify `/health` endpoint returns 200
- [ ] Configure custom domain in Railway
- [ ] Set up Plaid webhook URL in Plaid dashboard → `https://api.getliquid.io/webhooks/plaid`
- [ ] Set up Circle webhook URL → `https://api.getliquid.io/webhooks/circle`
- [ ] Set up Goldsky webhook URL → `https://api.getliquid.io/webhooks/goldsky`
- [ ] Enable HTTPS (Railway does this automatically)
- [ ] Verify CORS origins match frontend domain
- [ ] Test auth flow end-to-end
- [ ] Test Plaid Link flow in production mode
- [ ] Generate production ENCRYPTION_KEY and store securely

### Webhook URLs
| Service | Endpoint | Auth |
|---------|----------|------|
| Plaid | `POST /webhooks/plaid` | HMAC-SHA256 signature |
| Circle | `POST /webhooks/circle` | Circle signature header |
| Goldsky | `POST /webhooks/goldsky` | TBD |

### Auth Flow Note
The smart wallet signs SIWE directly (ERC-6492 for pre-deployed, EIP-1271 for deployed).
The backend does NOT use Thirdweb SDK — wallet creation is 100% frontend.
`wallet_address` in DB = the verified SIWE address = smart wallet = user identity.
See `docs/ARCHITECTURE.md` Section 2 for the full flow.

### Security Notes
- `ENCRYPTION_KEY` must be a 64-char hex string (32 bytes). Generate with `openssl rand -hex 32`
- In production, do NOT rely on JWT_SECRET fallback for encryption
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — never expose to client
- All sensitive fields (Plaid access tokens, wire instructions) encrypted at rest with AES-256-GCM
- Refresh tokens stored as SHA-256 hashes, never plaintext
