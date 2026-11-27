const fail = message => { throw new Error(message); };
const id = value => /^[1-9]\d{0,15}$/.test(String(value ?? "")) ? String(value) : "";
const text = value => String(value || "").replace(/\s+/g, " ").trim();
const titlePattern = /^(?:[1-9]|1[0-2])월 강사\s*레슨\s+([A-Z])(?:\s*반)?$/;
const localTime = value => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || "")
  ? Date.parse(value.replace(" ", "T") + "+09:00") : NaN;
const isLesson = row => /강사\s*레슨/.test(text(row?.title));

export function planInstructorPairedBooking({ lessonDate, memberId, userTicketId, lectures, ticketBookings,
  memberLectures, usableCoupons, now = Date.now() }) {
  if (!id(memberId) || !id(userTicketId) || !Array.isArray(lectures) || !Array.isArray(ticketBookings)
    || !Array.isArray(memberLectures) || !Number.isSafeInteger(usableCoupons) || usableCoupons < 0) {
    fail("StudioMate 일정·예약·수강권 원본이 불완전합니다.");
  }
  const groups = new Map(), all = new Map();
  for (const row of lectures.filter(isLesson)) {
    const group = titlePattern.exec(text(row.title))?.[1];
    const lectureId = id(row.id), staff = text(row.staff?.name);
    const start = localTime(row.start_on), end = localTime(row.end_on);
    if (!group || !lectureId || all.has(lectureId) || !staff || row.type !== "G" || row.deleted_at
      || !row.start_on?.startsWith(lessonDate + " ") || !row.end_on?.startsWith(lessonDate + " ")
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isSafeInteger(row.max_trainee)
      || row.max_trainee < 1 || !Number.isSafeInteger(row.current_trainee_count) || row.current_trainee_count < 0) {
      fail("정규 강사레슨 반·수업시간·원본 정원을 확인할 수 없습니다.");
    }
    const session = { lectureId, title: text(row.title), group, staff, start, end, time: row.start_on.slice(11, 16),
      remaining: row.max_trainee - row.current_trainee_count };
    groups.set(group, [...(groups.get(group) || []), session]);
    all.set(lectureId, session);
  }
  if (!groups.size) fail("해당 날짜의 정규 강사레슨 일정이 없습니다.");
  const pairs = [...groups].map(([group, sessions]) => {
    sessions.sort((a, b) => a.start - b.start);
    if (sessions.length !== 2 || sessions[0].end > sessions[1].start || sessions[0].staff === sessions[1].staff) {
      fail("같은 반의 서로 다른 두 세션이 확인되지 않았습니다.");
    }
    return { group, sessions };
  });
  // Parallel rooms must be alternatives for the same two slots, not separate courses.
  if (new Set(pairs.map(p => p.sessions.map(s => s.start).join("|"))).size !== 1) {
    fail("반별 수업시간 조합이 일치하지 않습니다.");
  }
  const existing = new Set(), bookingIds = new Set();
  for (const booking of ticketBookings) {
    if (booking.status === "cancelled") continue;
    if (booking.status !== "reserved" || booking.date !== lessonDate || !all.has(booking.lectureId)
      || !id(booking.key) || existing.has(booking.lectureId) || bookingIds.has(booking.key)) {
      fail("기존 예약·대기·출석이 자동 반배정과 충돌합니다.");
    }
    existing.add(booking.lectureId);
    bookingIds.add(booking.key);
  }
  const memberLessonIds = memberLectures.filter(row => isLesson(row) && String(row.start_on || "").startsWith(lessonDate + " "))
    .map(row => id(row.id));
  if (memberLessonIds.length !== existing.size || new Set(memberLessonIds).size !== existing.size
    || memberLessonIds.some(lectureId => !existing.has(lectureId))) fail("회원 전체 수업과 발급권별 예약이 일치하지 않습니다.");

  const eligible = pairs.filter(p => [...existing].every(lectureId => p.sessions.some(s => s.lectureId === lectureId)))
    .map(p => ({ ...p, missing: p.sessions.filter(s => !existing.has(s.lectureId)) }))
    .filter(p => !p.missing.length || (p.sessions[0].start > now && p.missing.length <= usableCoupons
      && p.missing.every(s => s.remaining > 0)));
  const bottleneck = pair => pair.missing.length ? Math.min(...pair.missing.map(s => s.remaining)) : Infinity;
  eligible.sort((a, b) => bottleneck(b) - bottleneck(a) || a.group.localeCompare(b.group));
  const selected = eligible[0];
  if (!selected) fail("시작 전 같은 반 두 세션의 잔여석 또는 사용 가능한 수강권이 부족합니다.");
  return { lessonDate, memberId: id(memberId), userTicketId: id(userTicketId), ...selected,
    existingBookingIds: [...bookingIds].sort() };
}

export function verifyInstructorPairedBooking(plan, ticketBookings, memberLectures) {
  const active = ticketBookings.filter(booking => booking.status !== "cancelled");
  const expected = plan.sessions.map(s => s.lectureId).sort();
  const actual = active.map(row => row.lectureId).sort();
  const actualMember = memberLectures.filter(row => isLesson(row) && String(row.start_on || "").startsWith(plan.lessonDate + " "))
    .map(row => id(row.id)).sort();
  if (expected.join("|") !== actual.join("|") || expected.join("|") !== actualMember.join("|")
    || active.some(row => row.status !== "reserved" || row.date !== plan.lessonDate || !id(row.key))
    || new Set(active.map(row => row.key)).size !== 2 || plan.existingBookingIds.some(key => !active.some(row => row.key === key))) {
    fail("StudioMate 두 세션 예약을 독립 확인하지 못했습니다. 재요청하지 마세요.");
  }
  return { status: "verified", lessonDate: plan.lessonDate, memberId: plan.memberId, userTicketId: plan.userTicketId,
    group: plan.group, lectureIds: expected, bookingIds: active.map(row => row.key).sort() };
}
