#!/usr/bin/env node
// Run an ad-hoc SQL query against the parquet dataset.
//
// The dataset is exposed as a view named `employers`.
// Usage:
//   npm run query -- "SELECT COUNT(*) FROM employers"
//   npm run query -- "SELECT ein,sponsor_name FROM employers WHERE state='CA' LIMIT 5"
//
// Flags (must come before the SQL string):
//   --csv          print rows as CSV instead of JSON lines
//   --table        print rows as an aligned ASCII table
//   --parquet PATH override parquet path (default: data_parquet/employers.parquet)

const path = require('path');
const duckdb = require('duckdb');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_GLOB = path.join(ROOT, 'data_parquet', 'employers.parquet');

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

conn.exec(`PRAGMA threads=${threads};`, (err) => {
  if (err) throw err;
  conn.exec(
    `CREATE VIEW employers AS
     SELECT * FROM read_parquet('${parquetGlob.replace(/'/g, "''")}');`,
    (err2) => {
      if (err2) {
        console.error('Failed to open parquet dataset:', err2.message);
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
    }
  );
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
