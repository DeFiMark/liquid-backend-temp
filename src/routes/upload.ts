import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { supabase } from '../lib/supabase.js';
import multer from 'multer';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

router.post('/deal-document',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const dealId = req.body.dealId;
      if (!dealId) {
        res.status(400).json({ error: 'dealId is required' });
        return;
      }

      const ext = req.file.originalname.split('.').pop() || 'bin';
      const path = `deals/${dealId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('deal-documents')
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage
        .from('deal-documents')
        .getPublicUrl(path);

      res.json({
        fileUrl: urlData.publicUrl,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        storagePath: path,
      });
    } catch (err: any) {
      if (err.message === 'File type not allowed') {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('Upload error:', err);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  }
);

export default router;
