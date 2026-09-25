import { Router } from 'express';
import { z } from 'zod';
import * as shares from '../controllers/share.controller.js';
import { authenticate, requireNotFrozen } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { paginationQuery } from '../utils/pagination.js';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// POST /api/files/:id/shares (mounted from file.routes.js)
export const createShareBody = z.object({
  permission: z.enum(['VIEW', 'DOWNLOAD'], 'Choose View or Download.'),
  expiresAt: z.string('Choose when the link expires.')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid expiry date.'),
  recipientLabel: z.string()
    .trim()
    .max(254, 'Recipient labels can be at most 254 characters.')
    .refine((value) => !CONTROL_CHARS.test(value), 'Recipient labels cannot contain control characters.')
    .optional(),
  password: z.string()
    .min(8, 'Link passwords must be at least 8 characters.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Link passwords can be at most 72 bytes long.')
    .optional(),
});

const listQuery = z.object({
  ...paginationQuery,
  fileId: objectId.optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED'], 'Unknown link status.').optional(),
});

// /api/shares — the signed-in user's own links (api-contract §2.4)
const router = Router();

router.get('/', authenticate, validate({ query: listQuery }), shares.list);
router.delete('/:id', authenticate, requireNotFrozen, validate({ params: z.object({ id: objectId }) }), shares.revoke);

export default router;
