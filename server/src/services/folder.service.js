import mongoose from 'mongoose';
import { FileModel, Folder } from '../models/index.js';
import { errors } from '../utils/AppError.js';
import { validateFileName } from '../utils/filename.js';

// Folders are logical records, never server paths (spec §6). Single level for the MVP.

export const ROOT_FOLDER_NAME = 'Home';
const MAX_FOLDER_NAME = 120;

export async function createRootFolder(userId) {
  return Folder.create({ ownerId: userId, name: ROOT_FOLDER_NAME, isRoot: true });
}

export async function getRootFolder(userId) {
  const folder = await Folder.findOne({ ownerId: userId, isRoot: true });
  if (!folder) {
    // Every account gets a root folder at registration; a missing one is a data problem.
    throw new Error(`Root folder missing for user ${userId}`);
  }
  return folder;
}

export async function getOwnedFolder(ctx, folderId) {
  if (!mongoose.isValidObjectId(folderId)) throw errors.notFound('Folder not found.');
  const folder = await Folder.findOne({ _id: folderId, ownerId: ctx.userId });
  if (!folder) throw errors.notFound('Folder not found.');
  return folder;
}

export async function listFolders(ctx) {
  return Folder.find({ ownerId: ctx.userId })
    .collation({ locale: 'en', strength: 2 })
    .sort({ isRoot: -1, name: 1 })
    .lean();
}

function validateFolderName(rawName) {
  const name = validateFileName(rawName);
  if (name.length > MAX_FOLDER_NAME) {
    throw errors.validation(`Folder names can be at most ${MAX_FOLDER_NAME} characters.`);
  }
  return name;
}

function duplicateName(error) {
  if (error?.code === 11000) {
    return errors.conflict('FOLDER_EXISTS', 'You already have a folder with that name.');
  }
  return error;
}

export async function createFolder(ctx, { name }) {
  try {
    return await Folder.create({ ownerId: ctx.userId, name: validateFolderName(name) });
  } catch (error) {
    throw duplicateName(error);
  }
}

export async function renameFolder(ctx, folderId, { name }) {
  const folder = await getOwnedFolder(ctx, folderId);
  if (folder.isRoot) {
    throw errors.conflict('ROOT_FOLDER_PROTECTED', 'Your Home folder can\'t be renamed.');
  }
  folder.name = validateFolderName(name);
  try {
    return await folder.save();
  } catch (error) {
    throw duplicateName(error);
  }
}

export async function deleteFolder(ctx, folderId) {
  const folder = await getOwnedFolder(ctx, folderId);
  if (folder.isRoot) {
    throw errors.conflict('ROOT_FOLDER_PROTECTED', 'Your Home folder can\'t be deleted.');
  }
  // Soft-deleted files still belong to the folder: they stay restorable (spec §6), so a
  // folder that holds them is not empty.
  const [liveFiles, deletedFiles] = await Promise.all([
    FileModel.countDocuments({ folderId: folder._id, status: { $ne: 'DELETED' } }),
    FileModel.countDocuments({ folderId: folder._id, status: 'DELETED' }),
  ]);
  if (liveFiles > 0) {
    throw errors.conflict('FOLDER_NOT_EMPTY', 'Move or delete the files in this folder first.');
  }
  if (deletedFiles > 0) {
    throw errors.conflict('FOLDER_NOT_EMPTY', 'This folder still holds deleted files that are kept for recovery, so it can\'t be removed.');
  }
  await Folder.deleteOne({ _id: folder._id });
}
