resource "aws_cloudwatch_log_group" "app" {
  name              = "/acquisitions/app"
  retention_in_days = 7
}

data "aws_iam_policy_document" "write_app_logs" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }
}

resource "aws_iam_role_policy" "write_app_logs" {
  name   = "write-app-logs"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.write_app_logs.json
}

resource "aws_sns_topic" "alerts" {
  name = "acquisitions-alerts"
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  name           = "app-errors"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name          = "AppErrors"
    namespace     = "Acquisitions"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "app_errors" {
  alarm_name        = "acquisitions-app-errors"
  alarm_description = "The app logged at least one error in the last 5 minutes"

  namespace   = aws_cloudwatch_log_metric_filter.app_errors.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.app_errors.metric_transformation[0].name
  statistic   = "Sum"
  period      = 300

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "instance_status" {
  alarm_name        = "acquisitions-instance-status"
  alarm_description = "An EC2 status check failed on the app server"

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed"
  dimensions = {
    InstanceId = aws_instance.app.id
  }
  statistic = "Maximum"
  period    = 60

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 2

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}