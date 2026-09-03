# GCP Cost Optimization Decision

- Date: 2026-08-03
- Owner: ARCHIVE PILATES
- Project: `archive-pilates`, `gen-lang-client-0876433128`

## Decision

1. Firebase Data Connect and its Cloud SQL instances are not part of the active ARCHIVE PILATES architecture.
2. Empty Data Connect databases may be removed only after schema, service metadata, and SQL exports are stored in dedicated backup buckets.
3. ARCHIVE PILATES Careers runs on Cloud Run with minimum instances set to zero and request-based CPU allocation.
4. Scheduled Firestore work must query only due records. Full-collection polling is not an accepted default.
5. A private lesson report stays in `waiting_post` until the instructor submits the post-lesson record.
6. Unused Scheduler exports and unused Secret Manager entries are removed after source and production reference checks.
7. Detailed Cloud Billing export uses `archive-pilates.archive_billing_export` for monthly service and SKU review.

## Rollback

- Data Connect metadata and empty SQL exports are stored in the two dated backup bucket paths.
- The former Careers Cloud Run revision remains available until the replacement revision passes live checks.
- Function schedule changes can be reverted from Git history and redeployed by codebase.

## Verification

- Confirm both Cloud SQL instance lists are empty.
- Confirm both Data Connect service GET requests return not found.
- Confirm CORE, ARCHIVE IN, Careers, and Apply live routes return HTTP 200.
- Confirm the Careers latest ready revision uses request-based CPU allocation.
- Confirm the changed Firebase scheduler jobs and Firestore migration counts after deployment.
