# Railway Deployment — Step by Step

## For: The client (project owner) setting up hosting

### Step 1: Create Railway Account
1. Go to https://railway.com and sign up
2. **Upgrade to Pro plan** ($5/mo) — required for custom domains and persistent deploys
3. Link your GitHub account when prompted

### Step 2: Create the Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Select the repo: `DeFiMark/liquid-backend-temp`
4. Railway will auto-detect Node.js and start building

### Step 3: Add Mark as Admin
1. In Railway dashboard, click the project name at the top
2. Go to **Settings** → **Members**
3. Click **"Invite Member"**
4. Enter Mark's email and set role to **Admin**
5. Mark will get an email invite — accept it to access the project

### Step 4: Configure Environment Variables
1. Click on the **service** (the deployed app)
2. Go to the **"Variables"** tab
3. Click **"Raw Editor"** (faster than one-by-one)
4. Paste ALL of these (Mark will fill in the values):

```env
# Server
PORT=3001
NODE_ENV=production
CORS_ORIGINS=https://getliquid.io

# Auth
JWT_SECRET=<GENERATE: run `openssl rand -hex 64` in terminal>
APP_DOMAIN=getliquid.io

# Supabase
SUPABASE_URL=https://nqtoxctvcbfeyegergpb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard — Settings → API → service_role>

# Encryption (CRITICAL — generate a unique key, store it somewhere safe)
ENCRYPTION_KEY=<GENERATE: run `openssl rand -hex 32` in terminal>

# Plaid
PLAID_CLIENT_ID=<from Plaid dashboard>
PLAID_SECRET=<sandbox or production secret>
PLAID_ENV=sandbox
PLAID_IDV_TEMPLATE_ID=idvtmp_cQtYXKD2pyZrSn
PLAID_WEBHOOK_URL=https://<your-railway-domain>/webhooks/plaid

# Circle
CIRCLE_API_KEY=<sandbox or production key>

# Base
BASE_RPC_URL=https://mainnet.base.org
```

**⚠️ CRITICAL:** The `ENCRYPTION_KEY` is used to encrypt/decrypt all sensitive user data (bank tokens, KYC PII). If you lose this key, ALL encrypted data becomes unrecoverable. Store it in a password manager (1Password, Bitwarden, etc.) immediately after generating it.

### Step 5: Configure Build & Deploy Settings
1. Go to service **Settings**
2. Set these:
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `node dist/index.js`
   - **Health Check Path:** `/health`
   - **Restart Policy:** On Failure (max 3 retries)

### Step 6: Deploy
1. Railway auto-deploys on every push to `main`
2. First deploy will take ~2 minutes (install + build)
3. Check the **Logs** tab to verify startup
4. You should see: `Liquid backend listening on port 3001`

### Step 7: Custom Domain (Optional — do this for production)
1. Go to service **Settings** → **Networking**
2. Click **"Generate Domain"** for a `*.up.railway.app` URL (free, instant)
3. OR click **"Custom Domain"** → enter `api.getliquid.io`
4. Railway will give you a CNAME record → add it to your DNS provider
5. TLS/HTTPS is automatic

### Step 8: Verify Deployment
```bash
# Test health check
curl https://<your-domain>/health
# Should return: {"status":"ok","timestamp":"..."}

# Test auth challenge
curl https://<your-domain>/auth/challenge?address=0x1234567890abcdef1234567890abcdef12345678
# Should return: {"nonce":"...","issuedAt":"...","expirationTime":"...","domain":"...","chainId":8453}
```

### Step 9: Configure Webhook URLs
After deployment, update these in their respective dashboards:

1. **Plaid Dashboard** → Webhooks → Set URL to:
   `https://<your-domain>/webhooks/plaid`

2. **Circle Dashboard** → Developer → Webhooks → Set URL to:
   `https://<your-domain>/webhooks/circle`

3. Update `PLAID_WEBHOOK_URL` env var in Railway to match

---

## For Mark: Technical Configuration

### After Getting Admin Access

1. **Verify env vars** — ensure all keys are set correctly in Variables tab
2. **Check logs** — first deploy should show clean startup, no missing env errors
3. **Test the auth flow** from the frontend against the Railway URL
4. **Monitor** — Railway Pro includes basic metrics (CPU, memory, requests)

### Switching to Production

When ready to go live, update these env vars:
- `PLAID_ENV=production` + new `PLAID_SECRET` (production key from Plaid)
- `CIRCLE_API_KEY` → production key
- `CORS_ORIGINS` → your production frontend URL
- `APP_DOMAIN` → your production domain
- `NODE_ENV=production` (already set)
- Generate a NEW `JWT_SECRET` (don't reuse sandbox)
- `PLAID_IDV_TEMPLATE_ID` → production template

### Cost Estimate
- Railway Pro: $5/mo base
- Compute: ~$5-10/mo for a single service (auto-scales)
- Total: ~$10-15/mo for sandbox/staging
- Production with more traffic: ~$20-50/mo

### Security Notes
- Railway provides SOC 2 compliant infrastructure
- All traffic is TLS encrypted in transit
- Environment variables are encrypted at rest in Railway
- The app encrypts sensitive data (KYC PII, bank tokens) at the application level before storing in Supabase
- Supabase has its own encryption at rest for the database

---

## Quick Reference

| What | Where |
|------|-------|
| Railway Dashboard | https://railway.com/dashboard |
| Logs | Railway → Service → Logs tab |
| Env Vars | Railway → Service → Variables tab |
| Deploys | Auto on push to `main` |
| Health Check | `GET /health` |
| Supabase Dashboard | https://supabase.com/dashboard/project/nqtoxctvcbfeyegergpb |
| Plaid Dashboard | https://dashboard.plaid.com |
| Circle Dashboard | https://app-sandbox.circle.com (sandbox) |
