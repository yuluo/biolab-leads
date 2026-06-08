#!/usr/bin/env node
// Transform data_parquet/employers.parquet -> data_parquet/employers.json.gz
// (a gzipped JSON array of row objects) for the API Lambda to load and filter
// in memory. Run after `npm run build-parquet`.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const duckdb = require('duckdb');

const ROOT = path.resolve(__dirname, '..', '..');
const PARQUET = path.join(ROOT, 'data_parquet', 'employers.parquet');
const OUT = path.join(ROOT, 'data_parquet', 'employers.json.gz');

if (!fs.existsSync(PARQUET)) {
  console.error(`error: ${PARQUET} not found — run 'npm run build-parquet' first.`);
  process.exit(1);
}

const db = new duckdb.Database(':memory:');
const conn = db.connect();
const q = (s) => s.replace(/'/g, "''");

conn.all(`SELECT * FROM read_parquet('${q(PARQUET)}')`, (err, rows) => {
  if (err) { console.error('build-employer-json failed:', err.message); process.exit(1); }
  // DuckDB returns BIGINT columns (participants, welfare_plan_count) as BigInt — coerce to Number.
  const jsonStr = JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v));
  const gz = zlib.gzipSync(Buffer.from(jsonStr), { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${rows.length} rows, ${(gz.length / 1e6).toFixed(2)} MB gzipped)`);
  db.close();
});
