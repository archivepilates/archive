# ARCHIVE PILATES Mobile Reel Safe Area

- Purpose: prevent the native Shorts right rail and lower channel/title UI from covering edited captions and branding in future reels.
- Effective scope: new renders only. Current approved/public videos, immutable approval snapshots, captions and metadata remain unchanged; do not reupload a source that has reached its reel limit.
- Source: operator screenshot plus approved plan geometry; not an official YouTube guarantee. No member data/mirror/workLanes selects media or publication targets.
- Implementation: canonical scripts/lib/reel-mobile-layout.py, called by scripts/daily-teaching-reel.py. PIL graphics and FFmpeg caption image timelines reuse the local media environment; no paid service or new global package.
- Text safe bounds at 1080x1920: x144-800, y320-1430 (mobile-safe-v2). Reserve the top 320px; brand/heading/instructor positions move down 140px from v1. Video box: x120-872, y660-1180; contain the selected source crop without additional fill cropping. Captions: x132-812 canvas with measured ink inside text bounds, y1230-1420. Remove the bottom footer; keep the official animated ending inside measured bounds.
- Guardrails: overflow fails before upload; rendering into a nonempty output directory fails before changing any sidecar. Retain the private journal lock and existing approval/upload/publication caps.
- Verification: seven offline layout tests, 27 existing approval regressions, a full local render/decode, caption/ending pixel bounds, original-source hash, and phone-aspect simulations. Local QA previews are never uploaded. Native CC and arbitrary app versions still require actual-device review on the next candidate.
- Deployment scope: local canonical runtime plus archive-pilates-core Hosting for the operator rule; no Functions, permissions, products or original paid videos.
- Updated: 2026-10-15 after operator reported remaining upper UI overlap. Current report: docs/reports/2026-10-15-reel-mobile-top-inset.html; prior v1 report remains a historical snapshot.
