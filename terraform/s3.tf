resource "aws_s3_bucket" "data" {
  bucket = "biolab-leads-data-${data.aws_caller_identity.current.account_id}-${var.environment}"
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket is private. Read access is granted to the API Lambda via its IAM role
# (see iam.tf), not via a bucket policy. The API is the only public surface.
