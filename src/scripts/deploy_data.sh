#!/usr/bin/env bash
# Push the employer dataset to the PRIVATE S3 bucket (read only by the API Lambda
# via IAM). Generates and uploads employers.json.gz (what the Lambda loads) plus
# the canonical employers.parquet. Never touches contacts*.jsonl (PII).
#
# Bucket comes from `terraform output`, or env var DATA_BUCKET.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT/terraform"
PARQUET="$ROOT/data_parquet/employers.parquet"
JSON_GZ="$ROOT/data_parquet/employers.json.gz"

if [[ ! -f "$PARQUET" ]]; then
  echo "error: $PARQUET not found — run 'npm run build-parquet' first." >&2
  exit 1
fi

echo "Building employers.json.gz from parquet"
node "$ROOT/src/scripts/build_employer_json.js"

BUCKET="${DATA_BUCKET:-$(terraform -chdir="$TF_DIR" output -raw data_bucket_name)}"

echo "Uploading employers.json.gz -> s3://$BUCKET/employers.json.gz"
aws s3 cp "$JSON_GZ" "s3://$BUCKET/employers.json.gz" \
  --content-type application/json --content-encoding gzip

echo "Uploading employers.parquet -> s3://$BUCKET/employers.parquet"
aws s3 cp "$PARQUET" "s3://$BUCKET/employers.parquet" \
  --content-type application/octet-stream

echo "Done."
