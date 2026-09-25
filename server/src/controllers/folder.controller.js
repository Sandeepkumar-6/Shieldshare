import * as folderService from '../services/folder.service.js';
import { toFolderDTO } from '../utils/dto.js';
import { contextFrom } from '../utils/requestContext.js';

export async function list(req, res) {
  const folders = await folderService.listFolders(contextFrom(req));
  res.json({ data: folders.map(toFolderDTO) });
}

export async function create(req, res) {
  const folder = await folderService.createFolder(contextFrom(req), req.valid.body);
  res.status(201).json({ data: toFolderDTO(folder) });
}

export async function rename(req, res) {
  const folder = await folderService.renameFolder(contextFrom(req), req.valid.params.id, req.valid.body);
  res.json({ data: toFolderDTO(folder) });
}

export async function remove(req, res) {
  await folderService.deleteFolder(contextFrom(req), req.valid.params.id);
  res.status(204).end();
}
