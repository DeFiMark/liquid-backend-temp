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

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);
app.use('/users', userRouter);
app.use('/webhooks', webhookRouter);
app.use('/kyc', kycRouter);
app.use('/accounts', bankAccountRouter);
app.use('/transactions', transactionRouter);
app.use('/admin', adminRouter);
app.use('/deals', dealRouter);
app.use('/upload', uploadRouter);
app.use('/wallet', walletRouter);

// Periodic session cleanup — every hour
setInterval(() => cleanupExpiredSessions(), 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`Liquid backend listening on port ${port}`);
});

export default app;
