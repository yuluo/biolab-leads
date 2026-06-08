terraform {
  required_version = ">= 1.0"

  backend "s3" {
    bucket         = "cost-seg-terraform-state-698408381665"
    key            = "biolab-leads/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cost-seg-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "BiolabLeads"
      ManagedBy   = "Terraform"
      Environment = var.environment
    }
  }
}

data "aws_caller_identity" "current" {}
