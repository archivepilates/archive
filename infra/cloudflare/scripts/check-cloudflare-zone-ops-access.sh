#!/usr/bin/env bash
set -euo pipefail

API_BASE="https://api.cloudflare.com/client/v4"
ZONE_NAME="archivepilates.com"
SERVICE_NAME="cloudflare_archivepilates_zone_ops_token"
ACCOUNT_NAME="archivepilates"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  token_from_keychain="$(security find-generic-password -a "${ACCOUNT_NAME}" -s "${SERVICE_NAME}" -w 2>/dev/null || true)"
  if [[ -n "$token_from_keychain" ]]; then
    export CLOUDFLARE_API_TOKEN="$token_from_keychain"
  fi
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "missing CLOUDFLARE_API_TOKEN"
  echo "Set it in the environment or store it in macOS Keychain service ${SERVICE_NAME}."
  exit 1
fi

verify_json="$(curl -fsS \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${API_BASE}/user/tokens/verify")"

if [[ "$(printf '%s' "$verify_json" | jq -r '.success')" != "true" ]]; then
  echo "Cloudflare user-token verification failed."
  exit 1
fi

echo "Cloudflare user-token verification: ok"

zones_json="$(curl -fsS \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --get "${API_BASE}/zones" \
  --data-urlencode "name=${ZONE_NAME}" \
  --data-urlencode "per_page=1")"

zone_id="$(printf '%s' "$zones_json" | jq -r '.result[0].id // empty')"

if [[ -z "$zone_id" ]]; then
  echo "Cloudflare zone not found or token cannot read ${ZONE_NAME}."
  exit 1
fi

echo "Zone: ${ZONE_NAME}"
echo "Zone ID: ${zone_id}"

dns_json="$(curl -fsS \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  --get "${API_BASE}/zones/${zone_id}/dns_records" \
  --data-urlencode "per_page=3")"

if [[ "$(printf '%s' "$dns_json" | jq -r '.success')" != "true" ]]; then
  echo "DNS record lookup failed."
  exit 1
fi

echo "DNS read: ok"

redirect_json="$(curl -fsS \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "${API_BASE}/zones/${zone_id}/rulesets/phases/http_request_dynamic_redirect/entrypoint")"

if [[ "$(printf '%s' "$redirect_json" | jq -r '.success')" != "true" ]]; then
  echo "Single Redirect ruleset lookup failed."
  exit 1
fi

rule_count="$(printf '%s' "$redirect_json" | jq '.result.rules | length')"
echo "Single Redirect read: ok"
echo "Single Redirect rules visible to token: ${rule_count}"
