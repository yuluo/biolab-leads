// Public HTTP API (API Gateway v2 / Lambda proxy). Routes:
//   GET  /employers        — filtered, paginated employer list (in-memory)
//   GET  /contacts?ein=    — retained contacts for one employer (DynamoDB)
//   POST /contacts/enrich  — enrich one employer via Apollo using the caller's
//                            X-Apollo-Key, persist to DynamoDB, return contacts
//   GET  /admin/usage      — per-account usage log (X-Admin-Token, not the allowlist)
// Every authorized public request is logged to the usage table (per account).
// CORS is handled by API Gateway (cors_configuration), not here.

const { filterEmployers, getEmployer } = require('./lib/employers');
const { getContacts, putContacts } = require('./lib/contacts');
const { enrichOne } = require('./lib/enrich-core');
const { authorize } = require('./lib/auth');
const { authorizeAdmin } = require('./lib/admin-auth');
const { safeRecordUsage } = require('./lib/usage');
const { queryUsage, summarize } = require('./lib/usage-admin');
const TITLES = require('./config/hr_titles.json');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function parseIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function parseBoolOrNull(v) {
  if (v == null || v === '') return null;
  if (/^(true|1|yes)$/i.test(v)) return true;
  if (/^(false|0|no)$/i.test(v)) return false;
  return null;
}

// Handlers return { res, usage } — res is the HTTP envelope, usage is the
// per-request detail logged for the calling account (or null to skip logging).

async function handleEmployers(qs) {
  const limit = Math.min(Math.max(parseIntOrNull(qs.limit) ?? 50, 1), 500);
  const offset = Math.max(parseIntOrNull(qs.offset) ?? 0, 0);
  const params = {
    state: qs.state || null,
    funding_type: qs.funding_type || 'self-insured,partial',
    min_participants: parseIntOrNull(qs.min_participants),
    max_participants: parseIntOrNull(qs.max_participants),
    industry: qs.industry || null,
    q: qs.q || null,
    has_stop_loss: parseBoolOrNull(qs.has_stop_loss),
    has_health_insurance: parseBoolOrNull(qs.has_health_insurance),
    sort: qs.sort || null,
    order: qs.order || 'desc',
    limit,
    offset,
  };
  const result = await filterEmployers(params);
  const usage = {
    type: 'search',
    filters: {
      state: params.state,
      funding_type: params.funding_type,
      min_participants: params.min_participants,
      max_participants: params.max_participants,
      industry: params.industry,
      q: params.q,
      has_stop_loss: params.has_stop_loss,
      has_health_insurance: params.has_health_insurance,
      sort: params.sort,
      order: params.order,
    },
    result_count: result.total,
    limit,
    offset,
  };
  return { res: json(200, result), usage };
}

async function handleGetContacts(qs) {
  const ein = qs.ein && String(qs.ein).trim();
  if (!ein) return { res: json(400, { error: 'ein query parameter is required' }), usage: null };
  const contacts = await getContacts(ein);
  return { res: json(200, { ein, contacts }), usage: { type: 'contacts_lookup', ein, count: contacts.length } };
}

async function handleEnrich(event) {
  const headers = event.headers || {};
  const apiKey = headers['x-apollo-key'] || headers['X-Apollo-Key'];
  if (!apiKey) return { res: json(400, { error: 'X-Apollo-Key header is required' }), usage: null };

  let body = {};
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try { body = JSON.parse(raw); } catch { return { res: json(400, { error: 'invalid JSON body' }), usage: null }; }
  }
  const ein = body.ein && String(body.ein).trim();
  if (!ein) return { res: json(400, { error: 'ein is required in the request body' }), usage: null };

  const emp = await getEmployer(ein);
  if (!emp) return { res: json(404, { ein, contacts: [], reason: 'unknown_ein' }), usage: { type: 'enrich', ein, reason: 'unknown_ein', apollo_calls: 0, contacts_found: 0 } };

  const { contacts, reason, apollo_calls } = await enrichOne({ emp, apiKey, titles: TITLES });
  if (contacts.length) await putContacts(contacts);
  const usage = { type: 'enrich', ein, reason, apollo_calls, contacts_found: contacts.length };
  return { res: json(200, { ein, contacts, reason }), usage };
}

async function handleAdminUsage(qs) {
  const events = await queryUsage({
    email: qs.email || null,
    day: qs.day || null,
    since: qs.since || null,
    until: qs.until || null,
    limit: qs.limit,
  });
  if (qs.format === 'summary') return json(200, summarize(events));
  return json(200, { count: events.length, events });
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || '';
  const rawPath = event.requestContext?.http?.path || event.rawPath || '';
  const path = rawPath.replace(/\/+$/, '') || '/';
  const qs = event.queryStringParameters || {};

  try {
    // Admin routes use a separate token, not the email allowlist.
    if (path.startsWith('/admin')) {
      const admin = authorizeAdmin(event);
      if (!admin.ok) return json(admin.status, { error: admin.error });
      if (method === 'GET' && path === '/admin/usage') return await handleAdminUsage(qs);
      return json(404, { error: `no route for ${method} ${path}` });
    }

    const auth = await authorize(event);
    if (!auth.ok) return json(auth.status, { error: auth.error });

    let handled = null;
    if (method === 'GET' && path === '/employers') handled = await handleEmployers(qs);
    else if (method === 'GET' && path === '/contacts') handled = await handleGetContacts(qs);
    else if (method === 'POST' && path === '/contacts/enrich') handled = await handleEnrich(event);
    else return json(404, { error: `no route for ${method} ${path}` });

    if (handled.usage) {
      await safeRecordUsage({
        email: auth.email,
        method,
        path,
        detail: handled.usage,
        requestId: event.requestContext?.requestId,
      });
    }
    return handled.res;
  } catch (err) {
    return json(500, { error: err.message });
  }
};
