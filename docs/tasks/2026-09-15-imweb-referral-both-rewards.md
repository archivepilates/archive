# Two-sided referral rewards

- Requested: inviter and newly referred friend receive KRW 3,000 each; inviter KST monthly cap remains KRW 30,000. No phone authentication or purchase prerequisite.
- Source: canonical Imweb site/unit member records and native point logs, never browser input or CORE mirrors.
- Compatibility: retain original inviter table, provider reason, activation time and budget. New invitee table in the same private SQLite file; explicit inviteeStartsAt and inviteeTested gates, no historical backfill.
- Each side has its own durable claim, provider reason and exact recipient proof. Uncertain attempts reconcile only. Cross-role attribution is bound; old-month incomplete pairs require operator review.
- Inviter cap does not limit one-time invitee rewards. Eleven eligible referrals can issue KRW 63,000 in total (30,000 inviter + 33,000 invitees).
- Public widget copy and CORE operating rules updated. Classroom, orders, member groups and native campaign are outside the write scope.
- Validation: 157 offline tests (120 existing, 35 two-sided, 2 runner) passed; CORE Hosting and live rollback source guards passed. Read-only production scan: 83 members/2 pages, one excluded test pair, no eligible historical awards. Native paid campaign absent in home-profile admin UI.
- Controlled real two-member credit/reversal requested separately; no new test money issued yet.
- Deployment/runtime activation pending. Keep native paid campaign disabled to prevent duplicate awards.
