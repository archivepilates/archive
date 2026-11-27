# Archive Help: authenticated next-class recommendations

## Flow

Keep the existing registered-mobile StudioMate OTP, conversation binding, and
short per-request SQL grant. After a member checks their pass, show “수강 이력”
and “수업 추천” in chat. Use the last 28 calendar dates of verified StudioMate
attendance by lesson category, the last attendance date, active pass dates, and
the remaining vs. additionally bookable count. Recommend a steady weekly pace
and up to two published future group slots within the pass period and bookable
amount (never verified seats or a booking). For private, duet, or triple, give
pace but no public group slot. Without a confirmed monthly timetable or when
the selected time has no matching slot, link the member app. A feed failure or
uncatalogued attendance is unavailable, not zero. The public GPT path is off
inside the authenticated chat; private replies are DOM-only and expire/reset.
For an unclear public or authenticated turn, show explicit clickable “수업 시간”,
“수강료”, and “운동 계획” with the requested clarification text.

## Data and release boundaries

The member service exposes a same-origin POST overview with no member selectors.
Use only the verified roster's current OTP grant and generation. The additional
SQL stores hashed subjects, category totals and the most recent date in a
non-public RLS table; no name, phone, booking ID, class title, payment, or row
history is exposed. The member can only read their roster-bound summary.
A replacement pass generation without a corresponding summary automatically
removes the previous summary. The optional scheduled collector reuses the
operator's existing StudioMate reservation-export reader, checks complete pages
and native IDs/studio scope, and joins to the existing reviewed ticket catalog.
Transfer data inside an operator-owned temporary directory; the parent removes
it after the scheduled import, and it is never added to generated source reports.

Not production-approved or applied. After explicit approval, apply
`services/archivepilates-mcp/sql/help-member-roster-recent-attendance.sql` to the
verified Help member roster database using the established owner migration
workflow (not the historical analytics project). Deploy the Help member runtime,
the public intent function and the Help Hosting site only, from reviewed main.
Check production unauthenticated denial without requesting any OTP. Before
enabling the scheduled-only, private mode-0600 `help-member-attendance-sync.json`
state flag (policy `recent_attendance_v1`),
verify the reservation response scope/pagination and catalog coverage using
the existing authorized operator source and aggregate-only output; don't use a
real customer's OTP for testing. Check the first naturally scheduled generation
and that the rollback (disable attendance flag) preserves the pass sync. Do not
enable a new scheduler, send a message to StudioMate or manually replay a sync.
