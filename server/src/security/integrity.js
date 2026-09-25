import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

// SHA-256 integrity helpers (spec §12). Hashing is always stream-based so large files are
// never loaded into memory.

export async function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

// Integrity verification: read the stored bytes, recompute SHA-256 and compare with the
// hash recorded for that version.
export async function verifyFileHash(filePath, expected) {
  let actual = null;
  try {
    actual = await sha256OfFile(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { passed: actual !== null && timingSafeEqualHex(actual, expected), expected, actual };
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
