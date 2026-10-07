# ARCHIVE PILATES Google indexing correction

## Scope and sources
- User approved execution of the October 7 Search Console diagnosis.
- Source branch: codex/mini/google-indexing-20261007, based on d165377.
- Official-home source is not present on current origin/main. Do not promote the whole historical branch into main or deploy unrelated application files.
- Target: Firebase project archive-pilates, Hosting site archive-pilates-home only.
- Credential context: archive-codex-operator service account; Search Console and Imweb UI use home@archivepilates.com Chrome profile.

## Changes
- Remove redirecting /community from the official sitemap, retaining eight indexable canonical pages.
- Change only /community redirect from 302 to 301.
- Imweb SEO common Header Code: exclude non-empty idx product queries from the homepage noindex/canonical condition. Native product routing, access, orders and member groups are unchanged.
- The CLI script list did not contain the current live P1 installer. Its stale values were not written. The authenticated SEO common-code editor was backed up, changed by one line, saved, reloaded and copied back for exact comparison.
- Live /?idx=33 renders a product canonical, no robots noindex tag, and the patched installer.

## Rollback and verification guards
- Preserve all 80 current Hosting paths, including Firebase initialization; only sitemap.xml changes.
- Clone live config and change the single community redirect only.
- Require the captured live version 62fb81c72d9739c8 and reviewed d165377 sitemap baseline.
- Abort on unexpected manifest paths/hashes, sitemap differences, upload requirements or newer release.
- Use local archive-pilates-home-deploy.lock; no concurrent local deployment process was present. Firebase release creation has no atomic expected-release precondition; deploy in an exclusive operating window.
- Local checks: 4 focused Node tests, Korean SEO validator (8 pages), community validator, navigation validator (8 headers), git diff --check.
- Action queue read succeeded from ~/dev/archive-in-runtime: zero unresolved items. The new worktree lacks firebase-admin dependencies; no dependency installation was needed.
- No new staff/member operating policy is introduced. No CORE rules mutation is needed for this one-off public SEO correction; deployment safeguards are recorded here for maintainers.

## Status
- Imweb one-line patch: saved and live verified.
- Search Console: chorim, eunyoung, kihyo, minjin, yuri requests all accepted into Google's priority crawl queue.
- Hosting: deployed and live verified, version 383e8ed81291f74f, release 1791373332381000.
- Live checks: all eight canonical pages return 200; www returns 301 to root; community returns 301 to the Imweb board; sitemap matches tracked source exactly.
- All other 79 live file hashes are identical. Imweb /?idx=33 and /17/?idx=33 have product canonicals and no noindex; real Imweb home retains its prior official-home canonical and noindex,follow.
- Core source commit: 00d1e0f. Push will include this scoped branch, not main promotion: current main lacks this site's historical source and a broad merge would introduce unrelated applications.
- Actual purchase/playback testing: not performed; this patch does not change purchase or watch assets. Full live-manifest equality is the rollback check.
- Google indexing and ranking are not guaranteed by request acceptance; wait for Google's subsequent crawl.
