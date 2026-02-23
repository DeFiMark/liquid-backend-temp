import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import * as circle from '../lib/circle.js';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/encryption.js';

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

// GET /admin/users/:id/kyc — Decrypted KYC record for auditing
router.get('/users/:id/kyc',
  requireAuth,
  requireAdmin,
  auditLog('admin_view_kyc', 'kyc_record'),
  async (req, res) => {
    try {
      const { data: kycRecord, error } = await supabase
        .from('kyc_records')
        .select('*')
        .eq('user_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !kycRecord) {
        res.status(404).json({ error: 'KYC record not found' });
        return;
      }

      // Decrypt PII fields for admin viewing
      const decrypted: Record<string, any> = {
        id: kycRecord.id,
        user_id: kycRecord.user_id,
        provider: kycRecord.provider,
        status: kycRecord.status,
        plaid_idv_id: kycRecord.plaid_idv_id,
        email: kycRecord.email,
        id_document_type: kycRecord.id_document_type,
        aml_screening_result: kycRecord.aml_screening_result,
        submitted_at: kycRecord.submitted_at,
        verified_at: kycRecord.verified_at,
        expires_at: kycRecord.expires_at,
        data_retention_until: kycRecord.data_retention_until,
        rejection_reason: kycRecord.rejection_reason,
        created_at: kycRecord.created_at,
      };

      // Decrypt each encrypted field (gracefully handle missing/corrupt data)
      const encryptedFields: Array<[string, string]> = [
        ['full_name_encrypted', 'full_name'],
        ['date_of_birth_encrypted', 'date_of_birth'],
        ['address_encrypted', 'address'],
        ['phone_encrypted', 'phone'],
        ['id_document_number_encrypted', 'id_document_number'],
      ];

      for (const [encField, plainField] of encryptedFields) {
        if (kycRecord[encField]) {
          try {
            const val = decrypt(kycRecord[encField]);
            // address is stored as JSON string
            decrypted[plainField] = plainField === 'address' ? JSON.parse(val) : val;
          } catch {
            decrypted[plainField] = '[decryption failed]';
          }
        } else {
          decrypted[plainField] = null;
        }
      }

      // Full verification summary (large — only include if requested)
      if (req.query.full === 'true' && kycRecord.verification_summary_encrypted) {
        try {
          decrypted.verification_summary = JSON.parse(decrypt(kycRecord.verification_summary_encrypted));
        } catch {
          decrypted.verification_summary = '[decryption failed]';
        }
      }

      res.json({ kyc: decrypted });
    } catch (err: any) {
      console.error('KYC fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch KYC record' });
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
