#!/usr/bin/env bash
# Starts the TOTP server, runs a Maestro flow, then stops the server.
# Usage: scripts/run-maestro-with-otp.sh maestro/scotaccount-login.yaml [extra maestro args]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOW="${1:?flow file required}"
shift || true

: "${SCOTACCOUNT_TOTP_SECRET:?SCOTACCOUNT_TOTP_SECRET must be set}"
: "${SCOTACCOUNT_EMAIL:?SCOTACCOUNT_EMAIL must be set}"
: "${SCOTACCOUNT_PASSWORD:?SCOTACCOUNT_PASSWORD must be set}"

export TOTP_PORT="${TOTP_PORT:-4567}"
export TOTP_SERVER_TOKEN="${TOTP_SERVER_TOKEN:-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')}"

# Android emulators reach the host at 10.0.2.2. Maestro's http client runs on
# the host machine though, not on the device, so 127.0.0.1 is correct here.
TOTP_SERVER_URL="http://127.0.0.1:${TOTP_PORT}/otp"

node "$HERE/otp-server.js" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to come up
for _ in $(seq 1 20); do
  if curl -fsS -H "X-OTP-Token: $TOTP_SERVER_TOKEN" "$TOTP_SERVER_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

maestro test \
  -e SCOTACCOUNT_EMAIL="$SCOTACCOUNT_EMAIL" \
  -e SCOTACCOUNT_PASSWORD="$SCOTACCOUNT_PASSWORD" \
  -e TOTP_SERVER_URL="$TOTP_SERVER_URL" \
  -e TOTP_SERVER_TOKEN="$TOTP_SERVER_TOKEN" \
  "$@" \
  "$FLOW"
