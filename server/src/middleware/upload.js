import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config/env.js';
import { ALLOWED_MIME_TYPES, ALLOWED_TYPES, GENERIC_MIME_TYPES } from '../config/uploads.js';
import * as storage from '../services/storage.service.js';
import { errors } from '../utils/AppError.js';
import { extensionOf, validateFileName } from '../utils/filename.js';

// Multer storage engine that streams the upload straight into a new random-key blob while
// computing SHA-256 on the same stream (one pass, never buffered in memory).
const blobStorageEngine = {
  _handleFile(req, file, cb) {
    const key = storage.newStorageKey();
    file.storageKey = key; // known to _removeFile even if the write fails midway

    const hash = crypto.createHash('sha256');
    let size = 0;
    let settled = false;
    const out = storage.createBlobWriteStream(key);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      file.stream.unpipe(out);
      out.destroy();
      storage.discardUnreferencedBlob(key).finally(() => cb(error));
    };

    file.stream.on('data', (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    file.stream.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      cb(null, { storageKey: key, size, sha256: hash.digest('hex') });
    });
    file.stream.pipe(out);
  },

  _removeFile(req, file, cb) {
    if (!file.storageKey) return cb(null);
    storage.discardUnreferencedBlob(file.storageKey).finally(() => cb(null));
  },
};

// New file: validate the client-supplied name, extension and declared MIME type before a
// single byte is written. preservePath is on so "../../x.txt" arrives intact and is
// rejected, instead of being silently reduced to "x.txt".
function newFileFilter(req, file, cb) {
  try {
    const name = validateFileName(file.originalname);
    const ext = extensionOf(name);
    const allowed = ALLOWED_TYPES[ext];
    if (!allowed) {
      throw errors.unsupportedType(ext
        ? `${ext} files can't be uploaded to ShieldShare.`
        : 'Files without an extension can\'t be uploaded to ShieldShare.');
    }
    const declared = (file.mimetype || '').toLowerCase();
    if (!allowed.includes(declared) && !GENERIC_MIME_TYPES.includes(declared)) {
      throw errors.unsupportedType(`The file's declared type (${declared}) doesn't match its ${ext} extension.`);
    }
    file.validatedName = name;
    file.canonicalMimeType = allowed[0];
    cb(null, true);
  } catch (error) {
    cb(error);
  }
}

// New content for an existing file: the stored name is kept, so only the declared type is
// checked against the global allowlist.
function newContentFilter(req, file, cb) {
  const declared = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(declared) && !GENERIC_MIME_TYPES.includes(declared)) {
    return cb(errors.unsupportedType('This type of content can\'t be uploaded to ShieldShare.'));
  }
  cb(null, true);
}

function makeUploader(fileFilter) {
  const middleware = multer({
    storage: blobStorageEngine,
    fileFilter,
    preservePath: true,
    defParamCharset: 'utf8',
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4, fieldSize: 256, parts: 5 },
  }).single('file');

  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (error) return next(translateMulterError(error));
      if (!req.file) return next(errors.validation('Choose a file to upload.'));
      next();
    });
  };
}

function translateMulterError(error) {
  if (!(error instanceof multer.MulterError)) return error;
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return errors.fileTooLarge(config.maxUploadBytes);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return errors.validation('Send exactly one file in the "file" field.');
    default:
      return errors.validation('The upload could not be read.');
  }
}

export const uploadNewFile = makeUploader(newFileFilter);
export const uploadNewContent = makeUploader(newContentFilter);

// The stored blob as seen by the file service.
export function uploadedBlob(req) {
  return {
    storageKey: req.file.storageKey,
    size: req.file.size,
    sha256: req.file.sha256,
    name: req.file.validatedName,
    mimeType: req.file.canonicalMimeType,
  };
}
