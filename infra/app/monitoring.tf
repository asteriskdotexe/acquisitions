resource "aws_cloudwatch_log_group" "app" {
  name = "/acquisitions/app"
  retention_in_days = 7
}

data "aws_iam_policy_document" "write_app_logs" {
  statement {
    actions = [ 
        "logs:CreateLogStream",
        "logs:PutLogEvents",
     ]
     resources = [ "${aws_cloudwatch_log_group.app.arn}:*" ]
  }
}

resource "aws_iam_role_policy" "write_app_logs" {
  name = "write-app-logs"
  role = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.write_app_logs.json
}