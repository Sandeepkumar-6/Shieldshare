import { pipeline } from 'node:stream/promises';
import { uploadedBlob } from '../middleware/upload.js';
import * as fileService from '../services/file.service.js';
import { toActivityDTO, toFileDTO, toVersionDTO } from '../utils/dto.js';
import { pageMeta } from '../utils/pagination.js';
import { contextFrom } from '../utils/requestContext.js';

export async function list(req, res) {
  const query = req.valid.query;
  const { items, total, shareCounts } = await fileService.listFiles(contextFrom(req), query);
  res.json({
    data: items.map((file) => toFileDTO(file, { shareCount: shareCounts.get(String(file._id)) ?? 0 })),
    meta: pageMeta(query, total),
  });
}

export async function upload(req, res) {
  const folderId = typeof req.body?.folderId === 'string' && req.body.folderId ? req.body.folderId : undefined;
  const { file, version } = await fileService.uploadFile(contextFrom(req), { blob: uploadedBlob(req), folderId });
  res.status(201).json({ data: { file: toFileDTO(file), version: toVersionDTO(version, file.currentVersion) } });
}

export async function get(req, res) {
  const { file, shareCount } = await fileService.getFile(contextFrom(req), req.valid.params.id);
  res.json({ data: toFileDTO(file, { shareCount }) });
}

// Checked before the upload streams, so a missing or read-only file is rejected up front.
export async function assertModifiable(req, res, next) {
  await fileService.assertModifiable(contextFrom(req), req.valid.params.id);
  next();
}

export async function modifyContent(req, res) {
  const { file, version } = await fileService.modifyContent(contextFrom(req), req.valid.params.id, uploadedBlob(req));
  res.json({ data: { file: toFileDTO(file), version: toVersionDTO(version, file.currentVersion) } });
}

export async function update(req, res) {
  const file = await fileService.updateFile(contextFrom(req), req.valid.params.id, req.valid.body);
  res.json({ data: toFileDTO(file) });
}

export async function remove(req, res) {
  await fileService.deleteFile(contextFrom(req), req.valid.params.id);
  res.status(204).end();
}

export async function listVersions(req, res) {
  const { file, versions } = await fileService.listVersions(contextFrom(req), req.valid.params.id);
  res.json({ data: versions.map((version) => toVersionDTO(version, file.currentVersion)) });
}

export async function download(req, res) {
  const { stream, name, size } = await fileService.openDownload(
    contextFrom(req),
    req.valid.params.id,
    req.valid.query.versionId,
  );
  res.attachment(name);
  res.type('application/octet-stream');
  res.set('Cache-Control', 'no-store');
  if (Number.isFinite(size)) res.set('Content-Length', String(size));
  try {
    await pipeline(stream, res);
  } catch (error) {
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error; // client went away
  }
}

export async function verify(req, res) {
  const result = await fileService.verifyVersion(contextFrom(req), req.valid.params.id, req.valid.body.versionId);
  res.json({ data: result });
}

export async function restore(req, res) {
  const { file, newVersion, verification } = await fileService.restoreVersion(
    contextFrom(req),
    req.valid.params.id,
    req.valid.params.versionId,
  );
  res.json({
    data: {
      file: toFileDTO(file),
      newVersion: toVersionDTO(newVersion, file.currentVersion),
      verification,
    },
  });
}

export async function listActivity(req, res) {
  const query = req.valid.query;
  const { items, total } = await fileService.listFileActivity(contextFrom(req), req.valid.params.id, query);
  res.json({ data: items.map(toActivityDTO), meta: pageMeta(query, total) });
}
