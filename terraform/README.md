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

## Not yet built (next steps)

The web UI / frontend; per-key rate limiting beyond API-Gateway throttling. Also review Apollo
redistribution terms + a retention/deletion posture before public launch.
