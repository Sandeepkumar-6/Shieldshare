// Services receive this plain context instead of `req`, so the same service functions can
// be called by REST controllers now and by Shield AI tools later (identity pass-through,
// spec §23) without depending on Express.
export function contextFrom(req) {
  return {
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
    status: req.user?.status ?? null,
    sessionId: req.auth?.sessionId ?? null,
    ip: clientIp(req),
    userAgent: truncate(req.get('user-agent'), 400),
  };
}

export function clientIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || null;
  // Express reports IPv4 clients on dual-stack sockets as ::ffff:1.2.3.4
  return ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function truncate(value, max) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}
