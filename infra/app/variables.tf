variable "app_image" {
  description = "Docker image the server runs"
  type = string
  default = "shubhamsingh7913/acquisitions:latest"
}

variable "alert_email" {
  description = "Email address that receives CloudWatch alarm notifications"
  type = string
}
