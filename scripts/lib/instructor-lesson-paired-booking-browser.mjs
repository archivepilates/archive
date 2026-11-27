import { createInstructorCancellationBrowser } from "./instructor-lesson-cancellation-browser.mjs";
import { assertMemberDispatchAllowed } from "./member-dispatch-window.mjs";
import { planInstructorPairedBooking, verifyInstructorPairedBooking } from "./instructor-lesson-paired-booking.mjs";

const HOST = "https://arcpilates.studiomate.kr";
const API = "https://api.studiomate.kr";
const BOOKING_PATH = "/v2/staff/booking";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const datesIn = value => [...String(value).matchAll(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/g)]
  .map(([, y, m, d]) => [y, m.padStart(2, "0"), d.padStart(2, "0")].join("-"));
const ids = rows => rows.map(String).sort().join("|");

export function matchesPairedBookingPost(body, plan) {
  return body && Object.keys(body).sort().join("|") === "lecture_ids|user_ticket_ids"
    && Array.isArray(body.user_ticket_ids) && body.user_ticket_ids.length === 1
    && String(body.user_ticket_ids[0]) === plan.userTicketId
    && Array.isArray(body.lecture_ids) && body.lecture_ids.length === plan.missing.length
    && ids(body.lecture_ids) === ids(plan.missing.map(s => s.lectureId));
}

export function matchesApprovedDailyLimitConfirmation(message, job, plan, memberLectures) {
  return job.bookingDailyLimitAcknowledged === true && plan.sessions.length === 2 && plan.missing.length >= 1
    && memberLectures.filter(row => String(row.start_on).startsWith(plan.lessonDate + " "))
      .every(row => plan.sessions.some(session => session.lectureId === String(row.id)))
    && /^예약 가능 횟수 초과 일일 예약 가능 횟수를 초과했습니다\. 계속 하시겠습니까\? 취소\s*확인$/.test(clean(message));
}

function observeGet(page, path, query = () => true) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === API && url.pathname === path && response.request().method() === "GET" && query(url.searchParams);
  }, { timeout: 20000 }).then(async response => {
    if (!response.ok() || await response.finished()) return null;
    return response.json();
  }).catch(() => null);
}

async function readBookingEvidence(context, job) {
  const page = await context.newPage();
  try {
    const member = observeGet(page, "/members/" + job.memberId + "/lectures");
    const adapter = createInstructorCancellationBrowser(page, { includeBookingEvidence: true });
    const pass = await adapter.read(job);
    const memberLectures = await member;
    const target = pass.tickets.find(ticket => ticket.title === job.ticketName
      && ticket.availabilityStartAt === job.lessonDate && ticket.expireAt === job.lessonDate);
    if (!pass.complete || !pass.bookings?.complete || !Array.isArray(memberLectures) || !target || !target.usable
      || target.blocked || target.isShared || target.maxCoupon !== 2 || target.studioId !== job.studioId
      || target.memberId !== job.memberId || (job.ticketId && job.ticketId !== target.userTicketId)) {
      throw new Error("현재 회원의 동일 일자 강사레슨 2회권을 확인할 수 없습니다.");
    }
    return { memberLectures, ticketBookings: pass.bookings.rows, target };
  } finally {
    await page.close();
  }
}

