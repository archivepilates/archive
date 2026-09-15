# Two-sided referral rewards

- Requested: inviter and newly referred friend receive KRW 3,000 each; inviter KST monthly cap remains KRW 30,000. No phone authentication or purchase prerequisite.
- Source: canonical Imweb site/unit member records and native point logs, never browser input or CORE mirrors.
- Compatibility: retain original inviter table, provider reason, activation time and budget. New invitee table in the same private SQLite file; explicit inviteeStartsAt and inviteeTested gates, no historical backfill.
- Each side has its own durable claim, provider reason and exact recipient proof. Uncertain attempts reconcile only. Cross-role attribution is bound; old-month incomplete pairs require operator review.
- Inviter cap does not limit one-time invitee rewards. Eleven eligible referrals can issue KRW 63,000 in total (30,000 inviter + 33,000 invitees).
- Public widget copy and CORE operating rules updated. Classroom, orders, member groups and native campaign are outside the write scope.
- Validation: 157 offline tests (120 existing, 35 two-sided, 2 runner) passed; CORE Hosting and live rollback source guards passed. Read-only production scan: 83 members/2 pages, one excluded test pair, no eligible historical awards. Native paid campaign absent in home-profile admin UI.
- Controlled real two-member credit/reversal requested separately; no new test money issued yet.
- Deployed commit `8874556127aefd3089ea2f51c4ffbc4f43dae926` to `archive-pilates-core` Hosting only; pushed feature branch and promoted origin/main. Runtime fast-forwarded cleanly.
- Invitee activation `2026-09-15T14:40:01.009Z` (23:40 KST). Original inviter cutoff and three exclusions preserved; private config backed up. First dual-role apply finished successfully at `2026-09-15T14:40:11.826Z`, one excluded pair per role, zero payouts/failures/holds. No historical customer award was made.
- Existing Imweb loader left byte-for-byte untouched: its old query URL now serves the new asset, HTTP 200, max-age=0/must-revalidate, exact local SHA-256 match. Public popup independently showed the new two-sided copy.
- Live UI: 320/390/768/1440px screenshots and DOM widths, no horizontal overflow; participation disclosure opens/closes, CTA 48px; dialog dismiss succeeds. Task-owned tabs closed and viewport reset.
- CORE rules deployed, native paid campaign remains absent. LaunchAgent still points at canonical runtime with 300-second interval and last exit 0. CI completion tracked separately.
