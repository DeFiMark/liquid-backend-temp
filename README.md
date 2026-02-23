# Liquid Backend

Backend API server for [Liquid](https://getliquid.io) — a private credit marketplace on Base.

## Stack

- **Runtime:** Node.js + Express.js + TypeScript
- **Database:** Supabase (Postgres)
- **Auth:** SIWE (Sign-In With Ethereum) + EIP-1271 smart wallet support
- **Blockchain:** Base (Thirdweb smart wallets, Circle USDC)
- **KYC:** Plaid Identity Verification
- **Payments:** Circle Mint (institutional USDC mint/redeem)

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full backend architecture document.

## Setup

```bash
npm install
cp .env.example .env  # Configure environment variables
npm run dev
```

## License

Private — All rights reserved.
