import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';

// Blob storage. Blobs live under STORAGE_DIR/blobs/<key> where <key> is 48 random hex
// characters. User-supplied names never touch the filesystem, and every key is validated
// and resolved inside the blob directory before use (path traversal protection).
//
// Blobs are immutable: a new version always gets a new key, and version blobs are never
// overwritten or deleted by normal operations (soft delete keeps them; spec §6).

const BLOB_DIR = path.join(config.storageDir, 'blobs');
const KEY_PATTERN = /^[a-f0-9]{48}$/;

export async function ensureStorage() {
  await fsp.mkdir(BLOB_DIR, { recursive: true });
}

export function newStorageKey() {
  return crypto.randomBytes(24).toString('hex');
}

export function blobPath(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error('Invalid storage key.');
  }
  const resolved = path.resolve(BLOB_DIR, key);
  if (path.dirname(resolved) !== path.resolve(BLOB_DIR)) {
    throw new Error('Storage key resolved outside the blob directory.');
  }
  return resolved;
}

// Exclusive create: fails instead of overwriting if a key ever collided.
export function createBlobWriteStream(key) {
  return fs.createWriteStream(blobPath(key), { flags: 'wx' });
}

export function createBlobReadStream(key) {
  return fs.createReadStream(blobPath(key));
}

export async function copyBlob(sourceKey) {
  const targetKey = newStorageKey();
  await fsp.copyFile(blobPath(sourceKey), blobPath(targetKey), fs.constants.COPYFILE_EXCL);
  return targetKey;
}

// Stores a copy of a server-side file (e.g. a canary template) as a new blob.
export async function importFile(sourcePath) {
  const key = newStorageKey();
  await fsp.copyFile(sourcePath, blobPath(key), fs.constants.COPYFILE_EXCL);
  return key;
}

export async function blobExists(key) {
  try {
    await fsp.access(blobPath(key));
    return true;
  } catch {
    return false;
  }
}

// Only for cleaning up a blob whose operation failed before any record referenced it.
export async function discardUnreferencedBlob(key) {
  try {
    await fsp.unlink(blobPath(key));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[storage] failed to discard blob', error.code);
    }
  }
}
