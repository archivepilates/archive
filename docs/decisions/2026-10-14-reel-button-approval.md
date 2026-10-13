# ARCHIVE PILATES Reel Button Approval

- Purpose: remove repeated heartbeat prompts from the operator chat and replace
  approval replies with a scoped email button.
- User approved the specific approval endpoint, CORE rule release, scoped commit
  and GitHub push on 2026-10-14. No member/product/paid-video access changes.
- Canonical media/publication journal remains the private Mac mini file at
  ~/Library/Application Support/ARCHIVE PILATES/daily-youtube-reels/state.json.
- Promoted approval source: youtubeReelApprovals/{videoId-contentHashPrefix}.
  This is not a member mirror or workLanes selection source. workLanes may hold
  implementation evidence only; it must not select targets for publication.
- The request snapshot fixes channel, video, reviewed metadata fingerprint and
  rendered-file hash. Tokens are random 256-bit capabilities, sent only to
  home@archivepilates.com, stored as hashes remotely, and expire after seven days.
  This proves possession of the mail link, not the identity of the person clicking.
- URL fragments keep raw tokens out of HTTP GET paths/logs and referrers. GET and
  initial POST inspect never approve. Explicit same-origin JSON POST approve is
  required; transactional scope/expiry checks run again before the single update.
- Approval is not publication. The Mac mini worker re-reads the approved source,
  verifies it against the journal and live owned YouTube metadata, then publishes
  at most one per KST date. Existing approvals/legacy publications are preserved.
- Gmail is home@archivepilates.com; YouTube is archivepilates@gmail.com and channel
  UCutXw1q-cPB2UbNLnnBMwpw. Existing credentials stay local, never in source.
- Daily production remains 09:00 KST in a detached Codex project automation.
  Publication checks run locally every five minutes while the Mac mini is awake.
- Scope: functions-social/approveYoutubeReel and archive-pilates-core Hosting.
  The boundary manifest adds only this export to social; its conservative shared
  manifest detector reports all groups, but other groups have no runtime changes
  and are build/validation tested, not deployed.
- Validation: in-memory gate/transaction tests, publisher and worker fixtures,
  all-codebase build/boundaries, release guards, live no-token/invalid-token checks,
  a clearly marked test approval that cannot publish, responsive screenshots,
  detached scheduler readback and LaunchAgent/no-op verification.
- Forbidden downstream uses: Alimtalk, StudioMate, Contacts, member permissions,
  payment/refund/reservation decisions, or publication from mirror/workLanes data.
- Deployment and test proof are recorded in docs/tasks/2026-10-14-reel-button-approval.md.
