import { Router } from 'express';
import crypto from 'crypto';
import { handleIDVWebhook } from '../services/kyc.js';
import { handleItemWebhook } from '../services/bank-account.js';
import { handleCircleDeposit, handleCirclePayout } from '../services/transaction.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

function verifyPlaidWebhook(body: string, signature: string | undefined): boolean {
  if (!signature || !process.env.PLAID_WEBHOOK_SECRET) {
    if (process.env.PLAID_ENV === 'sandbox') return true;
    return false;
  }

  const hash = crypto
    .createHmac('sha256', process.env.PLAID_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(hash)
  );
}

router.post('/plaid', async (req, res) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['plaid-verification'] as string | undefined;

    if (!verifyPlaidWebhook(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const { webhook_type, webhook_code } = req.body;

    await supabase.from('audit_log').insert({
      action: 'webhook_received',
      resource_type: 'plaid',
      metadata: { webhook_type, webhook_code, timestamp: new Date().toISOString() },
    });

    switch (webhook_type) {
      case 'IDENTITY_VERIFICATION':
        await handleIDVWebhook(webhook_type, webhook_code, req.body);
        break;
      case 'ITEM':
        await handleItemWebhook(webhook_code, req.body);
        break;
      default:
        console.log(`Unhandled Plaid webhook: ${webhook_type}/${webhook_code}`);
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error('Plaid webhook error:', err);
    res.json({ received: true, error: err.message });
  }
});

router.post('/circle', async (req, res) => {
  try {
    const signature = req.headers['circle-signature'] as string | undefined;

    await supabase.from('audit_log').insert({
      action: 'webhook_received',
      resource_type: 'circle',
      metadata: { event_type: req.body.eventType, timestamp: new Date().toISOString() },
    });

    const eventType = req.body.Type || req.body.eventType;

    switch (eventType) {
      case 'transfers':
        await handleCircleDeposit(req.body);
        break;
      case 'payouts':
        await handleCirclePayout(req.body);
        break;
      default:
        console.log('Circle webhook received:', eventType);
    }

    res.json({ processed: true });
  } catch (err: any) {
    console.error('Circle webhook error:', err);
    res.json({ processed: true });
  }
});

router.post('/goldsky', async (req, res) => {
  try {
    console.log('Goldsky webhook received:', req.body.event_type);
    res.json({ processed: true });
  } catch (err: any) {
    console.error('Goldsky webhook error:', err);
    res.json({ processed: true });
  }
});

export default router;
