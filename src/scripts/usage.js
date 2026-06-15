#!/usr/bin/env node
// Inspect the per-account API usage log (DynamoDB). Reads the table directly
// with your AWS credentials — no public endpoint.
//
// Usage:
//   npm run usage                          # recent activity across all accounts
//   npm run usage -- --days 7 --summary    # past 7 days, per-account rollup
//   npm run usage -- --since-date 2026-06-01 --until-date 2026-06-07 --summary
//   npm run usage -- --email a@b.com       # one account, newest first
//   npm run usage -- --day 2026-06-15      # one day (via the by_day GSI)
//   npm run usage -- --summary             # per-account / per-endpoint rollup
//   npm run usage -- --json                # raw JSON instead of a table
//
// Flags: --email --days N --since-date / --until-date (YYYY-MM-DD) --day
//        --since --until (raw sk bounds) --limit (≤1000) --summary --json
// A date range (--days or --since-date/--until-date) sweeps the by_day GSI and
// counts every event in the window (limit only caps the printed event list).
// Table name from `terraform output -raw usage_table_name` or env USAGE_TABLE.
// Region from AWS_REGION, defaults to us-east-1.

const path = require('path');
const { execFileSync } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ROOT = path.resolve(__dirname, '..', '..');
const TF_DIR = path.join(ROOT, 'terraform');
const REGION = process.env.AWS_REGION || 'us-east-1';

function resolveTableName() {
  if (process.env.USAGE_TABLE) return process.env.USAGE_TABLE;
  try {
    return execFileSync('terraform', [`-chdir=${TF_DIR}`, 'output', '-raw', 'usage_table_name'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error('Could not read usage_table_name from terraform output. ' +
      'Set USAGE_TABLE or apply terraform first.');
    process.exit(1);
  }
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; } else { out[key] = next; i++; }
  }
  return out;
}

function clampLimit(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(n, 1), 1000);
}

async function queryUsage(doc, table, { email, day, since, until, limit }) {
  const lim = clampLimit(limit);

  if (email) {
    const expr = ['email = :e'];
    const vals = { ':e': String(email).trim().toLowerCase() };
    if (since) { expr.push('sk >= :since'); vals[':since'] = String(since); }
    if (until) { expr.push('sk <= :until'); vals[':until'] = String(until); }
    const res = await doc.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: expr.join(' AND '),
      ExpressionAttributeValues: vals,
      ScanIndexForward: false,
      Limit: lim,
    }));
    return res.Items || [];
  }

  if (day) {
    const res = await doc.send(new QueryCommand({
      TableName: table,
      IndexName: 'by_day',
      KeyConditionExpression: '#d = :d',
      ExpressionAttributeNames: { '#d': 'day' },
      ExpressionAttributeValues: { ':d': String(day) },
      ScanIndexForward: false,
      Limit: lim,
    }));
    return res.Items || [];
  }

  // No filter: bounded scan of the whole log, newest first.
  const res = await doc.send(new ScanCommand({ TableName: table, Limit: lim }));
  const items = res.Items || [];
  items.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  return items.slice(0, lim);
}

