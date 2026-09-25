import { Router } from 'express';
import { z } from 'zod';
import * as shares from '../controllers/share.controller.js';
import { publicShareLimiter, shareUnlockPerIpLimiter, shareUnlockPerLinkLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

// /s/:token — public share-link access, no authentication (api-contract §2.4).
// Rate limited, and every unusable link answers with the same 410.
const router = Router();

router.use(publicShareLimiter);

router.get('/:token', shares.publicMetadata);
router.post(
  '/:token/unlock',
  shareUnlockPerIpLimiter,
  shareUnlockPerLinkLimiter,
  validate({ body: z.object({ password: z.string('Enter the password.').min(1, 'Enter the password.').max(1024) }) }),
  shares.publicUnlock,
);
router.get('/:token/download', shares.publicDownload);

export default router;
