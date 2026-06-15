// Admin auth: a single shared secret carried in X-Admin-Token, distinct from the
// email allowlist that gates the public API. Used only by the /admin/* routes.

const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Returns { ok: true } or { ok: false, status, error }.
function authorizeAdmin(event) {
  const headers = event.headers || {};
  const token = headers['x-admin-token'] || headers['X-Admin-Token'];
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) return { ok: false, status: 503, error: 'admin API is not configured' };
  if (!token) return { ok: false, status: 401, error: 'X-Admin-Token header is required' };
  if (!timingSafeEqual(token, expected)) return { ok: false, status: 403, error: 'invalid admin token' };
  return { ok: true };
}

module.exports = { authorizeAdmin };
