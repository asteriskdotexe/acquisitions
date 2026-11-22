output "instance_id" {
  value = aws_instance.app.id
}

output "app_url" {
  value = "https://${local.domain}"
}