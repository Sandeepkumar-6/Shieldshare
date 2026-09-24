import path from "node:path";
import { User } from "../models/User.js";
import { File } from "../models/File.js";
import { FileVersion } from "../models/FileVersion.js";
import {
  DIRS, ensureStorageDirs, makeStoredName, writeBytesTo, sha256Buffer,
} from "../utils/storage.js";

const CANARY_TEMPLATES = [
  {
    name: "_budget_2024_final.xlsx",
    directory: "Finance",
    content: "ShieldShare canary file. If you are reading this outside a restore, a mayday is in order.\n",
  },
  {
    name: "passwords_backup.docx",
    directory: "Personal",
    content: "ShieldShare canary file. This is a decoy used as a ransomware tripwire.\n",
  },
];

export async function createCanariesForUser(userId) {
  ensureStorageDirs();
  const created = [];
  for (const tpl of CANARY_TEMPLATES) {
    const storedName = makeStoredName(tpl.name);
    const content = Buffer.from(tpl.content, "utf8");
    const hash = sha256Buffer(content);
    const filePath = await writeBytesTo(DIRS.files, storedName, content);
    const file = await File.create({
      owner: userId,
      originalName: tpl.name,
      storedName,
      path: filePath,
      mimeType: tpl.name.endsWith(".xlsx") ? "application/vnd.ms-excel" : "application/msword",
      size: content.length,
      currentHash: hash,
      currentVersion: 1,
      isCanary: true,
      directory: tpl.directory,
    });
    await FileVersion.create({
      file: file._id,
      versionNumber: 1,
      storedPath: filePath,
      hash,
      size: content.length,
      createdBy: userId,
      isKnownSafe: true, // brand-new account: risk is SAFE at creation
    });
    created.push(file);
  }
  return created;
}
