import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../schemas/user.js';
import { auditLog } from '../middleware/auditLog.js';
import { getUserProfile, updateUserProfile } from '../services/user.js';

const router = Router();

// GET /users/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user!.id);
    res.json({ user: profile });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// PUT /users/profile
router.put('/profile',
  requireAuth,
  validate(updateProfileSchema),
  auditLog('update_profile', 'user'),
  async (req, res) => {
    try {
      const updates: any = {};
      if (req.body.email !== undefined) updates.email = req.body.email;
      if (req.body.profile_data !== undefined) updates.profile_data = req.body.profile_data;
      if (req.body.terms_accepted) updates.terms_accepted_at = new Date().toISOString();
      if (req.body.privacy_accepted) updates.privacy_accepted_at = new Date().toISOString();

      const user = await updateUserProfile(req.user!.id, updates);
      res.json({ user });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

export default router;
