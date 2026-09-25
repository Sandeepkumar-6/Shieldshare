import * as authService from '../services/auth.service.js';
import { toSessionDTO, toUserDTO } from '../utils/dto.js';
import { contextFrom } from '../utils/requestContext.js';

export async function register(req, res) {
  const { user, accessToken } = await authService.register(contextFrom(req), req.valid.body);
  res.status(201).json({ data: { user: toUserDTO(user), accessToken } });
}

export async function login(req, res) {
  const { user, accessToken } = await authService.login(contextFrom(req), req.valid.body);
  res.json({ data: { user: toUserDTO(user), accessToken } });
}

export async function logout(req, res) {
  await authService.logout(contextFrom(req));
  res.status(204).end();
}

export async function me(req, res) {
  res.json({ data: { user: toUserDTO({ _id: req.user.id, ...req.user }) } });
}

export async function listSessions(req, res) {
  const ctx = contextFrom(req);
  const sessions = await authService.listSessions(ctx);
  res.json({ data: sessions.map((session) => toSessionDTO(session, ctx.sessionId)) });
}

export async function revokeSession(req, res) {
  await authService.revokeOwnSession(contextFrom(req), req.valid.params.id);
  res.status(204).end();
}
