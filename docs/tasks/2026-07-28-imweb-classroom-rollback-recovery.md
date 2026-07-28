# Imweb My Classroom rollback recovery

## Incident

- The live Imweb loader still requested the My Classroom JavaScript asset from the official ARCHIVE PILATES homepage.
- The latest official-home deployment came from a branch that did not contain that asset.
- Firebase Hosting rewrote the missing JavaScript request to the official-home HTML document.
- The loader marked the classroom as active before the asset executed, so the older inline fallback did not render.

## Recovery

- Restore the latest My Classroom asset to the current official-home source.
- Change the live loader cache key after the asset is deployed.
- Serve the classroom asset with JavaScript content type and no-store caching.
- Add an official-home predeploy validation that blocks deployment when the asset or required class markers are missing.

## Verification

- Firebase Hosting deployment restored the asset and ran the new predeploy validator.
- Live asset SHA-256 matched the committed file and returned JavaScript content.
- Live asset cache policy was corrected to `no-cache, no-store, must-revalidate`.
- Imweb header loader was updated to cache key `20260728b`.
- Authenticated owner session:
  - My Classroom renderer completed as `2026-07-28b`.
  - 30 cards rendered.
  - AB9, AR5, and ACH8 cards were present.
  - The normal Imweb header/footer did not leak into the standalone classroom.
  - At 390px, all 30 cards rendered in one column with no horizontal overflow.
  - The AB9 watch page rendered its protected watch component and video iframe with no console error.
- Logged-out session:
  - `/48` redirected to the login page.
  - No class card or watch iframe was exposed.
  - A direct AB9 watch-page request also redirected to login with no watch component or iframe.
- Recent completed online orders:
  - All four recent AB9 purchaser accounts were present in the AB9 access group.
  - Both recent AR5 purchaser accounts were present in the AR5 access group.
  - No missing purchaser-group assignment was found.

## Remaining boundary

- A separate logged-in non-buyer browser session was not available in the current browser profiles.
- The logged-out denial, live buyer-group membership, and authenticated classroom rendering were verified independently.

## Recurrence prevention

- The Imweb loader no longer sets `data-ap-classroom` before the external asset executes.
  - If the asset loads normally, the current renderer takes over.
  - If the asset is missing, blocked, or slow, the existing inline renderer remains available instead of leaving a blank classroom.
- The loader records separate success and failure markers for live diagnosis.
- Firebase Hosting now runs:
  - a predeploy release-config, asset, and fallback-behavior validation;
  - a postdeploy live SHA, content-type, cache-policy, Imweb-loader, inline-fallback, and anonymous-gate canary.
- GitHub Actions runs the same static release checks whenever classroom deployment files change.
- A 12-second renderer watchdog performs one fallback-only reload if the external asset
  claims the page but never completes. The reload skips the external asset once so the
  existing inline renderer can recover the classroom instead of leaving it blank.
