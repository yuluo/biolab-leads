#!/usr/bin/env node
// enrich.js — pure EIN-driven Apollo enrichment primitive.
//
// Input (one of):
//   --eins ein1,ein2,…     comma-separated EINs
//   --eins-file path       newline-separated EINs in a file
//   stdin                  one EIN per line if neither flag is given
//
// Flags:
//   --limit N        cap how many uncached EINs to enrich this run
//   --dry-run        resolve orgs, list intended calls, spend 0 credits
//   --confirm        proceed past the >100 pending-EINs safety gate
//   --titles PATH    override the HR/benefits title list (default: src/config/hr_titles.json)
//
// Reads employers.parquet read-only for sponsor name/city/state.
// Appends results to data_parquet/contacts.jsonl and contacts_attempted.jsonl
// (both gitignored as PII). Crash-safe — each contact / attempt is appended
// immediately so no Apollo credit is ever lost to a partial run.
//
// API key: APOLLO_API_KEY env var, else `.env` (KEY=VALUE), else `.apollo-key` file.

const fs = require('fs');
const path = require('path');
const duckdb = require('duckdb');

const ROOT = path.resolve(__dirname, '..', '..');
const EMPLOYERS_PARQUET = path.join(ROOT, 'data_parquet', 'employers.parquet');
const CONTACTS_JSONL    = path.join(ROOT, 'data_parquet', 'contacts.jsonl');
const ATTEMPTED_JSONL   = path.join(ROOT, 'data_parquet', 'contacts_attempted.jsonl');
const DEFAULT_TITLES    = path.join(ROOT, 'src', 'config', 'hr_titles.json');
const APOLLO_BASE       = 'https://api.apollo.io/api/v1';
const SAFETY_THRESHOLD  = 100;          // pending EINs above this require --confirm
const MAX_CONTACTS_PER_COMPANY = 2;     // cost cap per company (~ MAX × 1 credit/email)
const ORG_MATCH_MIN     = 0.55;         // reject low-confidence org matches

// ---------- args ----------
const opts = { eins: null, einsFile: null, limit: Infinity, dryRun: false, confirm: false, titlesPath: DEFAULT_TITLES };
for (let i = 2, a = process.argv; i < a.length; i++) {
  const k = a[i];
  if (k === '--eins')        opts.eins       = a[++i];
  else if (k === '--eins-file') opts.einsFile = a[++i];
  else if (k === '--limit')  opts.limit      = parseInt(a[++i], 10);
  else if (k === '--dry-run') opts.dryRun    = true;
  else if (k === '--confirm') opts.confirm   = true;
  else if (k === '--titles') opts.titlesPath = a[++i];
  else { console.error('enrich: unknown arg', k); process.exit(2); }
}

// ---------- key ----------
function loadKey() {
  if (process.env.APOLLO_API_KEY) return process.env.APOLLO_API_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*APOLLO_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  const keyPath = path.join(ROOT, '.apollo-key');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8').trim();
  return null;
}

// ---------- input ----------
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
async function loadEins() {
  let raw = [];
  if (opts.eins)          raw = opts.eins.split(',');
  else if (opts.einsFile) raw = fs.readFileSync(opts.einsFile, 'utf8').split(/\r?\n/);
  else if (!process.stdin.isTTY) raw = (await readStdin()).split(/\r?\n/);
  return Array.from(new Set(raw.map(s => s.trim()).filter(Boolean)));
}

// ---------- cache (attempted set) ----------
function loadAttemptedSet() {
  if (!fs.existsSync(ATTEMPTED_JSONL)) return new Set();
  const set = new Set();
  for (const line of fs.readFileSync(ATTEMPTED_JSONL, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try { set.add(JSON.parse(line).ein); } catch {}
  }
  return set;
}
function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

// ---------- string match ----------
function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
// Build the q_organization_name we send to Apollo. Apollo's name filter is strict —
// "ORACLE AMERICA, INC." returns 0 hits; "Oracle" returns 3 with the real Oracle on top.
// Strip commas, legal suffixes, and trailing geographic words to leave the brand.
function cleanQueryForApollo(name) {
  return (name || '')
    .replace(/,.*$/, '')
    .replace(/[.]/g, '')
    .replace(/\b(incorporated|corporation|company|limited)\b/gi, '')
    .replace(/\b(inc|llc|corp|co|ltd|lp|plc)\b/gi, '')
    .replace(/\s+(usa|us|north america|america)\s*$/gi, '')
    .replace(/\s+/g, ' ').trim();
}
function nameSim(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  let inter = 0; ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size, 1);
}

