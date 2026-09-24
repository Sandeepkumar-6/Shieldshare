import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single storage root: server/storage — all paths resolve against this.
export const STORAGE_ROOT = path.resolve(__dirname, "../../storage");

export const DIRS = {
  files: path.join(STORAGE_ROOT, "files"),
  versions: path.join(STORAGE_ROOT, "versions"),
  quarantine: path.join(STORAGE_ROOT, "quarantine"),
};

export function ensureStorageDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}

// Generates a server-side stored name. Never trusts client input for paths.
export function makeStoredName(originalName) {
  const ext = path.extname(originalName).toLowerCase().slice(0, 12);
  return crypto.randomBytes(16).toString("hex") + ext;
}

// Resolves a relative stored name against a storage dir and guarantees it
// stays inside that dir (path-traversal guard).
export function resolveInDir(baseDir, storedName) {
  const resolved = path.resolve(baseDir, storedName);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function writeBytesTo(dir, storedName, data) {
  const filePath = resolveInDir(dir, storedName);
  await fs.promises.writeFile(filePath, data);
  return filePath;
}

export function moveToQuarantine(storedName) {
  const src = resolveInDir(DIRS.files, storedName);
  const dest = resolveInDir(DIRS.quarantine, storedName);
  fs.renameSync(src, dest);
  return dest;
}

export function restoreFromQuarantine(storedName) {
  const src = resolveInDir(DIRS.quarantine, storedName);
  const dest = resolveInDir(DIRS.files, storedName);
  fs.renameSync(src, dest);
  return dest;
}
