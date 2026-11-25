# Help member roster rollout

## Source and isolation

- The existing StudioMate member capture verifies the captured total, pages,
  duplicate native members and issued cards, active/held/future dates and
  available counts. No StudioMate writes or additional schedule.
- The periodic hook is disabled by default. Only an existing successful
  scheduled full import with a verified member export digest and private
  reviewed product map may call the roster writer. Manual sync, notification
  refresh, partial pages or failed imports cannot replace the generation.
- Contact HMAC and member HMAC are deliberately separate. No phone, name,
  native member ID, reservation, or payment is stored in the roster schema.
  Scheduled projections cannot grant contact approval. A separate
  authorized action must bind verified signup/registered-contact evidence.
  Observed duplicate numbers are excluded. A changed number removes access
  to the old one, and it is not auto-approved or reassigned.
- Roster SQL replaces contact and pass data in one transaction. It retains the
  existing pilot tables independently. Session consumption locks the current
  binding revision and the API rechecks it on every read. No browser may
  specify a member, and no broad Supabase Data API grants are used.

## Release gates

1. Complete the two-account operational test on the still-restricted pilot
   URL. Each phone owner requests and uses their own code; no codes, names,
   phone numbers, session values, or balances go into the report. Do not
   replay a provider request if receipt or delivery is uncertain.
2. A single test-only exemption may carry over the original pilot's full
   rolling budget for this specific two-account drill. It is tied to the
   original pilot subject, one durable claim, and an expiring time window.
   It is never enabled in public roster mode.
3. Before enabling the existing scheduled hook for general use, confirm the
   approved StudioMate signup/registered-contact coverage and reviewed
   product classifications. Produce a fresh read-only full plan and then
   verify stored counts, approvals, and an actual scheduled refresh. If the
   source is empty, stale or partial, control fails closed. A positive
   browser smoke test alone is not a release.
4. Enable the public UI only after scope and operating rules are verified.
   Until then, the ordinary Help page continues to direct users to the
   member app. The function's prior pilot mode is preserved for rollback.

## Current evidence

- The 2026-11-26 read-only capture reconciled 22 pages and 1,067 members.
  It identified 201 class-card candidates for 177 holders. Catalog review
  and verified enrollment coverage are still separate from those counts.
- The separate roster migration is applied in Seoul. The two authorized
  test subjects' observations were matched against list and native detail;
  the roster writer confirmed exactly two cards and two subjects. No
  external dispatch was done by the import.
- The branch supports a two-subject live test with public roster mode and
  automatic publication still disabled. The synthetic PostgreSQL test
  authenticates two subjects, checks independent card values, cookie swaps,
  stale/changed contact, revocation and the single-use budget exception.
