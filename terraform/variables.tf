variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "contacts_table_name" {
  description = "DynamoDB table name for the retained Apollo-enriched contacts cache"
  type        = string
  default     = "biolab-leads-contacts-prod"
}

variable "authorized_emails_table_name" {
  description = "DynamoDB table name for the API allowlist (authorized emails)"
  type        = string
  default     = "biolab-leads-authorized-emails-prod"
}

variable "lambda_runtime" {
  description = "Lambda runtime version"
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_memory_size" {
  description = "Lambda memory size in MB"
  type        = number
  default     = 1024
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 30
}
