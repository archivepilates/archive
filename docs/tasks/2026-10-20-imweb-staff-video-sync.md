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
