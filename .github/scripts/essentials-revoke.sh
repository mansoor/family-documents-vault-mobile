#!/usr/bin/env sh
# Between the Essentials flows (4.10): the vault revokes the phone's
# session, as its owner would from the web's list of signed-in devices —
# every session but this script's own.
set -eu
V=http://localhost:8099
TOKEN=$(curl -sf "$V/api/v1/auth/password" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)
IDS=$(curl -sf "$V/api/v1/auth/sessions" -H "authorization: Bearer $TOKEN" | jq -r '.items[] | select(.current | not) | .id')
test -n "$IDS" || { echo "no session to revoke: the phone is not signed in"; exit 1; }
for id in $IDS; do
  curl -sf -X DELETE "$V/api/v1/auth/sessions/$id" -H "authorization: Bearer $TOKEN"
done
echo "Revoked $(echo "$IDS" | wc -w) session(s)."
