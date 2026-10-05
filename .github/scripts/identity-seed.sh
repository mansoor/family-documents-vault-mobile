#!/usr/bin/env sh
# Before the identity flow (5.31): the owner's own identity details, as
# somebody at a computer would fill them in — a name, and a passport whose
# number the vault masks until it is shown.
set -eu
V=http://localhost:8099
test "$(curl -sf "$V/api/v1/capabilities" | jq -r '.features.member_identity')" = true
TOKEN=$(curl -sf "$V/api/v1/auth/password" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)
ME=$(curl -sf "$V/api/v1/me" -H "authorization: Bearer $TOKEN" | jq -r .member_id)
VERSION=$(curl -sf "$V/api/v1/members/$ME/identity" -H "authorization: Bearer $TOKEN" | jq -r .versions.shared)
curl -sf -X PUT "$V/api/v1/members/$ME/identity" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"part\":\"shared\",\"version\":$VERSION,\"fields\":{\"given_name\":\"Pocket\",\"family_name\":\"Owner\",\"ids\":[{\"id\":\"p1\",\"kind\":\"passport\",\"number\":\"E2E123456\",\"issuer\":\"United Kingdom\"}]}}" |
  jq -e '.shared.masked == ["ids.p1"]' > /dev/null
echo "The owner's identity details are kept, the passport number masked."
# This script's own session is not the phone's: it ends here.
curl -sf -X POST "$V/api/v1/auth/logout" -H "authorization: Bearer $TOKEN" > /dev/null || true
