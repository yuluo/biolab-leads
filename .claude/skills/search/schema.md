# `employers` view — schema reference

The skill queries a DuckDB view named **`employers`** backed by a single
parquet file (`data_parquet/employers.parquet`). **One row per employer
(sponsor EIN)** — multiple welfare-plan filings are rolled up. ~62k rows.

Built from DOL Form 5500 + Schedule A (plan years 2024–2025). Contact
fields come from each employer's **most recent** welfare filing; funding
classification and counts are rolled up across all of that employer's
welfare plans.

Connection is established by `scripts/query.js`; SQL passed to
`npm run query -- "<SQL>"` runs against this view.

---

## Columns (authoritative — from `DESCRIBE employers`)

| # | Column | Type | Meaning |
|---|---|---|---|
| 1 | `ein` | VARCHAR | Sponsor EIN, 9 chars zero-padded. The unique key. |
| 2 | `sponsor_name` | VARCHAR | Employer / plan sponsor legal name |
| 3 | `funding_type` | VARCHAR | Rolled-up funding class. See enum below. **Main filter.** |
| 4 | `participants` | BIGINT | Max beginning-of-year participant count across the employer's welfare plans (proxy for headcount) |
| 5 | `welfare_plan_count` | BIGINT | Number of welfare-plan filings this employer has |
| 6 | `business_code` | VARCHAR | 6-digit NAICS-style business activity code. See notes. |
| 7 | `city` | VARCHAR | Sponsor mailing city |
| 8 | `state` | VARCHAR | Sponsor mailing state, 2-letter (e.g. `'CA'`) |
| 9 | `zip` | VARCHAR | Sponsor mailing ZIP, 5 chars zero-padded |
| 10 | `phone` | VARCHAR | Sponsor phone (digits, usually 10) |
| 11 | `admin_name` | VARCHAR | Plan administrator name (often same as sponsor) |
| 12 | `admin_phone` | VARCHAR | Plan administrator phone |
| 13 | `signer_name` | VARCHAR | Name of the person who signed the filing — a real human contact |
| 14 | `welfare_code` | VARCHAR | Welfare benefit type code(s) from the latest filing (e.g. `4A`) |
| 15 | `plan_name` | VARCHAR | Plan name from the latest filing |
| 16 | `has_stop_loss` | BOOLEAN | Any Schedule A reports a stop-loss contract (strong self-insured signal) |
| 17 | `has_health_insurance` | BOOLEAN | Any Schedule A reports health/HMO/PPO/indemnity insurance |
| 18 | `carriers` | VARCHAR | Insurance carrier names from the latest filing's Schedule A, `; `-joined |
| 19 | `latest_plan_year` | INTEGER | Most recent plan year on file (2024 or 2025) |

---

## Enum-like columns — exact values

**`funding_type`** — how the employer pays welfare benefits (rolled up;
an employer is `self-insured` if **any** of its welfare plans is):
- `'self-insured'` — pays from general assets/trust, not insurance. **Prime leads.**
- `'partial'` — both self-funded and insured components (e.g. self-insured
  medical + insured dental, or self-insured with stop-loss). **Also leads.**
- `'fully-insured'` — benefits paid through insurance contracts only.
- `'unknown'` — funding indicators absent/ambiguous on the filing.

**`state`** — standard 2-letter US postal codes, uppercase: `'CA'`, `'TX'`, …

---

## Self-insured targeting idioms

```sql
-- Prime self-insured leads
funding_type = 'self-insured'

-- All addressable self-funded leads (self-insured + partial)
funding_type IN ('self-insured', 'partial')

-- High-confidence self-insured (stop-loss confirms a self-funded medical plan)
funding_type IN ('self-insured', 'partial') AND has_stop_loss

-- Size threshold (configurable per client)
participants >= 500

-- Geography
state = 'CA'

-- Industry by NAICS prefix (see notes): tech / professional services 51xxxx, 54xxxx
business_code LIKE '51%' OR business_code LIKE '54%'
```

---

## Notes / gotchas

- **`business_code`** is the IRS/DOL business activity code, aligned to
  NAICS. Filter by prefix with `LIKE` (e.g. `'62%'` = health care,
  `'31%'`/`'32%'`/`'33%'` = manufacturing, `'54%'` = professional/scientific/
  technical services). It's stored as VARCHAR — use `LIKE`, not numeric ranges.
- **`participants`** is a headcount proxy, not exact employee count; large
  trusts (union/benefit funds) can inflate it. Combine with `sponsor_name`
  sanity checks for lead quality.
- **`ein`, `zip`, `phone`** are VARCHAR to preserve leading zeros — compare
  with string literals (`ein = '094545390'`), never integers.
- Some employers are **benefit trusts / multiemployer funds** (e.g. names
  with "BOARD OF TRUSTEES", "TRUST FUND") rather than single companies —
  filter these out if you want direct-employer leads only.
