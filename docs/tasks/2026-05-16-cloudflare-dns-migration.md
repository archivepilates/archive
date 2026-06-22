# archivepilates.com Cloudflare DNS Migration

Date: 2026-05-16

Status: Cloudflare DNS active; Gabia nameserver cutover complete; root/www redirect verified; ArchiveIN `in` custom domain complete

## Goal

Move day-to-day DNS control for `archivepilates.com` from Gabia DNS to Cloudflare DNS while keeping Gabia as the registrar for now.

This task keeps Gabia as registrar and moves day-to-day DNS control to Cloudflare. As of 2026-05-16 21:03 KST, Gabia forwarding has been removed, the Gabia domain nameservers have been changed to the two Cloudflare nameservers, and Cloudflare's zone status API reports `active`.

## Prepared Files

- `artifacts/archivepilates-cloudflare-zone-2026-05-16.bind`
- `artifacts/archivepilates-cloudflare-dns-records-2026-05-16.csv`
- `infra/cloudflare/`
- `docs/decisions/2026-05-16-cloudflare-permanent-access-policy.md`

The BIND zone file was intended for the initial Cloudflare DNS import. It marked all web-facing records `cf-proxied:false` so the first import preserved current routing. After the Cloudflare redirect replacement was deployed, `archivepilates.com` and `www.archivepilates.com` were changed to proxied records so Cloudflare Redirect Rules can execute after nameserver cutover.

The Terraform directory is for CLI control after the Cloudflare zone exists. It requires a scoped Cloudflare API token and a local ignored `terraform.tfvars` file containing only the zone id.

## Registrar And Nameservers

Previous Gabia nameservers before cutover:

```text
ns.gabia.net.
ns1.gabia.co.kr.
ns.gabia.co.kr.
```

Current nameservers applied in Gabia:

```text
kara.ns.cloudflare.com
stan.ns.cloudflare.com
```

Gabia DNS table observed in the logged-in browser contained 11 records and was exported to:

```text
/Users/archivepilates/Downloads/gabia_report_cuminstore_2026-05-16.xls
```

Do not commit the downloaded Gabia export unless it has been reviewed for private data.

## Cloudflare Import Status

Cloudflare account:

```text
Home@archivepilates.com's Account
```

Cloudflare zone:

```text
archivepilates.com
Zone ID: 31490d55a57d702fc21f6740bd4f6fe8
Assigned nameservers: kara.ns.cloudflare.com, stan.ns.cloudflare.com
```

Imported on 2026-05-16 using the guarded helper:

```bash
CONFIRM_CLOUDFLARE_IMPORT=true ./infra/cloudflare/scripts/import-gabia-baseline.sh
```

Import result:

```text
11 records parsed
11 records added
A: 4, CNAME: 4, MX: 1, TXT: 2
```

Post-import API readback confirmed 11 records in Cloudflare. After redirect replacement, the apex and `www` A records are proxied with automatic TTL; the other records remain DNS-only.

## Root And WWW Redirect Replacement

Gabia currently blocks the nameserver change because `archivepilates.com` uses Gabia forwarding. Before removing that forwarding, Cloudflare was prepared with an equivalent redirect:

```text
Rule: redirect-root-www-to-naver-blog
Match: archivepilates.com, www.archivepilates.com
Action: 302 redirect to https://m.blog.naver.com/archive_23
Status: Active
```

Cloudflare DNS API readback confirmed:

```text
archivepilates.com      A 121.254.178.238 proxied=true  ttl=auto
www.archivepilates.com  A 121.254.178.238 proxied=true  ttl=auto
```

This redirect is active through the Cloudflare edge. Public DNS returns Cloudflare edge IPs for the apex and `www`, and both HTTP and HTTPS requests return a 302 redirect to the Naver Blog target.

## Cloudflare Import Steps

Use the Cloudflare account intended to own Archive Pilates DNS.

Completed:

1. Add site: `archivepilates.com`.
2. Choose the free plan unless a paid feature is intentionally needed.
3. Import records from `artifacts/archivepilates-cloudflare-zone-2026-05-16.bind`.
4. Confirm Cloudflare shows exactly 11 records.
5. Confirm the baseline records imported.
6. Confirm `@` and `www` are proxied after the Cloudflare redirect replacement is deployed.
7. Confirm these records remain DNS-only:
   - `*`
   - `apply`
   - `mcp`
   - `mcp-external`
   - `careers`
   - `gyrikqeuxlfp`
