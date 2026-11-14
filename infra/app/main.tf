terraform {
  required_version = ">=1.15"

  required_providers {
    aws = {
        source = "hashicorp/aws"
        version = "~>6.23"
    }
  }

  backend "s3" {
    bucket = "shubham-acquisitions-tfstate"
    key = "app/terraform.tfstate"
    region = "ap-south-1"
    encrypt = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"

  default_tags {
    tags = {
      Project = "acquisitions"
      ManagedBy = "terraform"
    }
  }
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  enable_dns_support = true
  enable_dns_hostnames = true

  tags = {
    Name = "acquisitions-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
  availability_zone = "ap-south-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "acquisitions-public-subnet"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "acquisitions-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "acquisitions-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name = "acquisitions-app-sg"
  description = "Allow HTTP in and all traffic out"
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "acquisitions-app-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.app.id
  description = "HTTP from anywhere"
  cidr_ipv4 = "0.0.0.0/0"
  from_port = 80
  to_port = 80
  ip_protocol = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description = "All outbound traffic"
  cidr_ipv4 = "0.0.0.0/0"
  ip_protocol = "-1"
}

data "aws_iam_policy_document" "ec2_assume_role"{
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name = "acquisitions-app-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "acquisitions-app-profile"
  role = aws_iam_role.app.name
}

#aws ssm get-parameters-by-path --path /acquisitions/prod --query "Parameters[].Name"

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  app_params_arn = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/acquisitions/prod"
}

data "aws_iam_policy_document" "read_app_params" {
  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]

    resources = [
      local.app_params_arn,
      "${local.app_params_arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "read_app_params" {
  name = "read-app-parameters"
  role = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.read_app_params.json
}

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "app" {
  ami = data.aws_ssm_parameter.al2023_ami.insecure_value
  instance_type = "t3.micro"
  subnet_id = aws_subnet.public.id
  vpc_security_group_ids = [ aws_security_group.app.id ]
  iam_instance_profile = aws_iam_instance_profile.app.name

  user_data = templatefile("${path.module}/user_data.sh.tftpl",{
    region = data.aws_region.current.region
    param_path = "/acquisitions/prod"
    app_image = var.app_image
  })
  user_data_replace_on_change = true

  metadata_options {
    http_tokens = "required"
    http_put_response_hop_limit = 1
  }

  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted = true
  }

  lifecycle {
    ignore_changes = [ ami ]
  }

  tags = {
    Name = "acquisitions-app"
  }
}
