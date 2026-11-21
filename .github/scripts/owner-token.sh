# Sourced by the seed scripts (sh): the e2e owner's access token, as the vault
# of 0.9.0 gives it to an owner — the password, then a fresh code from the
# run's authenticator (totp.mjs serve, on :8097). The vault's limit on
# sign-ins is waited out (its retry_after), twice at most. Extra curl
# arguments (an installation header, say) go with both requests.
#   TOKEN=$(owner_token)

# POST $1 with body $2 (and the extra arguments): the body, once not 429.
owner_post() {
  URL=$1
  DATA=$2
  shift 2
  for TRY in 1 2 3; do
    OUT=$(curl -s -w '\n%{http_code}' "$URL" -H 'content-type: application/json' "$@" -d "$DATA")
    STATUS=$(echo "$OUT" | tail -n 1)
    BODY=$(echo "$OUT" | sed '$d')
    [ "$STATUS" = 429 ] || break
    WAIT=$(echo "$BODY" | jq -r '.error.retry_after // 10')
    sleep $((WAIT + 1))
  done
  if [ "$STATUS" != 200 ]; then
    echo "$URL: $STATUS" >&2
    return 1
  fi
  echo "$BODY"
}

owner_token() {
  ANSWER=$(owner_post "$V/api/v1/auth/password" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$@") || return 1
  MFA=$(echo "$ANSWER" | jq -r '.mfa_token // empty')
  if [ -z "$MFA" ]; then
    echo "$ANSWER" | jq -r .access_token
    return
  fi
  CODE=$(curl -sf --max-time 45 http://localhost:8097/code) || return 1
  owner_post "$V/api/v1/auth/mfa" "{\"mfa_token\":\"$MFA\",\"code\":\"$CODE\"}" "$@" | jq -r .access_token
}
