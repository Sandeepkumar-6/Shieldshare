import path from 'node:path';
import { errors } from './AppError.js';

// File names are logical labels stored in MongoDB; blobs are stored under random keys, so a
// file name never becomes a filesystem path. Names are still validated strictly: anything
// that looks like a path (separators, "." / "..") is rejected rather than silently cleaned,
// so traversal attempts are visible to the caller.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PATH_SEPARATORS = /[/\\]/;
const RESERVED_CHARS = /[<>:"|?*]/;
const MAX_NAME_LENGTH = 255;

export function validateFileName(rawName) {
  if (typeof rawName !== 'string') {
    throw errors.validation('A file name is required.');
  }
  const name = rawName.normalize('NFC').trim();

  if (!name) {
    throw errors.validation('A file name is required.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw errors.validation(`File names can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (PATH_SEPARATORS.test(name) || name === '.' || name === '..') {
    throw errors.validation('File names cannot contain path separators or refer to a directory.');
  }
  if (CONTROL_CHARS.test(name)) {
    throw errors.validation('File names cannot contain control characters.');
  }
  if (RESERVED_CHARS.test(name)) {
    throw errors.validation('File names cannot contain < > : " | ? or *.');
  }
  return name;
}

export function extensionOf(name) {
  return path.extname(name).toLowerCase();
}
