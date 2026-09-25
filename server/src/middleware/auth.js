import { resolveAccessToken } from '../services/auth.service.js';
import { errors } from '../utils/AppError.js';

// Verifies the bearer token, its Session (ACTIVE, unexpired) and tokenVersion, then loads
// role and status from the database on every request (spec §5).
export async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw errors.unauthenticated();
  }

  const { user, session } = await resolveAccessToken(token);
  req.user = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
  req.auth = { sessionId: String(session._id) };
  next();
}

export function requireRole(role) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user || req.user.role !== role) {
      throw errors.forbidden();
    }
    next();
  };
}

// Runs on every write route. A frozen user keeps read-only access (spec §5), and this
// applies to already-issued tokens because status is read from the database per request.
export function requireNotFrozen(req, res, next) {
  if (req.user?.status === 'FROZEN') {
    throw errors.userFrozen();
  }
  next();
}