async function readCards(column) {
  return column.locator(".lecture-item").evaluateAll(nodes => nodes.map((node, index) => {
    const value = selector => (node.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
    return { index, dateText: value(".lecture-item__date"), time: value(".lecture-item__time").slice(0, 5),
      title: value(".lecture-item__title"), staff: value(".lecture-item__instructor").replace(/\s*강사\s*$/, ""),
      full: node.classList.contains("full") };
  }));
}

function matchesCard(card, session, lessonDate) {
  return datesIn(card.dateText)[0] === lessonDate && card.time === session.time
    && clean(card.title) === session.title && clean(card.staff) === session.staff;
}

export async function bookInstructorLessonPair(context, job, { checkpoint }) {
  const identity = { ...job, memberId: String(job.studiomateMemberId || ""), ticketId: String(job.ticketId || "") };
  const initial = await readBookingEvidence(context, identity);
  const options = { lessonDate: job.lessonDate, memberId: identity.memberId, userTicketId: initial.target.userTicketId,
    ticketBookings: initial.ticketBookings, memberLectures: initial.memberLectures, usableCoupons: initial.target.usableCoupons };
  if (initial.ticketBookings.filter(row => row.status === "reserved").length === 2) {
    const plan = planInstructorPairedBooking({ ...options, lectures: initial.memberLectures
      .filter(row => String(row.start_on).startsWith(job.lessonDate + " "))
      .map(row => ({ ...row, staff: row.instructor })) });
    return verifyInstructorPairedBooking(plan, initial.ticketBookings, initial.memberLectures);
  }

  const page = await context.newPage();
  let plan, dispatchAttempted = false, armed = false;
  try {
    // The member wizard supplies the only allowed write; no direct booking API or override.
    await page.route("**/*", async route => {
      const request = route.request();
      if (safeMethods.has(request.method())) return route.continue();
      if (!armed || dispatchAttempted || request.method() !== "POST" || request.url() !== API + BOOKING_PATH) {
        return route.abort("blockedbyclient");
      }
      try {
        assertMemberDispatchAllowed();
        if (Date.now() >= plan.sessions[0].start || !matchesPairedBookingPost(request.postDataJSON(), plan)) {
          return route.abort("blockedbyclient");
        }
      } catch { return route.abort("blockedbyclient"); }
      dispatchAttempted = true;
      return route.continue();
    });
    const source = observeGet(page, "/v2/staff/lectures", params =>
      params.get("start_date") === job.lessonDate && params.get("end_date") === job.lessonDate
      && params.get("course_type") === "G" && !!params.get("division_id")
      && (params.get("with") || "").split(";").includes("bookings.member"));
    await page.goto(HOST + "/users/" + identity.memberId + "/bulk_bookings", { waitUntil: "domcontentloaded" });
    const wizard = page.locator(".bulk-bookings");
    await page.getByRole("heading", { name: "수업 일괄 예약하기", exact: true }).waitFor();
    const choice = wizard.locator(".select-ticket__item").filter({ has: page.getByRole("heading", { name: job.ticketName, exact: true }) });
    await choice.first().waitFor();
    const texts = await choice.allTextContents();
    const matched = texts.flatMap((value, index) => {
      const [from, to] = datesIn(value);
      return from === job.lessonDate && to === job.lessonDate ? [index] : [];
    });
    if (matched.length !== 1) throw new Error("일괄 예약 화면에서 확인된 2회권을 선택할 수 없습니다.");
    const exactTicket = choice.nth(matched[0]);
    if (!(await exactTicket.getByRole("img", { name: "check-icon", exact: true }).count())) await exactTicket.click();
    const lectures = await source;
    if (!Array.isArray(lectures)) throw new Error("선택한 수강일의 StudioMate 일정 응답을 확인하지 못했습니다.");
    plan = planInstructorPairedBooking({ ...options, lectures });
    const columns = wizard.locator(".lecture-list__list__column");
    await columns.nth(1).waitFor();
    if (await columns.count() !== 2) throw new Error("StudioMate 일괄 예약 화면이 변경되었습니다.");
    for (const session of plan.missing) {
      const matches = (await readCards(columns.first())).filter(card => matchesCard(card, session, plan.lessonDate));
      if (matches.length !== 1 || matches[0].full) throw new Error("원본 세션과 화면의 잔여석이 일치하지 않습니다.");
      await columns.first().locator(".lecture-item").nth(matches[0].index).click();
    }
    const selected = await readCards(columns.nth(1));
    const range = await wizard.locator(".el-range-input").evaluateAll(nodes => nodes.map(node => node.value));
    if (range.length !== 2 || range.some(value => datesIn(value)[0] !== job.lessonDate)
      || selected.length !== plan.missing.length || plan.missing.some(session =>
        selected.filter(card => matchesCard(card, session, plan.lessonDate)).length !== 1)) {
      throw new Error("예약 직전 확인에서 수강일이나 선택 수업이 달라졌습니다.");
    }
    assertMemberDispatchAllowed();
    if (Date.now() >= plan.sessions[0].start) throw new Error("이미 시작된 강사레슨은 자동 확정할 수 없습니다.");
    await checkpoint(plan);
    const response = page.waitForResponse(r => r.url() === API + BOOKING_PATH && r.request().method() === "POST",
      { timeout: 30000 }).catch(() => null);
    const box = page.locator(".el-message-box:visible");
    const warning = box.first().waitFor({ timeout: 30000 }).then(() => "warning").catch(() => null);
    armed = true;
    await page.getByRole("button", { name: "수업 예약 완료", exact: true }).click();
    if (await Promise.race([response, warning]) === "warning" && !dispatchAttempted) {
      if (await box.count() !== 1 || !matchesApprovedDailyLimitConfirmation(await box.innerText(), job, plan, initial.memberLectures)) {
        throw new Error("StudioMate 일일 예약 제한 또는 다른 경고로 예약을 제출하지 않았습니다.");
      }
      assertMemberDispatchAllowed();
      await box.getByRole("button", { name: "확인", exact: true }).click();
    }
    await response;
    if (!dispatchAttempted) throw new Error("StudioMate 예약 제한 또는 양식이 변경되어 제출하지 않았습니다.");
  } finally {
    armed = false;
    await page.close();
  }
  // Wait for the original response or timeout, then read both independent member and ticket surfaces.
  const current = await readBookingEvidence(context, { ...identity, ticketId: plan.userTicketId });
  return verifyInstructorPairedBooking(plan, current.ticketBookings, current.memberLectures);
}
