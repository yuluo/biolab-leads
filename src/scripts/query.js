#!/usr/bin/env node
// Run an ad-hoc SQL query against the parquet dataset.
//
// Three views are exposed:
//   employers — one row per employer (sponsor EIN), from employers.parquet
//   contacts  — Apollo-enriched contacts (read from data_parquet/contacts.jsonl,
//               empty schema if the file doesn't exist yet)
//   leads     — employers LEFT JOIN contacts (one row per employer-contact pair;
//               employers with no contact still appear, with null contact fields)
//
// Usage:
//   npm run query -- "SELECT COUNT(*) FROM employers"
//   npm run query -- "SELECT * FROM leads WHERE state='CA' AND contact_email IS NOT NULL LIMIT 5"
//
// Flags (must come before the SQL string):
//   --csv          print rows as CSV instead of JSON lines
//   --table        print rows as an aligned ASCII table
//   --parquet PATH override employers parquet path

const fs = require('fs');
const path = require('path');
const duckdb = require('duckdb');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_GLOB = path.join(ROOT, 'data_parquet', 'employers.parquet');
const CONTACTS_JSONL = path.join(ROOT, 'data_parquet', 'contacts.jsonl');

const args = process.argv.slice(2);
let format = 'json';
let parquetGlob = DEFAULT_GLOB;
const sqlParts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--csv') format = 'csv';
  else if (a === '--table') format = 'table';
  else if (a === '--parquet') parquetGlob = args[++i];
  else sqlParts.push(a);
}
const sql = sqlParts.join(' ').trim();
if (!sql) {
  console.error('usage: npm run query -- [--csv|--table] [--parquet <glob>] "<SQL>"');
  process.exit(2);
}

const db = new duckdb.Database(':memory:');
const conn = db.connect();
const threads = require('os').cpus().length;

const q = (s) => s.replace(/'/g, "''");
// Guard against an empty JSONL file (DuckDB's read_json_auto cannot infer a schema
// from zero bytes and would crash). Dedup defensively in case enrich is re-run after
// the attempted-cache is cleared — keep the latest row per (ein, contact_email).
const contactsExists = fs.existsSync(CONTACTS_JSONL) && fs.statSync(CONTACTS_JSONL).size > 0;
const contactsSrc = contactsExists
  ? `SELECT * FROM read_json_auto('${q(CONTACTS_JSONL)}', format='newline_delimited')
     QUALIFY ROW_NUMBER() OVER (PARTITION BY ein, contact_email ORDER BY enriched_at DESC) = 1`
  : `SELECT NULL::VARCHAR ein, NULL::VARCHAR contact_name, NULL::VARCHAR contact_title,
            NULL::VARCHAR contact_email, NULL::VARCHAR contact_linkedin,
            NULL::VARCHAR org_domain, NULL::DOUBLE match_confidence,
            NULL::VARCHAR enriched_at
     WHERE 1=0`;

const SETUP_SQL = `
  CREATE VIEW employers AS SELECT * FROM read_parquet('${q(parquetGlob)}');
  CREATE VIEW contacts AS ${contactsSrc};
  CREATE VIEW leads AS
    SELECT e.*,
           c.contact_name, c.contact_title, c.contact_email, c.contact_linkedin,
           c.org_domain, c.match_confidence, c.enriched_at
    FROM employers e
    LEFT JOIN contacts c USING (ein);
`;

conn.exec(`PRAGMA threads=${threads};`, (err) => {
  if (err) throw err;
  conn.exec(SETUP_SQL, (err2) => {
    if (err2) {
      console.error('Failed to set up views:', err2.message);
      process.exit(1);
    }
    conn.all(sql, (err3, rows) => {
      if (err3) {
        console.error('Query error:', err3.message);
        process.exit(1);
      }
      printRows(rows, format);
      db.close();
    });
  });
});

function toScalar(v) {
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function printRows(rows, fmt) {
  if (rows.length === 0) {
    console.error('(no rows)');
    return;
  }
  const cols = Object.keys(rows[0]);
  if (fmt === 'csv') {
    console.log(cols.join(','));
    for (const r of rows) {
      console.log(cols.map(c => csvCell(toScalar(r[c]))).join(','));
    }
  } else if (fmt === 'table') {
    const widths = cols.map(c => Math.max(c.length,
      ...rows.map(r => String(toScalar(r[c]) ?? '').length)));
    const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
    console.log(line(cols));
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(line(cols.map(c => toScalar(r[c]))));
  } else {
    for (const r of rows) {
      const out = {};
      for (const c of cols) out[c] = toScalar(r[c]);
      console.log(JSON.stringify(out));
    }
  }
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
