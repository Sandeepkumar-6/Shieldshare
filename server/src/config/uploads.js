// Upload policy. The allowlist is a Phase 1 decision (the spec requires MIME/extension
// validation but does not list types). Each extension maps to the MIME types a browser
// may declare for it; the first entry is the canonical type stored on the File.
//
// Browsers often declare `application/octet-stream` (or nothing) for types they do not
// recognise, so that is accepted and replaced by the canonical type. A declared type that
// contradicts the extension (for example `text/html` on a `.pdf`) is rejected.
export const ALLOWED_TYPES = Object.freeze({
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/x-markdown', 'text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.json': ['application/json', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
});

export const GENERIC_MIME_TYPES = Object.freeze(['application/octet-stream', '']);

export const ALLOWED_MIME_TYPES = Object.freeze(
  [...new Set(Object.values(ALLOWED_TYPES).flat())],
);
