resource "aws_dynamodb_table" "contacts" {
  name         = var.contacts_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ein"
  range_key    = "contact_email"

  attribute {
    name = "ein"
    type = "S"
  }

  attribute {
    name = "contact_email"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "Biolab Leads Contacts Cache"
  }
}
