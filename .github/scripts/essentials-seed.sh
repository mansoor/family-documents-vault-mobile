#!/usr/bin/env sh
# Before the Essentials flow (4.10): the passport the capture flow sent
# becomes an Essential, and its pages are drawn before the phone is asked
# to keep it. Waiting is done through the vault's own offline set, which
# says when a page is ready — so this script signs in as a phone would
# (an installation id) and takes a grant of its own.
set -eu
V=http://localhost:8099
PHONE=$(cat /proc/sys/kernel/random/uuid)
TOKEN=$(curl -sf "$V/api/v1/auth/password" -H 'content-type: application/json' -H "x-fdv-installation: $PHONE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)
ID=$(curl -sf "$V/api/v1/documents?limit=10" -H "authorization: Bearer $TOKEN" | jq -r '.items[0].id')
test -n "$ID" && test "$ID" != null
curl -sf -X PATCH "$V/api/v1/documents/$ID" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"is_essential":true}' > /dev/null
curl -sf "$V/api/v1/offline/grant" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"password\":\"$PASSWORD\"}" > /dev/null
STATE=none
for i in $(seq 1 60); do
  STATE=$(curl -sf "$V/api/v1/offline/essentials" -H "authorization: Bearer $TOKEN" |
    jq -r --arg id "$ID" '.items[] | select(.document.id == $id) | .version.preview_state')
  [ "$STATE" = ready ] && break
  sleep 3
done
echo "The passport ($ID) is an Essential; its pages: $STATE"
test "$STATE" = ready
# This script's own session is not the phone's: it ends here.
curl -sf -X POST "$V/api/v1/auth/logout" -H "authorization: Bearer $TOKEN" > /dev/null || true
