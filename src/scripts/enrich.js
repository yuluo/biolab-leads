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
const { parseArgs } = require('node:util');
const duckdb = require('duckdb');
const {
  createApolloClient, emailUnlocked, buildContactRecord, MAX_CONTACTS_PER_COMPANY,
} = require('../../api/lib/enrich-core');

const ROOT = path.resolve(__dirname, '..', '..');
const EMPLOYERS_PARQUET = path.join(ROOT, 'data_parquet', 'employers.parquet');
const CONTACTS_JSONL    = path.join(ROOT, 'data_parquet', 'contacts.jsonl');
const ATTEMPTED_JSONL   = path.join(ROOT, 'data_parquet', 'contacts_attempted.jsonl');
const DEFAULT_TITLES    = path.join(ROOT, 'src', 'config', 'hr_titles.json');
const SAFETY_THRESHOLD  = 100;          // pending EINs above this require --confirm

// ---------- args ----------
// Use Node 20's built-in parseArgs: strict-mode rejects unknown flags and
// missing required values automatically (e.g. `--eins --dry-run` fails fast
// instead of silently consuming the next flag).
let parsed;
try {
  parsed = parseArgs({
    options: {
      eins:        { type: 'string' },
      'eins-file': { type: 'string' },
      limit:       { type: 'string' },   // parsed to int below
      titles:      { type: 'string' },
      'dry-run':   { type: 'boolean', default: false },
      confirm:     { type: 'boolean', default: false },
    },
    strict: true,
  }).values;
} catch (e) {
  console.error('enrich:', e.message);
  process.exit(2);
}
const opts = {
  eins:       parsed.eins ?? null,
  einsFile:   parsed['eins-file'] ?? null,
  limit:      Infinity,
  dryRun:     parsed['dry-run'],
  confirm:    parsed.confirm,
  titlesPath: parsed.titles ?? DEFAULT_TITLES,
};
if (parsed.limit !== undefined) {
  const n = parseInt(parsed.limit, 10);
  if (!Number.isFinite(n) || n <= 0) { console.error('enrich: --limit must be a positive integer'); process.exit(2); }
  opts.limit = n;
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
const ensuredDirs = new Set();
function appendJsonl(file, row) {
  const dir = path.dirname(file);
  if (!ensuredDirs.has(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    ensuredDirs.add(dir);
  }
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

// ---------- main ----------
async function main() {
  const apiKey = loadKey();
  const apollo = createApolloClient(apiKey);
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
      const org = await apollo.resolveOrg(e);
      if (!org) {
        appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'no_org_match' });
        console.error(`  ${e.ein}  ${e.sponsor_name}  -> no_org_match`);
        continue;
      }
      const people = await apollo.findPeople(org.id, titles);
      if (!people.length) {
        appendJsonl(ATTEMPTED_JSONL, { ein: e.ein, attempted_at: now(), reason: 'no_people_match' });
        console.error(`  ${e.ein}  ${e.sponsor_name}  -> no_people_match`);
        continue;
      }
      let revealed = 0;
      for (const p of people) {
        const m = await apollo.matchPerson(p, org.domain);
        if (!emailUnlocked(m?.email)) continue;
        appendJsonl(CONTACTS_JSONL, buildContactRecord(e, org, m, p));
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
