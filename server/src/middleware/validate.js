// Wraps a zod schema; validates body/query/params per schema shape and
// assigns parsed values back. Raises 422 with field-level messages.
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (!result.success) {
      const error = new Error("Validation failed");
      error.status = 422;
      error.details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return next(error);
    }
    req.body = result.data.body ?? req.body;
    req.query = result.data.query ?? req.query;
    req.params = result.data.params ?? req.params;
    next();
  };
}
