variable "app_image" {
  description = "Docker image the server runs"
  type        = string
  default     = "shubhamsingh7913/acquisitions:latest"
}

variable "alert_email" {
  description = "Email address that receives CloudWatch alarm notifications"
  type        = string
}

variable "duckdns_subdomain" {
  description = "DuckDNS subdomain, the part before .duckdns.org"
  type        = string
  default     = "acquisitions"
}