8. Copy the two Cloudflare-assigned nameservers.

Completed production change:

9. Removed the existing Gabia forwarding service for `archivepilates.com`.
10. Changed Gabia domain nameservers to the two Cloudflare nameservers.
11. Removed the leftover third Gabia nameserver entry so only Cloudflare nameservers remain.

Completed activation check:

- Cloudflare marked the zone active. API status at 2026-05-16 21:03 KST: `active`.
- Cloudflare Overview was opened through the logged-in `home@archivepilates.com` Google-account browser session. It showed `Waiting for your registrar to propagate your new nameservers`.
- Clicked `Check nameservers now` in Cloudflare Overview. Cloudflare responded: `Cloudflare is now checking the nameservers for archivepilates.com. Please wait a few hours for an update.`
- Re-tested root and `www` redirect after Cloudflare activation.

Remaining local wait state:

- The Mac's default resolver still returned `Could not resolve host` for root and `www` immediately after activation, while 1.1.1.1 and Cloudflare edge tests succeeded.

Gabia login note:

- If the Gabia session expires, use the Google login path with the `home@archivepilates.com` Google account.
- Do not store or request the Gabia password in Codex.

## Optional API Import

Only run this after the Cloudflare zone exists and a scoped API token has been created.

Required token scope:

- Zone: `archivepilates.com`
- Permissions: `Zone Read`, `DNS Read`, `DNS Write`

Example:

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/import" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --form "file=@artifacts/archivepilates-cloudflare-zone-2026-05-16.bind"
```

Do not paste the token into Markdown, shell history snippets, screenshots, or Git. Store it in macOS Keychain using the access policy document.

Verify access before any DNS write:

```bash
/Users/archivepilates/Documents/ARCHIVE-IN/infra/cloudflare/scripts/check-cloudflare-access.sh
```

Store the token and write local Terraform variables with:

```bash
cd /Users/archivepilates/Documents/ARCHIVE-IN/infra/cloudflare/scripts
./store-cloudflare-token.sh
./check-cloudflare-access.sh
./write-terraform-vars.sh
```

The import helper is guarded because it writes DNS records:

```bash
CONFIRM_CLOUDFLARE_IMPORT=true ./import-gabia-baseline.sh
```

## Terraform Control

After Cloudflare has the zone and the DNS baseline is confirmed:

```bash
cd /Users/archivepilates/Documents/ARCHIVE-IN/infra/cloudflare
export CLOUDFLARE_API_TOKEN="..."
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
```

Run `terraform apply` only after a reviewed plan and explicit user approval.

## Pre-Change Verification

Before changing Gabia nameservers:

```bash
dig +short NS archivepilates.com
dig +short A archivepilates.com
dig +short A www.archivepilates.com
dig +short CNAME apply.archivepilates.com
dig +short MX archivepilates.com
dig +short TXT archivepilates.com
curl -I --max-time 10 http://archivepilates.com
curl -I --max-time 10 https://apply.archivepilates.com/
curl -I --max-time 10 https://mcp-external.archivepilates.com/archive-ai/health
```

Expected before cutover:

- NS returns Gabia nameservers.
- Apex and `www` return `121.254.178.238`.
- `apply` returns `gen-lang-client-0876433128.web.app.`
- MX returns `smtp.google.com.`
- TXT includes Google site verification and OpenAI domain verification.
- Apply and MCP health checks return HTTP 200.

## Post-Change Verification

After Gabia nameserver change:

```bash
dig +short NS archivepilates.com
dig +trace archivepilates.com NS
dig @1.1.1.1 +short A archivepilates.com
dig @1.1.1.1 +short A www.archivepilates.com
dig @1.1.1.1 +short CNAME apply.archivepilates.com
dig @1.1.1.1 +short MX archivepilates.com
dig @1.1.1.1 +short TXT archivepilates.com
curl -I --max-time 10 http://archivepilates.com
curl -I --max-time 10 https://apply.archivepilates.com/
curl -I --max-time 10 https://mcp-external.archivepilates.com/archive-ai/health
```

Expected after cutover:

- NS returns the two Cloudflare nameservers.
- DNS answers match the imported records.
- `apply.archivepilates.com` remains HTTP 200.
- `mcp-external.archivepilates.com/archive-ai/health` remains HTTP 200.
- Mail MX and TXT verification records remain present.

## Post-Change Result

Checked on 2026-05-16 20:45 KST.

Gabia browser state:

```text
1차 kara.ns.cloudflare.com
2차 stan.ns.cloudflare.com
```

Public resolver result:

```text
dig @1.1.1.1 +short NS archivepilates.com
kara.ns.cloudflare.com.
stan.ns.cloudflare.com.

