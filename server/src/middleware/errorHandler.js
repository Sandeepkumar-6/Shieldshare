import { AppError } from '../utils/AppError.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Not found.'));
}

// Central error handler. Always answers with the error envelope (api-contract §1):
//   { error: { code, message, details } }
// `details` is only sent to administrators. Stack traces, paths and internal messages never
// leave the server.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const appError = normalize(err);

  if (appError.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  if (res.headersSent) {
    // A streamed download failed midway; the connection is all that is left to close.
    res.destroy();
    return;
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: req.user?.role === 'admin' ? appError.details ?? null : null,
    },
  });
}

function normalize(err) {
  if (err instanceof AppError) return err;

  // Malformed JSON body (express.json)
  if (err?.type === 'entity.parse.failed') {
    return new AppError(400, 'BAD_REQUEST', 'The request body is not valid JSON.');
  }
  if (err?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  // Mongoose cast failures on ids behave like "not found"
  if (err?.name === 'CastError') {
    return new AppError(404, 'NOT_FOUND', 'Not found.');
  }
  if (err?.code === 11000) {
    return new AppError(409, 'CONFLICT', 'That conflicts with an existing record.');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Try again in a moment.');
}
