#!/usr/bin/env sh
# Before the redesign flow (R7): a reminder on the passport, due today, as
# somebody would set one at a computer. Home shows it as an alert, the bell
# counts it, and Needs attention has it under Now.
set -eu
V=http://localhost:8099
TOKEN=$(curl -sf "$V/api/v1/auth/password" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)
ID=$(curl -sf "$V/api/v1/documents?limit=10" -H "authorization: Bearer $TOKEN" | jq -r '.items[0].id')
test -n "$ID" && test "$ID" != null
TODAY=$(date -u +%Y-%m-%d)
R=$(jq -n --arg d "$ID" --arg at "$TODAY" '{document_id: $d, fire_at: $at, note: "Check the renewal form"}' |
  curl -sf -X POST "$V/api/v1/reminders" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @- |
  jq -r .id)
test -n "$R" && test "$R" != null
curl -sf "$V/api/v1/reminders?state=due" -H "authorization: Bearer $TOKEN" | jq -e --arg r "$R" '[.items[].id] | index($r) != null' > /dev/null
echo "The passport ($ID) has a reminder due today ($R)."
# This script's own session is not the phone's: it ends here.
curl -sf -X POST "$V/api/v1/auth/logout" -H "authorization: Bearer $TOKEN" > /dev/null || true
