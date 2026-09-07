# ARCHIVE PILATES Team: Jung Yuri

## Scope and Sources
- Request: register Jung Yuri on the official team page using the supplied portrait
  and the existing Notion instructor biography.
- Authoritative copy: Notion "정유리 강사님", child of "아카이브 강사님":
  https://www.notion.so/3cad49eae4bf8104a51bc6b1ec56f8ed
- Source read on 2026-09-07; source last edited on 2026-09-02.
- The supplied PNG remains unchanged in Google Drive. The website JPEG retains
  its complete 1254-by-1254 composition and is compressed to 267,749 bytes.
- Preserve all nine source qualifications. Narrative is paraphrased for the
  existing profile format, not presented as a verbatim instructor quote.

## Implementation
- Add a fifth team card and `/teams/yuri` profile using the existing navigation,
  typography, profile sections, qualification disclosure, and footer.
- Three roster columns on smaller desktops; five columns from 1200px. Preserve
  the existing two-column mobile/tablet layout and touch/reduced-motion behavior.
- Add canonical, Open Graph, Person structured data, and sitemap entry.
- Extend the roster guard to validate every profile's canonical URL, Person data,
  and portrait, plus the new instructor's identity and nine qualifications.
- No Imweb code, products, price schedules, member access, Functions, DNS,
  Firebase configuration, or existing portraits changed.
- No ARCHIVE CORE operating-rule update needed: public biographical content only;
  no staff workflow, member communication, approval, or automation rule changed.

## Source and Release Boundary
- Repository: https://github.com/archivepilates/archive.git
- Worktree: `/Users/archivepilates/codex-worktrees/team-jung-yuri-20260907`.
- Branch: `codex/mini/team-jung-yuri-20260907`, based on deployed source `0fbb792`.
- Current `origin/main` lacks the official-home site and diverges from the public
  release lineage. Do not merge unrelated application changes or deploy from it.
- Publish only this scoped branch; integration of the historical release lineage
  with main remains separate from this instructor addition.
- Target: Firebase project `archive-pilates`, Hosting site `archive-pilates-home`,
  dedicated config `firebase.archive-home.json`.
- Pre-release Hosting version: `63c046e0f767ec39`.
- Full 71-path Hosting manifest comparison: only the roster and sitemap differ;
  no missing or unexpected differences. New profile and portrait are additions.

## Verification
- Seven configured predeploy validation groups pass, including classroom release,
  loader fallback, community route, shipping route, and video-sales guards.
- Local browser checks pass at 320, 390, 768, and 1440px: roster/profile navigation,
  all portraits load, qualification disclosure opens with nine items, no document
  horizontal overflow, no clipped checked headings/tags/list items, no page errors.
- Desktop roster and mobile profile screenshots visually reviewed.
- Evidence: ignored `output/playwright/team-yuri-20260907/` and
  `artifacts/team-yuri-20260907/before-hosting.json`.

## Released and Verified
- Code commit: `d0366ec`; pushed to the matching origin branch with its own upstream.
- Deployed Hosting version: `6518d2b582ce7918` on `archive-pilates-home`.
- Live `/teams` and `/teams/yuri` pass the same four-width browser checks (eight
  page/viewport combinations). Mobile touch plus reduced-motion emulation also
  passes profile navigation and qualification disclosure.
- The deployed 73-path manifest matches local source. Compared with the previous
  release: two additions (portrait and profile), two changes (roster and sitemap),
  zero deletions and zero unrelated changes. Hash with the deployment Node 24
  runtime; Node 25 produces different gzip bytes even for identical source files.
- Classroom postdeploy canary passes: current asset SHA/cache headers, one current
  loader and fallback, and anonymous login redirects for classroom/ACA6/ACH9.
- Ordinary-member playback and checkout were not re-exercised: no member-facing
  code or entitlement data changed; the complete shared-asset hash set is intact.
- Task-owned Playwright session/browser PID 38615 closed. Temporary touch context
  closed in finally; local server on 127.0.0.1:8876 stopped. User tabs untouched.
- GitHub code-check run: https://github.com/archivepilates/archive/actions/runs/34101382856
