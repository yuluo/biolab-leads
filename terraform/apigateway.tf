resource "aws_apigatewayv2_api" "api" {
  name          = "biolab-leads-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins  = ["*"]
    allow_methods  = ["GET", "POST", "OPTIONS"]
    allow_headers  = ["content-type", "x-apollo-key"]
    expose_headers = ["content-type"]
    max_age        = 300
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "employers" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /employers"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "get_contacts" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /contacts"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "enrich_contacts" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /contacts/enrich"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit   = 50
  }
}