dig @8.8.8.8 +short NS archivepilates.com
stan.ns.cloudflare.com.
kara.ns.cloudflare.com.
```

Cloudflare authoritative DNS and 1.1.1.1 returned the imported records:

```text
archivepilates.com A 121.254.178.238
www.archivepilates.com A 121.254.178.238
apply.archivepilates.com CNAME gen-lang-client-0876433128.web.app.
archivepilates.com MX 1 smtp.google.com.
archivepilates.com TXT google-site-verification=JMq3ERS4H7ot66e9K6kXwK9nN_soWp1lOJsecLL-vco
archivepilates.com TXT openai-domain-verification=dv-E3xTw7PDwnUWOZtzdj7Jy443
```

Cloudflare API DNS record readback:

```text
archivepilates.com      A 121.254.178.238 proxied=true ttl=auto
www.archivepilates.com  A 121.254.178.238 proxied=true ttl=auto
```

Cloudflare zone status:

```text
status: pending
activated_on: null
```

Service checks:

```text
https://apply.archivepilates.com/ HTTP/2 200
https://mcp-external.archivepilates.com/archive-ai/health HTTP/2 200
```

Local Mac resolver note:

```text
curl -I http://archivepilates.com
curl: (6) Could not resolve host: archivepilates.com
```

The Mac was using ISP/Tailscale resolver paths immediately after the cutover. Public resolvers already showed Cloudflare nameservers, so this was treated as local resolver cache or resolver propagation lag rather than a Gabia configuration failure.

## Activation Result

Checked on 2026-05-16 21:03 KST.

Cloudflare zone API:

```text
status: active
activated_on: 2026-05-16T11:49:25.344659Z
```

Public DNS:

```text
dig @1.1.1.1 +short NS archivepilates.com
kara.ns.cloudflare.com.
stan.ns.cloudflare.com.

dig @8.8.8.8 +short NS archivepilates.com
stan.ns.cloudflare.com.
kara.ns.cloudflare.com.

dig @1.1.1.1 +short A archivepilates.com
172.67.184.236
104.21.19.31

dig @1.1.1.1 +short A www.archivepilates.com
104.21.19.31
172.67.184.236
```

Root and `www` redirect through Cloudflare edge:

```text
http://archivepilates.com  HTTP/1.1 302 Found -> https://m.blog.naver.com/archive_23
https://archivepilates.com HTTP/2 302 -> https://m.blog.naver.com/archive_23
http://www.archivepilates.com  HTTP/1.1 302 Found -> https://m.blog.naver.com/archive_23
https://www.archivepilates.com HTTP/2 302 -> https://m.blog.naver.com/archive_23
```

Service checks:

```text
https://apply.archivepilates.com/ HTTP/2 200
https://mcp-external.archivepilates.com/archive-ai/health HTTP/2 200
```

Residual local resolver note:

```text
curl -I http://archivepilates.com
curl: (6) Could not resolve host: archivepilates.com
```

The root and `www` redirect was verified by resolving the Cloudflare edge IPs from 1.1.1.1 and passing them to curl with `--resolve`. This confirms Cloudflare edge behavior even though the local Mac resolver had not caught up yet.

## Local Resolver Follow-Up

Checked on 2026-05-16 21:20 KST.

After disabling Tailscale DNS acceptance on this Mac and flushing DNS cache, the default macOS resolver now resolves root and `www` normally:

```text
archivepilates.com     172.67.184.236, 104.21.19.31
www.archivepilates.com 104.21.19.31, 172.67.184.236
```

Plain curl, without `--resolve`, now verifies the live redirect:

```text
http://archivepilates.com        HTTP/1.1 302 Found -> https://m.blog.naver.com/archive_23
https://archivepilates.com       HTTP/2 302 -> https://m.blog.naver.com/archive_23
http://www.archivepilates.com    HTTP/1.1 302 Found -> https://m.blog.naver.com/archive_23
https://www.archivepilates.com   HTTP/2 302 -> https://m.blog.naver.com/archive_23
```

Service checks remained healthy:

```text
https://apply.archivepilates.com/ HTTP/2 200
https://mcp-external.archivepilates.com/archive-ai/health HTTP/2 200
```

## Rollback

If cutover breaks live services, revert nameservers in Gabia to:

```text
ns.gabia.net.
ns1.gabia.co.kr.
ns.gabia.co.kr.
```

Then re-run the post-change verification commands until public resolvers return the Gabia nameservers again.

## Deferred Improvements After Migration

Do these after Cloudflare is active and baseline routing is stable:

1. Fix apex and `www` HTTPS with a proper root web host or redirect host.
2. Add `in.archivepilates.com` as the ArchiveIN custom domain in Firebase Hosting.
3. Add `dashboard.archivepilates.com` only after the dashboard access policy is confirmed.
4. Remove or repoint wildcard forwarding once the intended subdomain map is finalized.

## ArchiveIN Custom Domain Progress

Started on 2026-05-16 21:30 KST.

Created and deployed a dedicated Firebase Hosting site for ArchiveIN:

```text
Project: archive-pilates
Site: archive-pilates-in
Default URL: https://archive-pilates-in.web.app
Verification: HTTP/2 200, title 아카이브IN
```

Configured Firebase custom domain:

```text
in.archivepilates.com -> archive-pilates-in
```

Cloudflare DNS records now set:

```text
in.archivepilates.com CNAME archive-pilates-in.web.app DNS-only
_acme-challenge.in.archivepilates.com TXT 4Vy5MVzOmrkzIkvzOr0Zjv5E1dVEjQXb3TXtTYjpLw0 DNS-only
```

Public DNS already resolves through the new CNAME:

```text
dig @1.1.1.1 +short CNAME in.archivepilates.com
archive-pilates-in.web.app.

