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
  Center policy: a completed StudioMate member registration is the
  in-person identity check. Do not require a duplicate staff attestation
  or a StudioMate app account. Use the native registration time and an
  explicit non-inactive status, plus a unique current registered phone.
  Help still requires its own user-initiated Alimtalk code to verify
  possession before any private pass data is shown.
- The dedicated enrollment writer can now atomically bind a previously
  unseen member and phone pair and publish the card projection, using a
  whole native membership capture. The ordinary pass writer, API runtime,
  and client roles cannot use this command. No browser makes these writes.
  Observed duplicate numbers are excluded even with inactive matches.
  Removed, changed and ambiguous contacts retire their old bindings;
  neither a previously approved member nor a used number is automatically
  re-enrolled on a different binding.
- Roster SQL replaces contact and pass data in one transaction. It retains the
  existing pilot tables independently. Session consumption locks the current
  binding revision and the API rechecks it on every read. No browser may
  specify a member, and no broad Supabase Data API grants are used.

## Release gates

1. On 2026-11-27, the operator instructed release preparation to continue
   without the two-phone manual verification. Mark it waived, not passed.
   Keep the synthetic two-account OTP and isolation tests, server-side
   canary gating and live anonymous denial as independent release checks.
   No real send or delivery has been verified for that two-account drill.
2. A single test-only exemption may carry over the original pilot's full
   rolling budget for this specific two-account drill. It is tied to the
   original pilot subject, one durable claim, and an expiring time window.
   It is never enabled in public roster mode.
3. Before enabling the existing scheduled hook, deploy the API with
   server-side canary confinement (or leave the member API disabled).
   A pilot-only button is not a server access boundary. Confirm
   native active registration and unique current-contact coverage, and
   review product classifications. Produce a fresh read-only full plan,
   then verify the separately staged enrollments and an actual scheduled
   refresh. If the source is empty, stale or partial, control fails closed.
   A positive browser smoke test alone is not a release.
4. Enable the public UI only after scope and operating rules are verified.
   Until then, the ordinary Help page continues to direct users to the
   member app. The function's prior pilot mode is preserved for rollback.

## Current evidence

- On 2026-11-27, the native catalog yielded 31 product IDs. Excluded the
  instructor course and group trial; included the six-class starter group
  pass without its separate OT. The fresh read-only plan found 157 eligible
  members and no unclassified products after adopting this scope.
- Supabase has the additive native registration routine. Its owner/execute
  grants and the unchanged two-row canary generation were independently
  checked. The operational reader and the hourly flag are not enabled for
  the expanded roster. No production data was enrolled or sent by the plan.

- At 21:49 KST, all 22 native member pages were rechecked. There were 239
  active registrations; all 176 current class-pass candidate holders met
  the native active registration and unique current contact gate.
  Product and production enrollment checks remain separate.

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
