import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import authRouter from './auth/router.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);

app.listen(port, () => {
  console.log(`Liquid backend listening on port ${port}`);
});

export default app;