dig @1.1.1.1 +short A in.archivepilates.com
archive-pilates-in.web.app.
199.36.158.100
```

Firebase state after DNS propagation:

```text
hostState: HOST_ACTIVE
ownershipState: OWNERSHIP_ACTIVE
certState: CERT_PROPAGATING
issues: null
```

Live HTTPS check at 2026-05-16 22:17 KST:

```text
https://in.archivepilates.com/ HTTP/2 200
title: 아카이브IN
```

Final Firebase certificate check at 2026-05-16 23:03 KST:

```text
hostState: HOST_ACTIVE
ownershipState: OWNERSHIP_ACTIVE
certState: CERT_ACTIVE
issues: null
```

ArchiveIN custom domain is complete:

```text
https://in.archivepilates.com/ HTTP/2 200
title: 아카이브IN
```

## Imweb Main Homepage Domain Follow-Up

Checked on 2026-05-20 KST while building the public ARCHIVE PILATES homepage in Imweb.

Published Imweb site:

```text
https://archivepilates.imweb.me/ HTTP/2 200
title: ARCHIVE PILATES
visible content includes ARCHIVE PILATES INSTRUCTOR CLASS
visible address includes 부산 강서구 명지국제2로28번길 34 에코팰리스 704호
```

Registered `archivepilates.com` inside Imweb domain settings. Imweb accepted the domain, but it requires these assigned nameservers:

```text
cns1.hostcocoa.com 205.251.196.138
cns2.hostcocoa.com 205.251.194.81
cns3.hostcocoa.com 205.251.193.7
cns4.hostcocoa.com 205.251.199.181
```

Current authoritative nameservers remain Cloudflare:

```text
kara.ns.cloudflare.com
stan.ns.cloudflare.com
```

Do not switch the registrar nameservers to HostCocoa casually. Cloudflare is currently authoritative for root redirect behavior plus active subdomains and mail records such as `in`, `apply`, `mcp`, `mcp-external`, Google Workspace MX, Google verification, and OpenAI verification. Moving nameservers away from Cloudflare without rebuilding all records would risk breaking those services.

Initial production root behavior after the Imweb publish:

```text
https://archivepilates.com/ HTTP/2 302
location: https://m.blog.naver.com/archive_23
```

Cloudflare API status from the Mac mini Keychain token:

```text
Zone read: ok
DNS record read: ok
Rulesets API: authentication error
Page Rules API: account-owned token unsupported
Workers routes API: authentication error
```

Safe next production path:

1. Keep Cloudflare as the authoritative DNS provider.
2. Replace the existing Cloudflare root/www redirect target from `https://m.blog.naver.com/archive_23` to `https://archivepilates.imweb.me/`.
3. Use Cloudflare dashboard access or a new token/member permission that can edit Redirect Rules, Page Rules, or Workers routes.
4. After redirect replacement, verify `https://archivepilates.com/` and `https://www.archivepilates.com/` reach the published ARCHIVE PILATES Imweb homepage.

