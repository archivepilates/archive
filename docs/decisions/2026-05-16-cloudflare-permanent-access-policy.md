# Cloudflare Permanent Access Policy

Date: 2026-05-16

Status: active for Cloudflare DNS and root/www redirect CLI access; rotate exposed setup tokens after setup

## Goal

Give Archive Pilates durable Cloudflare DNS control for `archivepilates.com` without storing passwords, OTPs, recovery codes, global API keys, or unrestricted credentials in Codex, Git, Markdown, screenshots, or shared notes.

## Recommended Ownership Model

Use an Archive Pilates-owned Cloudflare account as the owner of the zone:

- Preferred login identity: `home@archivepilates.com`
- Domain/zone: `archivepilates.com`
- Registrar remains Gabia for now.
- Authoritative DNS moves to Cloudflare after the zone is prepared and verified.

Use the same business-owned Google identity for Gabia browser login when needed:

- Preferred Gabia login path: Google login with `home@archivepilates.com`
- Do not store the Gabia password, Google password, OTP, or passkey recovery material in Codex, Git, Markdown, screenshots, or shared notes.
- If a live Gabia session expires, ask the user to complete any password, OTP, or passkey step directly.

If a personal Cloudflare account is used temporarily, transfer account/member control back to an Archive Pilates-owned login before treating the setup as permanent.

## Google Account And Service Account Boundary

`home@archivepilates.com` can be used as the Cloudflare login email and owner identity.

Google Cloud service accounts, including ArchiveIN service accounts, cannot directly control Cloudflare DNS through Google IAM. Cloudflare DNS writes require Cloudflare-native authorization:

- Cloudflare account membership for browser/dashboard control.
- A scoped Cloudflare API token for CLI, scripts, and Terraform.

Do not use Google service-account JSON keys for Cloudflare. Keep Google/Firebase service accounts limited to Google and Firebase resources.

## Required Human Steps

These steps require the user because Codex must not handle secrets or bypass 2FA.

1. Log in to Cloudflare using the Archive Pilates-owned account.
2. Enable 2FA or passkey protection.
3. Add `archivepilates.com` as a Cloudflare zone.
4. Import the prepared DNS records.
5. Create a scoped API token for CLI/Terraform operation.
6. Store the token locally outside Git.
7. Verify the token with the check script.

## API Token Shape

Use a scoped API token, not a global API key.

The DNS token created on 2026-05-16 is an account-owned `cfat_` token scoped to `archivepilates.com`. Cloudflare's `/user/tokens/verify` endpoint returns 401 for this account-owned token format, so the local check script validates access by reading the target zone and its DNS records directly.

Minimum practical permissions:

| Permission group | Permission | Scope |
| --- | --- | --- |
| Zone | DNS Read | Include `archivepilates.com` only |
| Zone | DNS Write | Include `archivepilates.com` only |
| Zone | Zone Read | Include `archivepilates.com` only |

Recommended token name:

```text
archivepilates-dns-cli-macmini
```

Do not grant account-wide write permissions unless a later task truly requires them.

On 2026-05-20, a user API token was created for zone-level day-to-day operations that the account-owned DNS token could not perform:

| Permission group | Permission | Scope |
| --- | --- | --- |
| Zone | DNS Edit | Include only `archivepilates.com` |
| Zone | Single Redirect Edit | Include only `archivepilates.com` |

Recommended token name:

```text
archivepilates-zone-ops-macmini
```

The zone-ops token is stored in macOS Keychain under:

```text
cloudflare_archivepilates_zone_ops_token
```

Use this token for root/www redirect rules and future Cloudflare single-redirect work. Keep the older DNS token available for Terraform/DNS-only workflows unless it is intentionally rotated into the zone-ops token.

Because the first token value was pasted into chat during setup, rotate it after the nameserver migration is stable:

1. Create a replacement token with the same `archivepilates.com` scope and permissions.
2. Store the replacement in Keychain under `cloudflare_archivepilates_dns_token`.
3. Run the local access check.
4. Revoke the original token in Cloudflare.

## Local Secret Storage

Preferred local storage on the Mac mini:

```bash
security add-generic-password \
  -a archivepilates \
  -s cloudflare_archivepilates_dns_token \
  -w "PASTE_TOKEN_HERE"
```

For the zone operations token:

```bash
security add-generic-password \
  -a archivepilates \
  -s cloudflare_archivepilates_zone_ops_token \
  -w "PASTE_TOKEN_HERE"
```

Read into the shell when needed:

```bash
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -a archivepilates -s cloudflare_archivepilates_dns_token -w)"
```

Do not write the token to `.env`, `terraform.tfvars`, Markdown, screenshots, or Codex memory.

## Local CLI Verification

Run:

```bash
/Users/archivepilates/Documents/ARCHIVE-IN/infra/cloudflare/scripts/check-cloudflare-access.sh
```

For the zone operations token:

```bash
/Users/archivepilates/Documents/ARCHIVE-IN/infra/cloudflare/scripts/check-cloudflare-zone-ops-access.sh
```

Expected result:

- Token can read the Cloudflare zone.
- `archivepilates.com` zone id is returned.
- DNS records can be read.

## Terraform Use

Terraform should receive the token from the environment variable:

```bash
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -a archivepilates -s cloudflare_archivepilates_dns_token -w)"
```

The local ignored `terraform.tfvars` file may contain the Cloudflare zone id only:

```hcl
cloudflare_zone_id = "..."
```

## Revocation

If the Mac mini is replaced or access should be rotated:

1. Revoke `archivepilates-dns-cli-macmini` in Cloudflare.
2. Delete the local Keychain entry:

```bash
security delete-generic-password -a archivepilates -s cloudflare_archivepilates_dns_token
```

Also revoke `archivepilates-zone-ops-macmini` and delete its local Keychain entry when rotating redirect-rule access:

```bash
security delete-generic-password -a archivepilates -s cloudflare_archivepilates_zone_ops_token
```

3. Create a new scoped token and re-run access verification.

## Non-Goals

- Do not store Cloudflare account passwords in Codex.
- Do not use the global API key for routine DNS work.
- Do not transfer registrar away from Gabia until DNS delegation is stable and renewal/account ownership is reviewed separately.
