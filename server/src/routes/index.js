import { Router } from 'express';
import { config } from '../config/env.js';
import { notFoundHandler } from '../middleware/errorHandler.js';
import accountRoutes from './account.routes.js';
import adminRoutes from './admin.routes.js';
import authRoutes from './auth.routes.js';
import fileRoutes from './file.routes.js';
import folderRoutes from './folder.routes.js';
import shareRoutes from './share.routes.js';
import shieldaiRoutes from './shieldai.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/folders', folderRoutes);
router.use('/files', fileRoutes);
router.use('/shares', shareRoutes);
router.use('/me', accountRoutes);
router.use('/ai', shieldaiRoutes);
// Spec §30 rule 1: with the simulator disabled its routes do not exist, for everyone. This
// runs before authentication, so the answer is the ordinary 404, never 401 or 403.
router.use('/admin/simulator', (req, res, next) => (config.simulator.enabled ? next() : notFoundHandler(req, res, next)));
router.use('/admin', adminRoutes);

export default router;