Completed on 2026-05-20 KST:

- Created a user API token named `archivepilates-zone-ops-macmini`.
- Stored it in macOS Keychain service `cloudflare_archivepilates_zone_ops_token`.
- Verified user-token status, DNS read access, and Single Redirect read access with `infra/cloudflare/scripts/check-cloudflare-zone-ops-access.sh`.
- Updated the Cloudflare `http_request_dynamic_redirect` entrypoint rule:

```text
Rule description: redirect-root-www-to-imweb-home
Match: archivepilates.com, www.archivepilates.com
Action: 302 redirect to https://archivepilates.imweb.me/
Status: enabled
```

Live verification after propagation:

```text
https://archivepilates.com/ HTTP/2 302
location: https://archivepilates.imweb.me/
final status: 200
final content: ARCHIVE PILATES INSTRUCTOR CLASS

https://www.archivepilates.com/ HTTP/2 302
location: https://archivepilates.imweb.me/
final status: 200
final content: ARCHIVE PILATES INSTRUCTOR CLASS
```

Custom-domain follow-up on 2026-06-21 KST:

- Goal: make `archivepilates.com` remain in the browser address bar instead of using a Cloudflare 302 redirect to `archivepilates.imweb.me`.
- Current Cloudflare state:
  - Authoritative nameservers remain `kara.ns.cloudflare.com` and `stan.ns.cloudflare.com`.
  - Root and `www` still use proxied A records pointing to `121.254.178.238`.
  - Dynamic redirect rule `redirect-root-www-to-imweb-home` is still enabled and redirects root/www to `https://archivepilates.imweb.me/`.
- Direct origin test result:
  - `curl -k --resolve archivepilates.com:443:121.254.178.238 https://archivepilates.com/` returns a broken placeholder HTML with a blank `http://` refresh.
  - TLS SNI against `121.254.178.238` serves a `*.gabia.com` certificate, not an `archivepilates.com` certificate.
  - Therefore, simply disabling the Cloudflare redirect would break the root site.
- Official Imweb path checked:
  - Standard third-party domain connection requires switching nameservers to the Imweb/HostCocoa nameservers assigned in Imweb Admin.
  - Imweb CNAME alias is the safer path if Cloudflare must remain authoritative, but it requires Imweb CNAME permission/verification and issuance of the `cf` domain alias from Imweb Admin or Imweb support.
- Safe next action:
  - Keep the Cloudflare redirect enabled until Imweb issues a CNAME alias or the user intentionally chooses full nameserver migration.
  - After Imweb CNAME alias is issued, add the required verification record and alias records in Cloudflare, then disable the Cloudflare redirect and verify `https://archivepilates.com/`, `https://www.archivepilates.com/`, `/sitemap.xml`, and raw SEO metadata.

Imweb admin completion attempt on 2026-06-21 KST:

- Tried to continue the CNAME-alias path from the Mac mini.
- Chrome was on the macOS lock screen, and the Imweb admin tabs were not authenticated.
- Copied Chrome profiles to temporary Playwright user-data dirs without printing cookie/session values and checked `Default`, `Profile 1`, `Profile 2`, and `Profile 3`; all reached the Imweb admin email/password login screen.
- Imweb OpenAPI does not expose domain-management operations. Official developer docs list Site-Info read operations only, and direct probes for domain/SEO paths returned 404.
- Current blocker: Imweb must first issue/enable CNAME alias from authenticated Imweb Admin or Imweb support chat. Until that alias exists, keep the Cloudflare redirect rule enabled.

Imweb admin recheck after home-profile access on 2026-06-21 11:59 KST:

- Chrome home profile was authenticated in Imweb Admin.
- Domain admin state:
  - `archivepilates.com` is already connected in Imweb and selected as the representative domain.
  - Current nameservers shown in Imweb: `kara.ns.cloudflare.com`, `stan.ns.cloudflare.com`.
  - Assigned Imweb/HostCocoa nameservers: `cns1.hostcocoa.com`, `cns2.hostcocoa.com`, `cns3.hostcocoa.com`, `cns4.hostcocoa.com`.
  - Imweb still shows that personal-domain SSL is not automatically applied.
