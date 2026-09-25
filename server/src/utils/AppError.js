// Errors that map onto the API error envelope (api-contract.md §1):
// { error: { code, message, details } }. `message` must be safe to show to users.
export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message = 'The request could not be read.') =>
    new AppError(400, 'BAD_REQUEST', message),
  unauthenticated: (message = 'Sign in to continue.') =>
    new AppError(401, 'UNAUTHENTICATED', message),
  sessionRevoked: (message = 'Your session has ended. Sign in again.') =>
    new AppError(401, 'SESSION_REVOKED', message),
  forbidden: (message = 'You do not have permission to do that.') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found.') =>
    new AppError(404, 'NOT_FOUND', message),
  conflict: (code, message) =>
    new AppError(409, code, message),
  fileQuarantined: () =>
    new AppError(409, 'FILE_QUARANTINED', 'This file is under review and cannot be changed or downloaded right now.'),
  fileTooLarge: (maxBytes) =>
    new AppError(413, 'FILE_TOO_LARGE', `Files must be ${formatMegabytes(maxBytes)} or smaller.`),
  unsupportedType: (message) =>
    new AppError(415, 'UNSUPPORTED_TYPE', message),
  validation: (message, details = null) =>
    new AppError(422, 'VALIDATION_ERROR', message, details),
  userFrozen: () =>
    new AppError(423, 'USER_FROZEN', 'File changes are paused while ShieldShare reviews recent activity.'),
  // One message for every unusable link (expired, revoked, suspended, quarantined, deleted
  // or unknown), so the public response never says which.
  linkUnavailable: () =>
    new AppError(410, 'LINK_UNAVAILABLE', 'This link is no longer available.'),
};

function formatMegabytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
