# October 17 instructor lesson seat count

- Purpose: correct CORE read-only instructor lesson occupancy against StudioMate.
- Source: October 17 StudioMate lecture detail IDs 97134045 and 97134052; each has capacity 5 and the same five reserved members.
- Cause: dashboard queried only 강사레슨 (2T), excluding Team 강사레슨. Reservation Excel supplied null group capacity, invoking default capacity 10.
- Implementation: query both exact ticket names for dashboard bookings only; retain existing 2T issuance and ticket-holder precedence.
- Canonical source: existing lectures and bookings. No member360/workLanes selection.
- Capacity evidence: lectures/{existingId}.capacityEvidence, containing native ID/source URL, captured timestamp, capacity, and exact studio/date/start/end/title/staff/room identity. Use only when current lecture identity matches; otherwise use existing capacity/default.
- Duplicate policy: retain canonical booking priority and unique member/date counting; sequential capacities use max, concurrent rooms sum.
- Allowed reader: instructor lesson schedule dashboard. Forbidden: pass issuance, reservation mutation, message recipient selection, or payment decisions.
- Data apply scope: native capacity evidence on two confirmed October 17 lecture documents only. Excel merge writes preserve the separate evidence field, including when capacity becomes null.
- Verification: registration regression 45/45 passed; independent summary/roster 34/34 passed; release/Hosting/rollback guards and functions-app TypeScript build passed. Actual canonical query returned ten Team reservations for five unique members, capacity 5, remaining 0.
- Data applied: exact-identity transaction verified both native-to-local lecture matches and wrote capacityEvidence only; independent readback passed.
- Deployment completed: source e6aeee9845a17fef488fba10f9fe7a7c14b4f87f; only functions-app:getInstructorLessonRegistrationDashboard and Hosting archive-pilates/archive-pilates-core. Function ACTIVE, revision getinstructorlessonregistrationdashboard-00021-lat. CORE release canary passed on both domains/paths; GitHub run 38103409145 succeeded.
- Live verification: authenticated existing owner session, no added claims or permission changes; dashboard callable and real UI at 320/390/768/1440px all showed five occupied, capacity five, zero remaining, closed. Task-owned browser contexts/tabs closed.
- Full codebase builds, function-boundary and canonical-source guards passed. Importer was inspected for merge:true and no capacityEvidence field; a production Excel import was not manually re-run. Stable preservation is covered by null-capacity regression and source inspection, not a live import replay.
- Separate observation, not changed: the two October 17 instructor lesson native cancellation times were 07:30 and 08:30 on the class day, rather than prior-day 21:00.
- No StudioMate, pass, booking, payment, or Alimtalk writes.
