import { Router } from 'express';
import { z } from 'zod';
import * as folders from '../controllers/folder.controller.js';
import { authenticate, requireNotFrozen } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';

const idParams = z.object({ id: objectId });
const folderBody = z.object({ name: z.string('Enter a folder name.') });

const router = Router();

router.get('/', authenticate, folders.list);
router.post('/', authenticate, requireNotFrozen, validate({ body: folderBody }), folders.create);
router.patch('/:id', authenticate, requireNotFrozen, validate({ params: idParams, body: folderBody }), folders.rename);
router.delete('/:id', authenticate, requireNotFrozen, validate({ params: idParams }), folders.remove);

export default router;
