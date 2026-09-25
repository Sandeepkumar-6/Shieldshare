import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Seed content for the demo workspace (spec §30 rule 4). The simulator reads files ONLY from
// server/demo-data/, and every path is resolved with realpath and checked to be inside that
// directory, so "../", absolute paths and symbolic links pointing elsewhere are refused
// before anything is read. It never writes to disk.

export const DEMO_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo-data');
export const DEMO_FOLDERS = Object.freeze(['documents', 'finance', 'projects']);
const MAX_SEED_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export class SeedPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedPathError';
    this.code = 'SEED_PATH_REFUSED';
  }
}

let rootRealPath = null;
async function root() {
  rootRealPath ??= await fs.realpath(DEMO_DATA_DIR);
  return rootRealPath;
}

function isInside(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves `relativePath` (e.g. "finance/q3-budget.csv") to a real path inside demo-data/.
 * Throws SeedPathError for anything that is, or resolves to, somewhere else.
 */
export async function resolveSeedPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    throw new SeedPathError('A seed path is required.');
  }
  if (path.isAbsolute(relativePath)) throw new SeedPathError('Seed paths are relative to demo-data/.');
  const base = await root();
  const candidate = path.resolve(base, relativePath);
  if (!isInside(base, candidate)) throw new SeedPathError('Seed paths must stay inside demo-data/.');
  let real;
  try {
    real = await fs.realpath(candidate);
  } catch {
    throw new SeedPathError('Seed file not found in demo-data/.');
  }
  // realpath follows symbolic links: check the final target, not just the spelling.
  if (!isInside(base, real)) throw new SeedPathError('Seed paths must stay inside demo-data/.');
  return real;
}

export async function readSeedFile(relativePath) {
  const real = await resolveSeedPath(relativePath);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new SeedPathError('Seed paths must point to files.');
  if (stat.size > MAX_SEED_BYTES) throw new SeedPathError('Seed file is too large.');
  return fs.readFile(real);
}

// Every seed file: [{ folder, name, relativePath, mimeType }], in a stable order.
export async function listSeedFiles() {
  const files = [];
  for (const folder of DEMO_FOLDERS) {
    const directory = await resolveSeedPath(folder);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const mimeType = MIME_BY_EXTENSION[path.extname(entry.name).toLowerCase()];
      if (!mimeType) continue;
      files.push({ folder, name: entry.name, relativePath: `${folder}/${entry.name}`, mimeType });
    }
  }
  return files;
}
