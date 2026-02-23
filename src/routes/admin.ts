import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import * as circle from '../lib/circle.js';
import { supabase } from '../lib/supabase.js';

const router = Router();

// Admin middleware — check role
function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// GET /admin/circle/balance — Circle wallet balance
router.get('/circle/balance',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const balances = await circle.getWalletBalance();
      res.json({ balances });
    } catch (err: any) {
      console.error('Balance error:', err);
      res.status(500).json({ error: 'Failed to get balance' });
    }
  }
);

// GET /admin/circle/deposits — Recent deposits
router.get('/circle/deposits',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const deposits = await circle.listDeposits({ pageSize: 50 });
      res.json({ deposits });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list deposits' });
    }
  }
);

// GET /admin/circle/payouts — Recent payouts
router.get('/circle/payouts',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const payouts = await circle.listPayouts({ pageSize: 50 });
      res.json({ payouts });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list payouts' });
    }
  }
);

// GET /admin/users — List users (paginated)
router.get('/users',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const { data, error, count } = await supabase
        .from('users')
        .select('id, wallet_address, smart_wallet_address, status, role, email, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({ users: data, total: count });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list users' });
    }
  }
);

// PUT /admin/users/:id/status — Update user status
router.put('/users/:id/status',
  requireAuth,
  requireAdmin,
  auditLog('admin_update_user_status', 'user'),
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!['pending', 'active', 'suspended', 'closed'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .update({ status })
        .eq('id', req.params.id)
        .select('id, status')
        .single();

      if (error) throw error;
      res.json({ user: data });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update user status' });
    }
  }
);

// GET /admin/audit — Audit log
router.get('/audit',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const { data, error, count } = await supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      res.json({ entries: data, total: count });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  }
);

export default router;