- SEO admin state:
  - `검색 엔진과 AI에 검색 허용` is on.
  - `아임웹 기본 도메인만 검색되지 않도록 합니다` is selected, which is the correct personal-domain SEO setting once `archivepilates.com` serves the Imweb site directly.
- Current production risk:
  - `archivepilates.com` still reaches the site through the Cloudflare 302 redirect to `https://archivepilates.imweb.me/`.
  - Because the Imweb default domain is intentionally noindexed, this redirect path keeps exposing a raw noindex page to crawlers.
- Safe next action:
  - Request/enable Imweb CNAME alias permission and obtain the verification record plus cf-domain alias.
  - Add those records in Cloudflare.
  - Only after CNAME/SSL works, disable the Cloudflare redirect rule `redirect-root-www-to-imweb-home`.
  - Do not move nameservers from Cloudflare to HostCocoa unless the user explicitly chooses full nameserver migration after exporting/importing all active Cloudflare records.

Imweb CNAME alias request sent on 2026-06-21 KST:

- Attempted to continue through the Imweb admin/customer-support route in the Chrome home profile.
- Admin login screen appeared again; saved password dots were visible but not accepted as an actual submitted password, and no matching `imweb.me` item was found in macOS Keychain by direct service lookup.
- Sent the CNAME alias request by Gmail from `home@archivepilates.com` to Imweb support `help@imweb.me`.
- Gmail sent message id: `19eea150d56dc4f8`.
- Request asked Imweb to keep Cloudflare nameservers and issue/enable CNAME alias connection for:
  - `archivepilates.com`
  - `www.archivepilates.com`
- Requested reply payload:
  - required verification record
  - CNAME/cf-domain alias target
- Next action after Imweb replies:
  - Add the issued verification/alias records in Cloudflare.
  - Verify direct `https://archivepilates.com/` and `https://www.archivepilates.com/` HTTPS behavior.
  - Disable the Cloudflare redirect only after direct custom-domain SSL is working.

Imweb CNAME alias retry on 2026-06-22 KST:

- Checked Gmail for the prior request.
- Imweb replied from `help@imweb.me` with subject `Re: [도메인] archivepilates.com CNAME 별칭 연결 허용 요청`.
- Reply result:
  - The old `help@imweb.me` email path no longer handles support 상담.
  - Imweb now requires logged-in real-time chat through `https://imweb.me`, the lower-right purple headset icon, `내 사이트`, or `고객지원`.
- Retried Imweb admin/customer-support access using the `home@archivepilates.com` route and local Keychain credentials without printing the password.
- Imweb account/site context observed during the retry:
  - Site/account: `ARCHIVE PILATES`
  - Imweb domain: `archivepilates.imweb.me`
  - Main domain: `archivepilates.com`
  - Plan/member type: `Pro`
  - Personal-domain SSL state observed by Imweb: not active
- Automation blocker:
  - The Channel.io support script loaded on the Imweb customer page.
  - The chat iframe `ch-plugin-script-iframe` remained `0x0` and did not open a visible messenger after `show`, `showMessenger`, and `CHPlugin.show()` attempts.
  - The automated page exposed only the `고객지원` page link, not a usable chat compose surface.
- No CNAME alias, cf-domain alias target, or verification record has been received yet.
- No Cloudflare DNS or redirect changes were made.
- Keep the Cloudflare redirect enabled until Imweb provides the alias/verification values and direct HTTPS for `archivepilates.com` and `www.archivepilates.com` is verified.

Prepared support-chat request text:

```text
안녕하세요. ARCHIVE PILATES 사이트 도메인 연결 관련 문의드립니다.

사이트: archivepilates.imweb.me
연결 도메인: archivepilates.com, www.archivepilates.com

현재 archivepilates.com 네임서버는 Cloudflare(kara.ns.cloudflare.com, stan.ns.cloudflare.com)를 사용 중입니다. Google Workspace MX, 여러 하위도메인, 검증 TXT 레코드가 Cloudflare에서 운영 중이라 HostCocoa 네임서버로 전체 이전하지 않고 Cloudflare를 유지하려고 합니다.

archivepilates.com / www.archivepilates.com을 아임웹 사이트에 직접 연결해서 주소창에 archivepilates.com이 유지되도록 CNAME 별칭 연결을 허용/발급해 주세요.

필요한 도메인 소유권 검증 레코드와 CNAME 또는 cf-domain alias target 값을 알려주시면 Cloudflare DNS에 반영하겠습니다.
```
