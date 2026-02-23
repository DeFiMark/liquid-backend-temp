import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import authRouter from './auth/router.js';
import userRouter from './routes/user.js';
import kycRouter from './routes/kyc.js';
import webhookRouter from './routes/webhooks.js';
import bankAccountRouter from './routes/bank-accounts.js';
import transactionRouter from './routes/transactions.js';
import adminRouter from './routes/admin.js';
import dealRouter from './routes/deals.js';
import uploadRouter from './routes/upload.js';
import walletRouter from './routes/wallet.js';
import { cleanupExpiredSessions } from './services/session.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimitAuth, rateLimitApi, rateLimitUpload, rateLimitWebhook } from './middleware/rateLimit.js';

const app = express();
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false,       // API server, not serving HTML
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------------------
// CORS — locked down in production
// ---------------------------------------------------------------------------
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : (process.env.NODE_ENV === 'production' ? false : '*'),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Content-type enforcement (non-GET, non-webhook, non-upload)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (
    req.method !== 'GET' &&
    req.method !== 'OPTIONS' &&
    !req.path.startsWith('/webhooks') &&
    !req.path.startsWith('/upload') &&
    req.headers['content-type'] &&
    !req.headers['content-type'].includes('application/json') &&
    !req.headers['content-type'].includes('multipart/form-data')
  ) {
    res.status(415).json({ error: 'Unsupported content type' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Request logging (after parsing, before routes)
// ---------------------------------------------------------------------------
app.use(requestLogger);

// ---------------------------------------------------------------------------
// Health check — no auth, no rate limit
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Routes with rate limiting
// ---------------------------------------------------------------------------
app.use('/auth', rateLimitAuth, authRouter);
app.use('/webhooks', rateLimitWebhook, webhookRouter);
app.use('/upload', rateLimitUpload, uploadRouter);

// General API rate limit applied to remaining routes
app.use('/users', rateLimitApi, userRouter);
app.use('/kyc', rateLimitApi, kycRouter);
app.use('/accounts', rateLimitApi, bankAccountRouter);
app.use('/transactions', rateLimitApi, transactionRouter);
app.use('/admin', rateLimitApi, adminRouter);
app.use('/deals', rateLimitApi, dealRouter);
app.use('/wallet', rateLimitApi, walletRouter);

// ---------------------------------------------------------------------------
// Global error handler (MUST be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Periodic session cleanup — every hour
// ---------------------------------------------------------------------------
setInterval(() => cleanupExpiredSessions(), 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Start server with graceful shutdown
// ---------------------------------------------------------------------------
const server = app.listen(port, () => {
  console.log(`Liquid backend listening on port ${port}`);
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.log('[WARN] Upstash Redis not configured — rate limiting using in-memory fallback');
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => process.exit(1), 10_000);
});

export default app;
