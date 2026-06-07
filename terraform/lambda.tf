data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../api"
  output_path = "${path.module}/api.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "biolab-leads-api-${var.environment}"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  role             = aws_iam_role.api_lambda.arn
  handler          = "index.handler"
  runtime          = var.lambda_runtime
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout

  environment {
    variables = {
      DATA_BUCKET    = aws_s3_bucket.data.bucket
      EMPLOYERS_KEY  = "employers.json.gz"
      CONTACTS_TABLE = aws_dynamodb_table.contacts.name
    }
  }
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
