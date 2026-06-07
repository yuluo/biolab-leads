// Public HTTP API (API Gateway v2 / Lambda proxy). Three routes:
//   GET  /employers        — filtered, paginated employer list (in-memory)
//   GET  /contacts?ein=    — retained contacts for one employer (DynamoDB)
//   POST /contacts/enrich  — enrich one employer via Apollo using the caller's
//                            X-Apollo-Key, persist to DynamoDB, return contacts
// CORS is handled by API Gateway (cors_configuration), not here.

const { filterEmployers, getEmployer } = require('./lib/employers');
const { getContacts, putContacts } = require('./lib/contacts');
const { enrichOne } = require('./lib/enrich-core');
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

async function handleEmployers(qs) {
  const limit = Math.min(Math.max(parseIntOrNull(qs.limit) ?? 50, 1), 500);
  const offset = Math.max(parseIntOrNull(qs.offset) ?? 0, 0);
  const result = await filterEmployers({
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
  });
  return json(200, result);
}

async function handleGetContacts(qs) {
  const ein = qs.ein && String(qs.ein).trim();
  if (!ein) return json(400, { error: 'ein query parameter is required' });
  const contacts = await getContacts(ein);
  return json(200, { ein, contacts });
}

async function handleEnrich(event) {
  const headers = event.headers || {};
  const apiKey = headers['x-apollo-key'] || headers['X-Apollo-Key'];
  if (!apiKey) return json(400, { error: 'X-Apollo-Key header is required' });

  let body = {};
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'invalid JSON body' }); }
  }
  const ein = body.ein && String(body.ein).trim();
  if (!ein) return json(400, { error: 'ein is required in the request body' });

  const emp = await getEmployer(ein);
  if (!emp) return json(404, { ein, contacts: [], reason: 'unknown_ein' });

  const { contacts, reason } = await enrichOne({ emp, apiKey, titles: TITLES });
  if (contacts.length) await putContacts(contacts);
  return json(200, { ein, contacts, reason });
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || '';
  const rawPath = event.requestContext?.http?.path || event.rawPath || '';
  const path = rawPath.replace(/\/+$/, '') || '/';
  const qs = event.queryStringParameters || {};

  try {
    if (method === 'GET' && path === '/employers') return await handleEmployers(qs);
    if (method === 'GET' && path === '/contacts') return await handleGetContacts(qs);
    if (method === 'POST' && path === '/contacts/enrich') return await handleEnrich(event);
    return json(404, { error: `no route for ${method} ${path}` });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
