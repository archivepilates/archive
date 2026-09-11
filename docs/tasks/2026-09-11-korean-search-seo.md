# Korean Search SEO

## Scope
- Improve official homepage discoverability for Korean name searches and Pilates instructor lessons/education.
- Preserve Imweb settings, purchase links, member access, products, stock and countdown assets.
- Source: current public homepage, team profiles and Imweb lesson description.
- Guidance: Google Search Essentials and title-link guidance; Naver Search Advisor content markup.
- No invented credentials, star ratings, certificates, guaranteed ranking, or fixed recruitment availability.

## Source Boundary
- Dedicated branch: `codex/mini/korean-search-seo-20260911`.
- Base: published `origin/codex/mini/team-jung-yuri-20260907` at `9e4af66`.
- `origin/main` currently lacks the entire official-home site. It is not a safe source for this Hosting release; main integration remains separate.
- Canonical repository is `archivepilates/archive`, accessed through the existing Git worktree.
- Before release: Hosting version `6518d2b582ce7918`, 2026-09-07.
- All local public files match that live version with Node 24 gzip hashes; two `/__/firebase/init.*` files are Firebase-generated, not missing source.
- Deploy only project `archive-pilates`, Hosting `archive-pilates-home`, config `firebase.archive-home.json`, with operator service-account helper.

## Changes
- Distinct Korean title and description for home, team roster and five staff profiles.
- Natural visible Korean context, preserving biography facts and portrait layout.
- Evergreen `/instructor-lessons` guide linked from home and team roster, with actual learning topics, audience, location and existing booking/video links.
- Website and service/page structured data aligned with visible information.
- Sitemap updated only for changed public pages; build-time SEO guard added.
- No ARCHIVE CORE rule update needed: this changes public content only, not staff actions, messaging, sync, approvals, access or policy.

## Verification / Release
- All eight scoped predeploy guard groups passed before final metadata shortening: public SEO, UX, address, team, community, shipping route, classroom release, and video sales.
- Guide browser QA passed at 320/390/768/1440px: no horizontal overflow, missing images or text clipping; FAQ touch and keyboard activation works; visible focus retained.
- Desktop and mobile guide screenshots reviewed under ignored `output/playwright/`.
- Latest live release was rechecked as `6518d2b582ce7918`. Only the intended eight existing HTML/sitemap files differ; all existing shared assets remain byte-identical.
- Remaining: final guard rerun, independent existing-page QA, scoped release and live readback.
- Search rankings and Search Console/Search Advisor indexed state are separate from deployment success.
