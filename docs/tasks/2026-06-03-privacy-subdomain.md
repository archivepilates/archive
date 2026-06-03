# ARCHIVE PILATES privacy policy subdomain

Date: 2026-06-03

## Purpose

Create a public privacy policy URL for Google OAuth / YouTube API verification and ARCHIVE PILATES external-service disclosures.

## Legal and organization details

- Applicant legal name: 배민진
- Organization name: ARCHIVE PILATES 명지점
- Official organization address: 부산광역시 강서구 명지국제8로 265, 신화빌딩 6층
- Privacy contact: home@archivepilates.com

## Implementation

- Firebase project: `archive-pilates`
- Firebase Hosting site: `archive-pilates-privacy`
- Source directory: `privacy/`
- Default live URL: `https://archive-pilates-privacy.web.app/`
- Target custom URL: `https://privacy.archivepilates.com/`

## Verification

- `https://archive-pilates-privacy.web.app/` returned HTTP 200 after deploy.
- `https://privacy.archivepilates.com/` returned HTTP 200 with a matching certificate after Firebase custom-domain activation.
- Page content includes the privacy policy title, ARCHIVE PILATES organization details, 배민진, the official address, and YouTube API disclosure text.
- Cloudflare DNS for `privacy.archivepilates.com` was set to `CNAME archive-pilates-privacy.web.app`.
- Cloudflare DNS for `_acme-challenge.privacy.archivepilates.com` was set to the Firebase certificate TXT value.

## Current status

- Default Firebase Hosting URL is live.
- Custom domain DNS is configured and verified.
- Firebase custom-domain SSL certificate is active enough for normal HTTPS verification. Firebase status may temporarily show `CERT_PROPAGATING` while edge propagation finishes.
