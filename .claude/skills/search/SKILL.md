---
name: search
description: Translate natural-language questions about self-insured employers into DuckDB SQL and run them against the `employers` view. Use when the user asks about employers, self-insured / self-funded plans, funding type, participant/headcount size, industry (NAICS/business code), geography, stop-loss, insurance carriers, plan sponsors, or any ad-hoc filter over the Form 5500 employer dataset. Also triggered by `/search <question>`.
---

# search — natural-language query of the `employers` dataset

You (Claude) are the translator. This skill turns a plain-English question
into a DuckDB SELECT, runs it via the project's `npm run query` helper,
and shows the result.

## Step 0 — Load the reference files

**Before translating any question, read both companion files in this
skill's directory:**

- `schema.md` — authoritative column list, types, the `funding_type` enum,
  and the NAICS/leading-zero gotchas.
- `examples.md` — canonical NL → SQL shapes. Match the user's question to
  the closest example's structure.

These files are the source of truth. Don't guess column names or values
from memory.

CSV dumps go to the project-root `query-result/` directory. The directory
is created on demand. Old files are not auto-cleaned.

## Step 1 — Translate

Build a single SELECT against the view **`employers`**.

**Hard rules:**

1. **Always `SELECT *`** — never a projected column subset — **unless**
   the user explicitly names the columns they want (example 10 in
   `examples.md`).
2. **Default `LIMIT 100`**. Drop the `LIMIT` only when the user uses
   words like *"all"*, *"no limit"*, *"everything"*, *"export"*,
   *"every"*, *"complete list"*.
3. **String literals** use single quotes and are case-sensitive:
   `state = 'CA'`, not `'ca'`. Use `ILIKE` for fuzzy name matches
   (`sponsor_name ILIKE '%apple%'`).
4. **VARCHAR keys with leading zeros** (`ein`, `zip`, `phone`,
   `business_code`): compare with string literals, never integers. Filter
   `business_code` by NAICS prefix with `LIKE` (e.g. `'54%'`).
5. **Self-insured intent**: "self-insured" → `funding_type = 'self-insured'`;
   "self-funded / addressable leads" usually → `funding_type IN
   ('self-insured','partial')`. State which you chose.
6. **Size**: "employees / headcount / size" → `participants` (a proxy —
   say so when it matters).
7. **State any assumptions in one line** before the SQL when the question
   is vague (e.g. "tech" → NAICS 51/54; "large" → `participants >= 1000`).

## Step 2 — Execute

Run **three** commands using the same `npm run query` helper from
`src/scripts/query.js`. Always pass `--silent` (the npm `> …` script
banner otherwise pollutes the CSV dump). Use
`npm --silent --prefix src run query -- …` so the shell stays in the
project root and CSV redirects (step c) write to `query-result/` correctly.

**(a) Count first.**

```bash
npm --silent --prefix src run query -- "SELECT COUNT(*) AS total FROM employers WHERE <predicate>"
```

**(b) Inline preview.** Always 10 rows, table format, for in-chat display.

```bash
npm --silent --prefix src run query -- --table "SELECT * FROM employers WHERE <predicate> LIMIT 10"
```

**(c) Full CSV dump.** Write the user-requested result set to
`query-result/<slug>.csv` at the project root. Use the user-supplied
`LIMIT` (default 100; drop `LIMIT` on "all" / "no limit" / "export" /
"everything" / "every" / "complete list"). The `--silent` flag is
**required** here so only CSV rows land in the file.

```bash
mkdir -p query-result
npm --silent --prefix src run query -- --csv "SELECT * FROM employers WHERE <predicate> LIMIT 100" \
  > query-result/<slug>.csv
```

`<slug>` is a short kebab-case summary (e.g.
`self-insured-ca-500plus`) with a UTC timestamp suffix
`-YYYYMMDDTHHMMSS` so repeated runs don't clobber.

If the user supplied no predicate (e.g. *"show me some employers"*), skip
both the count and the CSV dump — just run the 10-row preview.

## Step 3 — Respond

Format the reply as:

1. **One-line assumption note** (only if you made an interpretation call).
2. **Translated SQL**, in a ```sql fenced block.
3. **Total matches**: `**Total matches: 3,589**` on its own line.
4. **10-row preview table** from step 2b.
5. **Saved-to line**: `Full result (N rows) saved to query-result/<slug>.csv.`
6. If the CSV was capped (`total > LIMIT`), add: *"Increase the limit or
   say 'no limit' to capture more."*

## Step 4 — Follow-ups

If the user's question references a column or concept that isn't in
`schema.md`, ask **one** clarifying question rather than guessing. Good
clarifiers:

- *"By 'self-insured' do you want only fully self-funded plans, or also
  partially self-funded (`partial`) employers?"*
- *"By 'large' do you mean 1,000+ participants, or a different threshold?"*

Don't invent columns or `funding_type` values not in `schema.md`.
