terraform {
  required_version = ">=1.15"

  required_providers {
    aws = {
        source = "hashicorp/aws"
        version = "~>6.23"
    }
  }
}

provider "aws" {
  region = "ap-south-1"

  default_tags {
    tags ={
        Project = "acquisitions"
        ManagedBy = "terraform"
    }
  }
}

resource "aws_s3_bucket" "tfstate"{
    bucket = "shubham-acquisitions-tfstate"

    lifecycle {
      prevent_destroy = true
    }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
    bucket=aws_s3_bucket.tfstate.id

    rule {
        apply_server_side_encryption_by_default {
            sse_algorithm = "AES256"
        }
    }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

output "state_bucket_name" {
  value = aws_s3_bucket.tfstate.bucket
}