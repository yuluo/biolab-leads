// Loads the employer dataset (employers.json.gz) from S3 once per warm Lambda
// container and filters it in memory. No SQL engine, no native deps.

const zlib = require('zlib');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
const DATA_BUCKET = process.env.DATA_BUCKET;
const EMPLOYERS_KEY = process.env.EMPLOYERS_KEY || 'employers.json.gz';

let cache = null; // { rows, byEin }

async function load() {
  if (cache) return cache;
  const res = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: EMPLOYERS_KEY }));
  const gz = Buffer.from(await res.Body.transformToByteArray());
  const rows = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const byEin = new Map(rows.map((r) => [String(r.ein), r]));
  cache = { rows, byEin };
  return cache;
}

async function getEmployer(ein) {
  const { byEin } = await load();
  return byEin.get(String(ein)) || null;
}

const SORTABLE = new Set(['participants', 'sponsor_name', 'latest_plan_year']);

// params: { state, funding_type, min_participants, max_participants, industry, q,
//           has_stop_loss, has_health_insurance, sort, order, limit, offset }
async function filterEmployers(params) {
  const { rows } = await load();
  let out = rows;

  if (params.state) {
    const st = String(params.state).toUpperCase();
    out = out.filter((r) => r.state === st);
  }
  if (params.funding_type) {
    const set = new Set(String(params.funding_type).split(',').map((s) => s.trim()).filter(Boolean));
    out = out.filter((r) => set.has(r.funding_type));
  }
  if (params.min_participants != null) {
    out = out.filter((r) => (r.participants ?? 0) >= params.min_participants);
  }
  if (params.max_participants != null) {
    out = out.filter((r) => (r.participants ?? 0) <= params.max_participants);
  }
  if (params.industry) {
    const prefix = String(params.industry);
    out = out.filter((r) => String(r.business_code || '').startsWith(prefix));
  }
  if (params.q) {
    const q = String(params.q).toLowerCase();
    out = out.filter((r) => String(r.sponsor_name || '').toLowerCase().includes(q));
  }
  if (params.has_stop_loss != null) {
    out = out.filter((r) => Boolean(r.has_stop_loss) === params.has_stop_loss);
  }
  if (params.has_health_insurance != null) {
    out = out.filter((r) => Boolean(r.has_health_insurance) === params.has_health_insurance);
  }

  const total = out.length;

  if (params.sort && SORTABLE.has(params.sort)) {
    const dir = params.order === 'asc' ? 1 : -1;
    const key = params.sort;
    out = [...out].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  const offset = params.offset || 0;
  const limit = params.limit || 50;
  const results = out.slice(offset, offset + limit);
  return { total, count: results.length, offset, results };
}

module.exports = { filterEmployers, getEmployer, load };
