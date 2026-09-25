import { fileApi } from '../services/file.service.js';

// Downloads need an auth header (or a share-access header), so the file is fetched as a
// Blob and handed to the browser through a temporary object URL.
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

// Runs a fetcher that returns { blob, disposition } and saves the result.
export async function downloadWith(fetcher, fallbackName) {
  const { blob, disposition } = await fetcher();
  saveBlob(blob, filenameFromDisposition(disposition) || fallbackName || 'download');
}

export async function downloadFile(fileId, { versionId, fallbackName }) {
  await downloadWith(() => fileApi.download(fileId, { versionId }), fallbackName);
}

export function filenameFromDisposition(header) {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header);
  return plain ? plain[1] : null;
}
