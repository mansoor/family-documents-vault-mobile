#!/usr/bin/env sh
# Before the row menu flow (5.36): the one document — the passport the
# capture flow sent — is given a note in the vault's small Markdown, as
# somebody at a computer would write it.
set -eu
V=http://localhost:8099
TOKEN=$(curl -sf "$V/api/v1/auth/password" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)
ID=$(curl -sf "$V/api/v1/documents?limit=10" -H "authorization: Bearer $TOKEN" | jq -r '.items[0].id')
test -n "$ID" && test "$ID" != null
NOTE=$(printf '%s\n' '### Where it is' 'The **blue** folder, top shelf.' '- [x] Renewed in 2021' \
  '- [ ] A copy for the bank' '[Renew online](https://www.gov.uk/renew-adult-passport)')
jq -n --arg notes "$NOTE" '{notes: $notes}' |
  curl -sf -X PATCH "$V/api/v1/documents/$ID" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @- |
  jq -e '.notes_updated_at != null' > /dev/null
echo "The passport ($ID) has a note."
# This script's own session is not the phone's: it ends here.
curl -sf -X POST "$V/api/v1/auth/logout" -H "authorization: Bearer $TOKEN" > /dev/null || true
