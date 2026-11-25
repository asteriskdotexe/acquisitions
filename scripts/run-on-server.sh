#!/usr/bin/env bash
# Runs a shell command on the app server through SSM Run Command, waits for it
# to finish and prints its output. Exits with an error if the command failed.
# Usage: bash scripts/run-on-server.sh <instance-id> <comment> <command>
set -euo pipefail

INSTANCE_ID="$1"
COMMENT="$2"
COMMAND="$3"

# Build the parameters as JSON with jq, so quotes and special characters in
# the command reach the server exactly as written.
PARAMS=$(jq -cn --arg cmd "$COMMAND" '{commands: [$cmd]}')

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "$PARAMS" \
  --query "Command.CommandId" \
  --output text)

# The waiter exits with an error if the command fails, so `|| true` lets us
# print the output first.
aws ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true

invocation() {
  aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query "$1" \
    --output text
}

# Server output goes to stdout, so callers can capture it. Errors go to stderr.
invocation StandardOutputContent
invocation StandardErrorContent >&2

STATUS=$(invocation Status)
if [ "$STATUS" != "Success" ]; then
  echo "::error title=Server command failed::$COMMENT finished with status $STATUS. See the output above." >&2
  exit 1
fi