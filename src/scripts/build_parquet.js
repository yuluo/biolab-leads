#!/usr/bin/env node
// Transform: DOL Form 5500 + Schedule A CSVs under raw/ -> data_parquet/employers.parquet
// One row per employer (sponsor EIN), classified self-insured / partial / fully-insured.
// Usage: npm run build-parquet [-- <rawDir> <outFile>]

const path = require('path');
const fs = require('fs');
const duckdb = require('duckdb');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = process.argv[2] || path.join(ROOT, 'raw');
const OUT_FILE = process.argv[3] || path.join(ROOT, 'data_parquet', 'employers.parquet');

if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size > 0) {
  console.error(`Output file already exists: ${OUT_FILE}`);
  console.error('Remove it first or pass a different path as the 2nd argument.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const MAIN_GLOB = path.join(RAW_DIR, 'F_5500_*', 'f_5500_*_latest.csv');
const SCHA_GLOB = path.join(RAW_DIR, 'F_SCH_A_*', 'F_SCH_A_*_latest.csv');

const db = new duckdb.Database(':memory:');
const conn = db.connect();
const threads = require('os').cpus().length;

console.log(`Reading 5500:      ${MAIN_GLOB}`);
console.log(`Reading Schedule A: ${SCHA_GLOB}`);
console.log(`Writing:           ${OUT_FILE}`);
console.log(`Threads:           ${threads}`);

const q = (s) => s.replace(/'/g, "''");

const SQL = `
COPY (
  WITH mains AS (
    SELECT
      ACK_ID,
      lpad(CAST(SPONS_DFE_EIN AS VARCHAR), 9, '0')        AS ein,
      SPONSOR_DFE_NAME                                    AS sponsor_name,
      SPONS_DFE_MAIL_US_CITY                              AS city,
      SPONS_DFE_MAIL_US_STATE                             AS state,
      lpad(CAST(SPONS_DFE_MAIL_US_ZIP AS VARCHAR), 5, '0') AS zip,
      CAST(SPONS_DFE_PHONE_NUM AS VARCHAR)                AS phone,
      CAST(BUSINESS_CODE AS VARCHAR)                      AS business_code,
      ADMIN_NAME                                          AS admin_name,
      CAST(ADMIN_PHONE_NUM AS VARCHAR)                    AS admin_phone,
      SPONS_SIGNED_NAME                                   AS signer_name,
      PLAN_NAME                                           AS plan_name,
      CAST(TYPE_WELFARE_BNFT_CODE AS VARCHAR)             AS welfare_code,
      TRY_CAST(TOT_PARTCP_BOY_CNT AS BIGINT)              AS participants,
      TRY_CAST(DATE_RECEIVED AS DATE)                     AS date_received,
      CAST(substr(CAST(FORM_TAX_PRD AS VARCHAR), 1, 4) AS INTEGER) AS plan_year,
      (TRY_CAST(BENEFIT_GEN_ASSET_IND AS INT) = 1
        OR TRY_CAST(BENEFIT_TRUST_IND AS INT) = 1)        AS benefit_self,
      TRY_CAST(BENEFIT_INSURANCE_IND AS INT) = 1          AS benefit_ins
    FROM read_csv_auto('${q(MAIN_GLOB)}', union_by_name=true, sample_size=-1)
    WHERE TYPE_WELFARE_BNFT_CODE IS NOT NULL
      AND TRIM(CAST(TYPE_WELFARE_BNFT_CODE AS VARCHAR)) <> ''
      AND SPONS_DFE_EIN IS NOT NULL
  ),
  sched_a AS (
    SELECT
      ACK_ID,
      bool_or(TRY_CAST(WLFR_BNFT_STOP_LOSS_IND AS INT) = 1) AS has_stop_loss,
      bool_or(TRY_CAST(WLFR_BNFT_HEALTH_IND AS INT) = 1
        OR TRY_CAST(WLFR_BNFT_HMO_IND AS INT) = 1
        OR TRY_CAST(WLFR_BNFT_PPO_IND AS INT) = 1
        OR TRY_CAST(WLFR_BNFT_INDEMNITY_IND AS INT) = 1)   AS has_health_ins,
      string_agg(DISTINCT INS_CARRIER_NAME, '; ')          AS carriers
    FROM read_csv_auto('${q(SCHA_GLOB)}', union_by_name=true, sample_size=-1)
    GROUP BY ACK_ID
  ),
  filings AS (
    SELECT
      m.*,
      COALESCE(a.has_stop_loss, false)  AS has_stop_loss,
      COALESCE(a.has_health_ins, false) AS has_health_ins,
      a.carriers,
      CASE
        WHEN m.benefit_self AND NOT m.benefit_ins THEN 'self-insured'
        WHEN m.benefit_self AND m.benefit_ins      THEN 'partial'
        WHEN m.benefit_ins                          THEN 'fully-insured'
        ELSE 'unknown'
      END AS filing_funding_type
    FROM mains m
    LEFT JOIN sched_a a USING (ACK_ID)
  ),
  latest AS (
    SELECT *
    FROM filings
    QUALIFY row_number() OVER (
      PARTITION BY ein
      ORDER BY plan_year DESC NULLS LAST, date_received DESC NULLS LAST
    ) = 1
  ),
  rolled AS (
    SELECT
      ein,
      CASE
        WHEN bool_or(filing_funding_type = 'self-insured')  THEN 'self-insured'
        WHEN bool_or(filing_funding_type = 'partial')        THEN 'partial'
        WHEN bool_or(filing_funding_type = 'fully-insured')  THEN 'fully-insured'
        ELSE 'unknown'
      END                          AS funding_type,
      count(*)                     AS welfare_plan_count,
      max(participants)            AS participants,
      bool_or(has_stop_loss)       AS has_stop_loss,
      bool_or(has_health_ins)      AS has_health_insurance,
      max(plan_year)               AS latest_plan_year
    FROM filings
    GROUP BY ein
  )
  SELECT
    l.ein, l.sponsor_name, r.funding_type,
    r.participants, r.welfare_plan_count, l.business_code,
    l.city, l.state, l.zip, l.phone,
    l.admin_name, l.admin_phone, l.signer_name,
    l.welfare_code, l.plan_name,
    r.has_stop_loss, r.has_health_insurance, l.carriers,
    r.latest_plan_year
  FROM rolled r
  JOIN latest l USING (ein)
)
TO '${q(OUT_FILE)}' (FORMAT PARQUET, COMPRESSION ZSTD);
`;

const start = Date.now();
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`;
}
function report() {
  const sz = fs.existsSync(OUT_FILE) ? (fs.statSync(OUT_FILE).size / 1e6).toFixed(1) : '0.0';
  console.log(`[progress] ${fmtElapsed(Date.now() - start)}  ${sz} MB written`);
}

conn.exec(`PRAGMA threads=${threads};`, (err) => {
  if (err) throw err;
  const tick = setInterval(report, 30_000);
  conn.exec(SQL, (err2) => {
    clearInterval(tick);
    if (err2) {
      console.error('Parquet build failed:', err2.message);
      process.exit(1);
    }
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    const mb = (fs.statSync(OUT_FILE).size / 1e6).toFixed(1);
    console.log(`Done in ${secs}s -> ${OUT_FILE} (${mb} MB)`);
    db.close();
  });
});