// ---------- Apollo ----------
let apiKey;
async function apolloPost(endpoint, body, attempt = 0) {
  const res = await fetch(`${APOLLO_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 3) {
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    return apolloPost(endpoint, body, attempt + 1);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Apollo ${endpoint} ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function resolveOrg(emp) {
  // Apollo's org search endpoint (the older mixed_companies/search returns 0 hits).
  // Send a cleaned brand-only query; score against the original sponsor_name.
  const q = cleanQueryForApollo(emp.sponsor_name);
  if (!q) return null;
  const r = await apolloPost('/organizations/search', {
    q_organization_name: q,
    page: 1, per_page: 5,
  });
  const orgs = r.organizations || r.accounts || [];
  if (!orgs.length) return null;
  let best = null, bestScore = 0;
  for (const o of orgs) {
    let s = nameSim(o.name, emp.sponsor_name);
    const oState = (o.state || o.state_name || '').toLowerCase();
    const oCity  = (o.city || '').toLowerCase();
    if (emp.state && oState && oState === (emp.state || '').toLowerCase()) s += 0.05;
    if (emp.city  && oCity  && oCity  === (emp.city  || '').toLowerCase()) s += 0.05;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  if (!best || bestScore < ORG_MATCH_MIN) return null;
  return {
    id: best.id,
    domain: best.primary_domain || best.website_url || null,
    name: best.name,
    score: Math.min(bestScore, 1),
  };
}

async function findPeople(orgId, titles) {
  // mixed_people/search was deprecated; new endpoint is mixed_people/api_search.
  // Returns people with id, first_name, title, masked last_name_obfuscated — use
  // /people/match by id to reveal the real last name + email.
  const r = await apolloPost('/mixed_people/api_search', {
    organization_ids: [orgId],
    person_titles: titles,
    page: 1, per_page: 10,
  });
  const people = r.people || r.contacts || [];
  return people.slice(0, MAX_CONTACTS_PER_COMPANY);
}

async function matchPerson(person, orgDomain) {
  const body = { reveal_personal_emails: false };
  if (person.id)         body.id = person.id;
  if (person.first_name) body.first_name = person.first_name;
  if (person.last_name)  body.last_name  = person.last_name;
  if (orgDomain)         body.domain     = orgDomain;
  if (person.organization?.name) body.organization_name = person.organization.name;
  try {
    const r = await apolloPost('/people/match', body);
    return r.person || r;
  } catch {
    return null;
  }
}
const emailUnlocked = (e) => e && /@/.test(e) && !/email_not_unlocked/i.test(e);

// ---------- main ----------
async function main() {
  apiKey = loadKey();
  const titles = JSON.parse(fs.readFileSync(opts.titlesPath, 'utf8'));
  const inputEins = await loadEins();
  if (!inputEins.length) {
    console.error('enrich: no EINs provided. Use --eins, --eins-file, or pipe EINs on stdin.');
    process.exit(2);
  }

  // Look up company context for the requested EINs
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();
  const q = (s) => s.replace(/'/g, "''");
  const einList = inputEins.map(e => `'${q(e)}'`).join(',');
  const empRows = await new Promise((res, rej) => conn.all(`
    SELECT ein, sponsor_name, city, state, business_code
    FROM read_parquet('${q(EMPLOYERS_PARQUET)}')
    WHERE ein IN (${einList})
  `, (err, rows) => err ? rej(err) : res(rows)));
  const empByEin = new Map(empRows.map(r => [String(r.ein), r]));

  const attemptedSet = loadAttemptedSet();
  const trustRe = /\b(trust|board of trustees|fund)\b/i;
  const buckets = { unknown: [], cached: [], trust: [], callable: [] };
  for (const ein of inputEins) {
    if (attemptedSet.has(ein))     { buckets.cached.push(ein); continue; }
    const e = empByEin.get(ein);
    if (!e)                         { buckets.unknown.push(ein); continue; }
    if (trustRe.test(e.sponsor_name || '')) { buckets.trust.push(e); continue; }
    buckets.callable.push(e);
  }

  const callable = buckets.callable.slice(0, opts.limit);
  const estCredits = callable.length * MAX_CONTACTS_PER_COMPANY;
  console.error(`enrich: input=${inputEins.length} cached=${buckets.cached.length} unknown_ein=${buckets.unknown.length} trust_skip=${buckets.trust.length} pending=${callable.length} est_credits<=${estCredits}`);

  if (opts.dryRun) {
    console.error('--dry-run: no Apollo calls');
    for (const e of callable) console.error(`  would call: ${e.ein}  ${e.sponsor_name}`);
    db.close();
    return;
  }

  if (callable.length > SAFETY_THRESHOLD && !opts.confirm) {
    console.error(`SAFETY: pending=${callable.length} exceeds ${SAFETY_THRESHOLD}. Re-run with --confirm to spend up to ${estCredits} credits.`);
    db.close();
    process.exit(2);
  }

  if (callable.length > 0 && !apiKey) {
    console.error('ERROR: APOLLO_API_KEY missing. Put it in .env (APOLLO_API_KEY=...), .apollo-key, or export it.');
    db.close();
    process.exit(1);
  }

  const now = () => new Date().toISOString();

  // record trust-fund skips first (no spend)
  for (const e of buckets.trust) {
    appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'trust_fund_skipped' });
  }

  let contactsWritten = 0;
  for (const e of callable) {
    try {
      const org = await resolveOrg(e);
      if (!org) {
        appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'no_org_match' });
        console.error(`  ${e.ein}  ${e.sponsor_name}  -> no_org_match`);
        continue;
      }
      const people = await findPeople(org.id, titles);
      if (!people.length) {
        appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'no_people_match' });
        console.error(`  ${e.ein}  ${e.sponsor_name}  -> no_people_match`);
        continue;
      }
      let revealed = 0;
      for (const p of people) {
        const m = await matchPerson(p, org.domain);
        const email = m?.email;
        if (!emailUnlocked(email)) continue;
        appendJsonl(CONTACTS_JSONL, {
          ein: e.ein,
          contact_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.name || p.name || '',
          contact_title: m.title || p.title || '',
          contact_email: email,
          contact_linkedin: m.linkedin_url || p.linkedin_url || '',
          org_domain: org.domain || '',
          match_confidence: org.score,
          enriched_at: now(),
        });
        revealed++;
        contactsWritten++;
      }
      appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: revealed ? 'ok' : 'no_email_revealed' });
      console.error(`  ${e.ein}  ${e.sponsor_name}  -> ${revealed} email(s)`);
    } catch (err) {
      appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'error' });
      console.error(`  ${e.ein}  ${e.sponsor_name}  -> error: ${err.message}`);
    }
  }

  console.error(`done: ${contactsWritten} contact(s) appended to ${path.relative(ROOT, CONTACTS_JSONL)}`);
  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
