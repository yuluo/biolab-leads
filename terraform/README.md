# biolab-leads — AWS infrastructure

A public HTTP API is the **only** public surface; the data layer behind it is private.

- **HTTP API** (`biolab-leads-api`, API Gateway v2 → Lambda). **Every request must send two
  headers** (enforced by auth middleware): `X-Apollo-Key` (the user's Apollo key) and
  `X-User-Email` (an email on the allowlist). Missing header → `401`; un-allowlisted email →
  `403`.
  - `GET /employers` — filtered, paginated employer list (state, employee count, industry,
    funding type, …), filtered in-memory by the Lambda.
  - `GET /contacts?ein=` — retained contacts for one employer (DynamoDB).
  - `POST /contacts/enrich` — enrich one employer via Apollo using the caller's `X-Apollo-Key`
    header, persist to DynamoDB, return contacts. The key is used transiently, never stored.
- **Usage log** → DynamoDB `biolab-leads-api-usage-prod` (PK `email` / SK `<iso>#<requestId>`,
  GSI `by_day`). One row per authorized request — search events record their filters and result
  count; enrich records `apollo_calls`, `contacts_found`, and `reason`. Rows expire via TTL after
  90 days. The Lambda only has `PutItem` on this table; reads are done directly with your AWS
  credentials via `npm --prefix src run usage` (no public admin endpoint):

  ```sh
  npm --prefix src run usage -- --days 7 --summary  # past 7 days, per-account rollup
  npm --prefix src run usage -- --email a@b.com     # one account, newest first
  npm --prefix src run usage -- --day 2026-06-15    # one day (by_day GSI)
  npm --prefix src run usage -- --since-date 2026-06-01 --until-date 2026-06-07 --summary
  ```

  The `/usage` skill wraps this with natural ranges (`/usage past month`,
  `/usage today`, `/usage <email>`) and defaults to the past 7 days.
- **Allowlist** → DynamoDB `biolab-leads-authorized-emails-prod` (PK `email`), managed with
  `npm --prefix src run authorize-email -- <add|remove|list>`. Self-asserted email gate (not
  cryptographic auth).
- **Employer data** → `employers.json.gz` (+ `employers.parquet`) in a **private** S3 bucket;
  the Lambda reads it via its IAM role. Public DOL data, no PII.
- **Contacts** → DynamoDB `biolab-leads-contacts-prod` (PK `ein` / SK `contact_email`), a
  retained cache that accumulates as users enrich companies with their own Apollo keys.

State is stored in the shared cost-seg backend
(`cost-seg-terraform-state-698408381665`) under key `biolab-leads/terraform.tfstate`.

## Deploy

```sh
# 1. Install the Lambda's runtime deps so they get bundled into the zip.
npm --prefix api ci   # or: (cd api && npm install)

# 2. Provision the API, Lambda, IAM, S3 bucket, and DynamoDB table.
cd terraform
terraform init
terraform plan        # adds API/Lambda/IAM; destroys the old CloudFront distribution
terraform apply

# 3. Build + upload the employer dataset (run after each `npm run build-parquet`).
cd ..
npm --prefix src run deploy-data

# 4. Seed the contacts table from data_parquet/contacts.jsonl (one-time / idempotent).
npm --prefix src run seed-contacts

# 5. Authorize emails so they can call the API (the API rejects everyone else).
npm --prefix src run authorize-email -- add you@example.com
npm --prefix src run authorize-email -- list
```

`deploy-data`, `seed-contacts`, and `authorize-email` read the table names from `terraform output`.
Override with env vars `DATA_BUCKET` / `CONTACTS_TABLE` if running outside the terraform dir.

## Outputs

- `api_endpoint` — public base URL of the HTTP API (the only public surface)
- `data_bucket_name` — private S3 bucket holding the employer dataset
- `contacts_table_name` — DynamoDB contacts cache
- `usage_table_name` — DynamoDB per-account usage log

## Not yet built (next steps)

The web UI / frontend; per-key rate limiting beyond API-Gateway throttling. Also review Apollo
redistribution terms + a retention/deletion posture before public launch.
