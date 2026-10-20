# Staff Grade Video Linking

- Approval: operator approved implementation and deployment on 2026-10-20.
- Source: origin/main; lane codex/mini/imweb-staff-video-sync-20261020.
- Scope: native Imweb staff grade to current/future canonical video groups; preserve baseline access and valid purchases, own only newly added groups.
- Runtime: Mac mini LaunchAgent every 300 seconds, official Imweb default profile, shared member-group lock and private ownership ledger.
- Exit: remove only worker-owned memberships after complete order scan and a fresh purchase check; ambiguity or unknown write result blocks removal.
- E-team: defer its original expiry while native staff grade is active, without extending its forty-day grant.
- Unchanged: discounts, products, prices, other member data, admin roles, page ACLs and video assets.
- Verification: policy/IO/E-team tests; complete live read-only scan; limited apply; independent member and group readbacks; idempotent replay; installed service check; CORE one-file release.
- Limit: 50 memberships per update; canonical video catalog maximum 48; no CLI quota override. Unavailable or uncertain sources fail closed.
- UI: ordinary-member classroom/playback requires a separate authorized test session. Do not impersonate staff or reset passwords.
- Local ledger and logs contain restricted operational identity data; keep outside Git with private permissions.

## Release Result

- Implemented and live: commits 57648001 and 82588dd9 promoted to origin/main and integrated runtime.
- Native readback: both staff have 42 video groups plus STAFF; original memberships preserved; all 43 group lists independently checked.
- Full source checks: 123 members and 207 unique canonical orders; replay added/removed zero groups.
- Worker: LaunchAgent installed at 300 seconds; verified successful background run at 2026-10-20T08:12:11.895Z, exit code 0.
- CORE: only the staff note released in Hosting version e0513d3fc0d0fa5e; 170 other files and configuration preserved; response hash verified.
- Checks: 92 focused tests, plist syntax, diff checks and GitHub Actions run 39391570049 succeeded.
- Pending: actual ordinary-member classroom/playback verification needs an authorized separate session. No member impersonation or password changes.
- Detailed outcome: docs/reports/2026-10-20-imweb-staff-video-sync.html.
