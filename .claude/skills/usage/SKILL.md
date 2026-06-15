---
name: usage
description: Show per-account API usage for the self-insured employer API, defaulting to the past 7 days. Use when the user asks who is using the API, how much an account has used it, search/enrich/lookup activity, Apollo-call spend per account, or any usage-over-time question. Also triggered by `/usage [range] [email]`.
---

# usage — per-account API usage report

This skill reports usage of the public employer API from the DynamoDB usage
log. It wraps the `npm run usage` CLI (`src/scripts/usage.js`), which reads the
table directly with the caller's AWS credentials — there is no public endpoint.

The default view is a **per-account rollup** over the **past 7 days**.

## Step 1 — Parse the request into CLI flags

The user's argument (everything after `/usage`) sets the time window and,
optionally, a single account. Translate natural phrasing into flags:

| User says | Flags |
|---|---|
| (nothing) | `--days 7` |
| `today` | `--days 1` |
| `last N days`, `past N days`, or just `N` | `--days N` |
| `past week` / `this week` | `--days 7` |
| `past month` / `last 30 days` | `--days 30` |
| `since 2026-06-01` | `--since-date 2026-06-01` |
| `2026-06-10..2026-06-14` or `from X to Y` | `--since-date X --until-date Y` |
| a single date `2026-06-15` | `--day 2026-06-15` |

Dates are UTC, `YYYY-MM-DD`. `--days N` means the last N calendar days ending
today; the CLI computes the actual dates, so you do not need today's date.

If the argument contains an **email address**, add `--email <addr>`. A named
account switches the output from a rollup to that account's full event list
(newest first), so **omit `--summary`** in that case.

Default (no email) → add `--summary` for the per-account rollup.

## Step 2 — Run the CLI

Always use `--silent` so the npm banner stays out of the output. The AWS SDK
prints a `NodeVersionSupportWarning` to stderr on Node < 22 — **ignore it**.

Per-account rollup (default and the common case):

```bash
npm --silent --prefix src run usage -- --days 7 --summary 2>/dev/null
```

Single account, full detail:

```bash
npm --silent --prefix src run usage -- --days 7 --email someone@co.com 2>/dev/null
```

Swap in the flags chosen in Step 1. Redirecting stderr to `/dev/null` drops the
SDK warning; the report goes to stdout. If you need the raw data instead of the
formatted text, append `--json`.

The CLI prints a `window: <since>..<until>` line first, then either the rollup
(`total events · Apollo calls`, a per-account breakdown sorted by request count,
and a per-endpoint tally) or the event list.

If the CLI errors with "Could not read usage_table_name from terraform output",
the infra isn't applied or AWS creds are missing — tell the user to run
`terraform apply` (see `terraform/README.md`) or check their credentials.

## Step 3 — Respond

Lead with the window in plain English (e.g. "Past 7 days (Jun 9–15):"), then:

- **Rollup**: a short per-account table — account, total requests, the
  search / lookup / enrich split, and Apollo calls. Call out the heaviest
  account and total Apollo spend, since that is the real cost driver.
- **Single account**: summarize what they did — searches (with filters and
  result counts), enrich outcomes (contacts found, `no_org_match`, Apollo calls
  used), and lookups.

Keep it tight. Offer one relevant follow-up (e.g. "want just the searches, a
longer window, or a specific account?").
