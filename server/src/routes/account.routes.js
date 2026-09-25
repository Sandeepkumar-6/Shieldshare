import { Router } from 'express';
import { z } from 'zod';
import * as account from '../controllers/account.controller.js';
import { authenticate } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { paginationQuery } from '../utils/pagination.js';

// /api/me/* — the signed-in user's own data (api-contract §2.5)
const router = Router();

router.use(authenticate);
router.get('/security', account.security);
router.get('/activity', validate({ query: z.object(paginationQuery) }), account.activity);
router.get('/dashboard', account.dashboard);
router.get('/file-access-requests', validate({ query: z.object(paginationQuery) }), account.fileAccessRequests);
router.post('/file-access-requests/:id/respond', validate({
  params: z.object({ id: objectId }),
  body: z.object({ decision: z.enum(['APPROVE', 'DENY']) }),
}), account.respondToFileAccessRequest);

export default router;