// Inclusive list of "YYYY-MM-DD" strings (UTC) between two dates.
function enumerateDates(sinceDate, untilDate) {
  const out = [];
  const cur = new Date(`${sinceDate}T00:00:00Z`);
  const end = new Date(`${untilDate}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Resolve a date window from flags, or null if none given. --days N is the last
// N calendar days (UTC) ending today; --since-date/--until-date is explicit.
function rangeFromFlags(flags, today) {
  const end = today || new Date().toISOString().slice(0, 10);
  if (flags['since-date'] || flags['until-date']) {
    return {
      sinceDate: String(flags['since-date'] || flags['until-date']),
      untilDate: String(flags['until-date'] || end),
    };
  }
  if (flags.days != null && flags.days !== false) {
    const n = Math.max(parseInt(flags.days, 10) || 7, 1);
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (n - 1));
    return { sinceDate: start.toISOString().slice(0, 10), untilDate: end };
  }
  return null;
}

// Sweep the by_day GSI across a date window, paginating fully so rollups are
// complete. Optionally narrow to one account.
async function queryRange(doc, table, { sinceDate, untilDate, email }) {
  const all = [];
  for (const day of enumerateDates(sinceDate, untilDate)) {
    let ExclusiveStartKey;
    do {
      const res = await doc.send(new QueryCommand({
        TableName: table,
        IndexName: 'by_day',
        KeyConditionExpression: '#d = :d',
        ExpressionAttributeNames: { '#d': 'day' },
        ExpressionAttributeValues: { ':d': day },
        ScanIndexForward: false,
        ExclusiveStartKey,
      }));
      all.push(...(res.Items || []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
  const e = email ? String(email).trim().toLowerCase() : null;
  const filtered = e ? all.filter((it) => it.email === e) : all;
  filtered.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  return filtered;
}

function summarize(events) {
  const byAccount = {};
  const byEndpoint = {};
  let apolloCalls = 0;
  for (const e of events) {
    const acct = (byAccount[e.email] ||= { requests: 0, apollo_calls: 0, endpoints: {} });
    acct.requests += 1;
    acct.endpoints[e.endpoint] = (acct.endpoints[e.endpoint] || 0) + 1;
    byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] || 0) + 1;
    if (typeof e.apollo_calls === 'number') {
      acct.apollo_calls += e.apollo_calls;
      apolloCalls += e.apollo_calls;
    }
  }
  return { total_events: events.length, apollo_calls: apolloCalls, by_account: byAccount, by_endpoint: byEndpoint };
}

function describeDetail(e) {
  if (e.type === 'search') {
    const f = e.filters || {};
    const parts = Object.entries(f)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${v}`);
    return `→ ${e.result_count ?? '?'} results${parts.length ? ` [${parts.join(', ')}]` : ''}`;
  }
  if (e.type === 'enrich') return `ein=${e.ein} ${e.reason} apollo=${e.apollo_calls ?? 0} contacts=${e.contacts_found ?? 0}`;
  if (e.type === 'contacts_lookup') return `ein=${e.ein} count=${e.count ?? 0}`;
  return '';
}

function printEvents(events) {
  if (!events.length) { console.log('(no usage events)'); return; }
  for (const e of events) {
    console.log(`${e.ts || ''}  ${(e.email || '').padEnd(28)}  ${(e.endpoint || '').padEnd(22)}  ${describeDetail(e)}`);
  }
  console.log(`\n${events.length} event(s)`);
}

function printSummary(s) {
  console.log(`${s.total_events} events · ${s.apollo_calls} Apollo calls\n`);
  console.log('By account:');
  for (const [email, a] of Object.entries(s.by_account).sort((x, y) => y[1].requests - x[1].requests)) {
    console.log(`  ${email.padEnd(28)} ${String(a.requests).padStart(5)} req  ${a.apollo_calls} apollo`);
    for (const [ep, n] of Object.entries(a.endpoints)) console.log(`      ${ep.padEnd(22)} ${n}`);
  }
  console.log('\nBy endpoint:');
  for (const [ep, n] of Object.entries(s.by_endpoint)) console.log(`  ${ep.padEnd(22)} ${n}`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const table = resolveTableName();
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const email = typeof flags.email === 'string' ? flags.email : null;

  const range = rangeFromFlags(flags);
  let events;
  if (range && !flags.day) {
    events = await queryRange(doc, table, { ...range, email });
  } else {
    events = await queryUsage(doc, table, {
      email,
      day: typeof flags.day === 'string' ? flags.day : null,
      since: typeof flags.since === 'string' ? flags.since : null,
      until: typeof flags.until === 'string' ? flags.until : null,
      limit: flags.limit,
    });
  }

  if (flags.json) { console.log(JSON.stringify(flags.summary ? summarize(events) : events, null, 2)); return; }
  if (range) console.log(`window: ${range.sinceDate}..${range.untilDate}\n`);
  if (flags.summary) { printSummary(summarize(events)); return; }
  printEvents(events.slice(0, clampLimit(flags.limit)));
}

if (require.main === module) {
  main().catch((e) => { console.error('usage failed:', e.message); process.exit(1); });
}

module.exports = { parseFlags, clampLimit, summarize, describeDetail, enumerateDates, rangeFromFlags };
