import { Router } from 'express';
import { z } from 'zod';
import * as files from '../controllers/file.controller.js';
import * as shares from '../controllers/share.controller.js';
import { createShareBody } from './share.routes.js';
import { authenticate, requireNotFrozen } from '../middleware/auth.js';
import { uploadNewContent, uploadNewFile } from '../middleware/upload.js';
import { objectId, validate } from '../middleware/validate.js';
import { paginationQuery } from '../utils/pagination.js';

const idParams = z.object({ id: objectId });

const listQuery = z.object({
  ...paginationQuery,
  folderId: objectId.optional(),
  q: z.string().trim().max(100, 'Search terms can be at most 100 characters.').optional(),
  sort: z.string().max(20).optional(),
  all: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

const updateBody = z.object({
  name: z.string('Enter a file name.').optional(),
  folderId: objectId.optional(),
}).refine((body) => body.name !== undefined || body.folderId !== undefined, 'Provide a new name or a folder.');

const router = Router();

// Write chain (api-contract §1): authenticate → requireNotFrozen → validate → handler,
// and each write service calls the detection hook after persisting.
router.get('/', authenticate, validate({ query: listQuery }), files.list);
router.post('/', authenticate, requireNotFrozen, uploadNewFile, files.upload);

router.get('/:id', authenticate, validate({ params: idParams }), files.get);
router.patch('/:id', authenticate, requireNotFrozen, validate({ params: idParams, body: updateBody }), files.update);
router.delete('/:id', authenticate, requireNotFrozen, validate({ params: idParams }), files.remove);

router.put(
  '/:id/content',
  authenticate,
  requireNotFrozen,
  validate({ params: idParams }),
  files.assertModifiable,
  uploadNewContent,
  files.modifyContent,
);

router.get(
  '/:id/download',
  authenticate,
  validate({ params: idParams, query: z.object({ versionId: objectId.optional() }) }),
  files.download,
);

router.get('/:id/versions', authenticate, validate({ params: idParams }), files.listVersions);
router.post(
  '/:id/versions/:versionId/restore',
  authenticate,
  requireNotFrozen,
  validate({ params: z.object({ id: objectId, versionId: objectId }) }),
  files.restore,
);

// Verification only reads stored bytes, so it stays available to frozen users.
router.post(
  '/:id/verify',
  authenticate,
  validate({ params: idParams, body: z.object({ versionId: objectId.optional() }) }),
  files.verify,
);

router.post(
  '/:id/shares',
  authenticate,
  requireNotFrozen,
  validate({ params: idParams, body: createShareBody }),
  shares.create,
);

router.get(
  '/:id/activity',
  authenticate,
  validate({ params: idParams, query: z.object(paginationQuery) }),
  files.listActivity,
);

export default router;
