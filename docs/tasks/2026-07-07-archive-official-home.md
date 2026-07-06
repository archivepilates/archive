# ARCHIVE PILATES Official Homepage

Date: 2026-07-07

## Direction

- `archivepilates.com` should become the official brand homepage that returns `200 OK`.
- Imweb remains the commerce/member system.
- Commerce entry points from the homepage redirect to the existing Imweb site:
  - `/shop` -> `https://archivepilates.imweb.me/16`
  - `/online` -> `https://archivepilates.imweb.me/17`
  - `/offline` -> `https://archivepilates.imweb.me/18`
- Planned DNS shape:
  - `archivepilates.com` and `www.archivepilates.com`: Firebase Hosting site `archive-pilates-home`.
  - `shop.archivepilates.com`: Cloudflare redirect to the existing Imweb shop surface.

## Implementation

- Added isolated Firebase Hosting config: `firebase.archive-home.json`.
- Added static homepage under `official-home/`.
- Reused the prepared ARCHIVE PILATES homepage image set from:
  - `/Users/archivepilates/Downloads/archive_home_images_v2 2/website_ready/`
- Included SEO basics:
  - canonical root URL
  - Korean meta description under Naver's recommended length
  - Open Graph image/title/description
  - `robots.txt`
  - `sitemap.xml`
  - local business JSON-LD

## Verification Plan

- Local static smoke at mobile/tablet/desktop widths.
- Deploy only Firebase Hosting site `archive-pilates-home`.
- Verify default URL `https://archive-pilates-home.web.app/`.
- Create/attach Firebase custom domains for `archivepilates.com` and `www.archivepilates.com`.
- After Firebase provides DNS requirements, update Cloudflare root/www DNS and keep `shop.archivepilates.com` as redirect-only.

## 2026-07-07 Result

- Firebase Hosting site `archive-pilates-home` was created and deployed.
- Default Firebase URL is live: `https://archive-pilates-home.web.app/`.
- Cloudflare DNS was updated:
  - `archivepilates.com` A -> `199.36.158.100`, DNS-only.
  - `www.archivepilates.com` CNAME -> `archive-pilates-home.web.app`, DNS-only.
  - Firebase ownership TXT and ACME TXT records were added.
  - Existing Google Workspace, Google Search Console, and OpenAI TXT records were preserved.
- `shop.archivepilates.com` was configured as a Cloudflare proxied redirect to `https://archivepilates.imweb.me/16`.
- Firebase custom domain state reached `HOST_ACTIVE` and `OWNERSHIP_ACTIVE` for root and `www`.
- As of the last check, Firebase SSL issuance is still `CERT_VALIDATING`.

## Verification

- Local responsive QA passed at 320, 390, 768, and 1280px widths.
- Live default URL returned HTTP 200.
- `shop.archivepilates.com` returned HTTP 302 to the Imweb Shop page.
- Public DNS readback:
  - `archivepilates.com` resolves to `199.36.158.100`.
  - `www.archivepilates.com` resolves to `archive-pilates-home.web.app`.
- Root domain content is already served by Firebase when bypassing certificate validation, but normal HTTPS must wait for Firebase certificate activation.
