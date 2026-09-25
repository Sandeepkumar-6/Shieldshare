import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/shieldai.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { objectId, validate } from '../middleware/validate.js';

// /api/ai/* (api-contract §2.11). Every signed-in account can talk to its assistant; the
// server picks the audience from the account's role (Shield AI for administrators, the member
// assistant for everyone else) and each audience only has its own tools. Action proposals and
// their confirmation exist for administrators only.
const router = Router();

// Pages the client may name so the assistant understands "this" (never trusted for access).
const PAGES = [
  'dashboard', 'files', 'file', 'shares', 'activity', 'security', 'assistant',
  'admin-overview', 'incidents', 'incident', 'alerts', 'users', 'admin-files', 'quarantine', 'recovery',
  'analytics', 'detection', 'audit', 'simulator', 'shield-ai',
];
const context = z.object({
  incidentId: objectId.optional(),
  fileId: objectId.optional(),
  userId: objectId.optional(),
  page: z.enum(PAGES).optional(),
}).strict();
const idParams = z.object({ id: objectId });

// The global API limiter covers every route. The stricter AI limit applies only where the
// language-model provider is called, so opening pages that show the assistant never trips it.
router.use(authenticate);
router.get('/status', controller.status);
router.get('/conversations', controller.listConversations);
router.post('/conversations', validate({ body: z.object({ context: context.optional() }).strict() }), controller.createConversation);
router.get('/conversations/:id', validate({ params: idParams }), controller.getConversation);
router.post('/conversations/:id/messages', aiLimiter, validate({
  params: idParams,
  body: z.object({ content: z.string().trim().min(1).max(4000), context: context.optional() }).strict(),
}), controller.sendMessage);
router.post('/actions/:id/confirm', requireRole('admin'), validate({ params: idParams }), controller.confirmAction);
router.post('/actions/:id/cancel', requireRole('admin'), validate({ params: idParams }), controller.cancelAction);

export default router;
