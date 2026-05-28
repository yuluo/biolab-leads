# `employers` / `contacts` / `leads` views — schema reference

`scripts/query.js` exposes three views over the local data:

| view | source | grain |
|---|---|---|
| `employers` | `data_parquet/employers.parquet` | one row per employer (sponsor EIN) — Form 5500 + Schedule A, rolled up. ~62k rows. |
| `contacts`  | `data_parquet/contacts.jsonl` (Apollo enrichment, gitignored PII) | one row per (ein, contact_email); empty if no enrichment has run yet. |
| `leads`     | `employers LEFT JOIN contacts USING (ein)` | one row per (employer, contact); employers with no contact still appear with null contact fields. |

**Default for searches:** query `employers` for counts/previews; query
`leads` for the exported CSV when contact columns are wanted.

Built from DOL Form 5500 + Schedule A (plan years 2024–2025). Employer
contact fields (`signer_name`, `phone`, etc.) come from each employer's
**most recent** welfare filing; funding classification and counts are
rolled up across all of that employer's welfare plans. Apollo enrichment
adds decision-maker columns separately on the `contacts` side.

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

### `contacts` view — Apollo-enriched decision-makers

Populated on the fly by `/search` (calls `enrich.js`) and persisted to
`data_parquet/contacts.jsonl`. Future searches over the same EINs reuse
the cache and spend nothing.

| Column | Type | Meaning |
|---|---|---|
| `ein` | VARCHAR | FK to `employers.ein` |
| `contact_name` | VARCHAR | Decision-maker full name |
| `contact_title` | VARCHAR | e.g. "CHRO", "VP People", "Benefits Director" |
| `contact_email` | VARCHAR | Business email (the unique key with `ein`) |
| `contact_linkedin` | VARCHAR | LinkedIn URL, nullable |
| `org_domain` | VARCHAR | Matched Apollo organization domain |
| `match_confidence` | DOUBLE | Sponsor-name ↔ Apollo-org-name similarity (0–1); flag rows < 0.7 |
| `enriched_at` | VARCHAR | ISO timestamp |

The `leads` view exposes all `employers` columns plus the `contacts`
columns above (left-joined on `ein`). One employer can yield 0, 1, or 2
contacts → 0, 1, or 2 rows in `leads`. Rows with no contact have null
`contact_*` fields.

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
