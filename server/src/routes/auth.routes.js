import { Router } from 'express';
import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { objectId, validate } from '../middleware/validate.js';

const email = z.string('Enter your email address.')
  .trim()
  .toLowerCase()
  .max(254, 'Enter a valid email address.')
  .pipe(z.email('Enter a valid email address.'));

const registerBody = z.object({
  name: z.string('Enter your name.').trim().min(1, 'Enter your name.').max(100, 'Names can be at most 100 characters.'),
  email,
  password: z.string('Enter a password.')
    .min(8, 'Passwords must be at least 8 characters.')
    // bcrypt only uses the first 72 bytes
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Passwords can be at most 72 bytes long.'),
});

const loginBody = z.object({
  email: z.string('Enter your email address.').trim().toLowerCase().min(1, 'Enter your email address.').max(254),
  password: z.string('Enter your password.').min(1, 'Enter your password.').max(1024),
});

const router = Router();

router.post('/register', registerLimiter, validate({ body: registerBody }), auth.register);
router.post('/login', loginLimiter, validate({ body: loginBody }), auth.login);
router.post('/logout', authenticate, auth.logout);
router.get('/me', authenticate, auth.me);
router.get('/sessions', authenticate, auth.listSessions);
// Revoking a session is allowed while frozen: it only ends access, it never changes files.
router.delete('/sessions/:id', authenticate, validate({ params: z.object({ id: objectId }) }), auth.revokeSession);

export default router;
