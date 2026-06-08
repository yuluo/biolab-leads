output "data_bucket_name" {
  description = "Private S3 bucket holding the employer dataset (Lambda reads via IAM)"
  value       = aws_s3_bucket.data.bucket
}

output "contacts_table_name" {
  description = "DynamoDB table holding the retained contacts cache"
  value       = aws_dynamodb_table.contacts.name
}

output "authorized_emails_table_name" {
  description = "DynamoDB table holding the API allowlist"
  value       = aws_dynamodb_table.authorized_emails.name
}

output "api_endpoint" {
  description = "Public base URL of the HTTP API (the only public surface)"
  value       = aws_apigatewayv2_api.api.api_endpoint
}
