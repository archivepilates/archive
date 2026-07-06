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
