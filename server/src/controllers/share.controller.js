import { pipeline } from 'node:stream/promises';
import * as shareService from '../services/share.service.js';
import { toPublicShareDTO, toShareDTO } from '../utils/dto.js';
import { pageMeta } from '../utils/pagination.js';
import { contextFrom } from '../utils/requestContext.js';

// ── Owner (authenticated) ──────────────────────────────────────────────────────────────

export async function create(req, res) {
  const { link, file, token, url } = await shareService.createShare(contextFrom(req), req.valid.params.id, req.valid.body);
  // `token` and `url` appear in this response only; they cannot be retrieved later.
  res.status(201).json({ data: { share: toShareDTO(link, file), token, url } });
}

export async function list(req, res) {
  const query = req.valid.query;
  const { links, total, files } = await shareService.listShares(contextFrom(req), query);
  res.json({
    data: links.map((link) => toShareDTO(link, files.get(String(link.fileId)))),
    meta: pageMeta(query, total),
  });
}

export async function revoke(req, res) {
  await shareService.revokeShare(contextFrom(req), req.valid.params.id);
  res.status(204).end();
}

// ── Public (no authentication) ─────────────────────────────────────────────────────────

// Every public response carries these: the URL holds a secret, so it must not leak through
// caches or the Referer header.
function publicHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

export async function publicMetadata(req, res) {
  publicHeaders(res);
  const { link, file } = await shareService.publicMetadata(contextFrom(req), req.params.token);
  res.json({ data: toPublicShareDTO(link, file) });
}

export async function publicUnlock(req, res) {
  publicHeaders(res);
  const { accessToken, expiresAt } = await shareService.unlock(contextFrom(req), req.params.token, req.valid.body.password);
  res.json({ data: { accessToken, expiresAt } });
}

export async function publicDownload(req, res) {
  publicHeaders(res);
  const { stream, name, size } = await shareService.openPublicDownload(
    contextFrom(req),
    req.params.token,
    req.get('x-share-access'),
  );
  res.attachment(name);
  res.type('application/octet-stream');
  if (Number.isFinite(size)) res.set('Content-Length', String(size));
  try {
    await pipeline(stream, res);
  } catch (error) {
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
  }
}
