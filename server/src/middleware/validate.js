import { z } from 'zod';
import { errors } from '../utils/AppError.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

// Validates params, query and body with zod schemas and stores the parsed values on
// req.valid (Express 5 makes req.query read-only).
//
// Malformed ids in the URL answer 404 rather than 422: an id that cannot exist is "not
// found", and the response never hints at whether a resource exists (api-contract §1).
export function validate({ params, query, body } = {}) {
  return function validateMiddleware(req, res, next) {
    const valid = {};

    if (params) {
      const result = params.safeParse(req.params);
      if (!result.success) throw errors.notFound();
      valid.params = result.data;
    }
    if (query) {
      const result = query.safeParse(req.query);
      if (!result.success) throw toValidationError(result.error);
      valid.query = result.data;
    }
    if (body) {
      const result = body.safeParse(req.body ?? {});
      if (!result.success) throw toValidationError(result.error);
      valid.body = result.data;
    }

    req.valid = valid;
    next();
  };
}

function toValidationError(zodError) {
  const issues = zodError.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  const first = zodError.issues[0];
  return errors.validation(first?.message || 'Check the highlighted fields and try again.', issues);
}
