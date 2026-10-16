import { createHash } from "node:crypto";
import { normalizeUserTicket } from "./studiomate-native-contract-source.mjs";

const HOST = "https://arcpilates.studiomate.kr";
const API = "https://api.studiomate.kr";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const date = value => String(value || "").slice(0, 10);
const phone = value => String(value || "").replace(/\D/g, "");
const nativeId = value => /^[1-9]\d{0,15}$/.test(String(value || ""));

export function normalizeCancellationBookingResponse(body, job, userTicketId) {
  const bookings = body?.bookings;
  if (!bookings || !Array.isArray(bookings.data) || !Number.isInteger(bookings.total)
    || bookings.current_page !== 1 || bookings.last_page !== 1 || bookings.total !== bookings.data.length) {
    throw new Error("예약 전체 목록을 확인하지 못했습니다. 자동 취소하지 않습니다.");
  }
  const statuses = { booked: "reserved", booking_waiting: "waiting", wait_cancel: "cancelled", waiting: "waiting", wait: "waiting", cancel: "cancelled",
    canceled: "cancelled", cancelled: "cancelled", attended: "attended", attendance: "attended",
    absent: "absent", noshow: "noshow", no_show: "noshow" };
  const rows = bookings.data.map(row => {
    if (!nativeId(row.id) || String(row.user_ticket_id) !== userTicketId || String(row.member?.id) !== job.memberId
      || String(row.studio_id) !== job.studioId || String(row.lecture?.studio_id) !== job.studioId
      || !nativeId(row.lecture_id) || !statuses[row.status] || row.deleted_at) {
      throw new Error("수강권·회원·수업 예약 연결을 확인하지 못했습니다.");
    }
    const start = String(row.lecture.start_on || "");
    return { key: String(row.id), date: date(start), startTime: start.slice(11, 16),
      status: statuses[row.status], title: String(row.lecture.title || ""), staff: String(row.lecture.instructor?.name || "") };
  });
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw new Error("중복 예약 ID 확인 필요");
  return { complete: true, total: bookings.total, rows };
}

// Only UI-generated GET responses supply identities. The adapter never calls a private API directly.
export function createInstructorCancellationBrowser(page) {
  let armed = null;
  let posted = false;
  const routeHandler = async route => {
    const req = route.request();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method())) return route.continue();
    let data;
    try { data = req.postDataJSON(); } catch { return route.abort("blockedbyclient"); }
    if (!armed || posted || req.method() !== "POST"
      || req.url() !== `${API}/v2/staff/userTickets/active-toggle/${armed.userTicketId}`
      || Object.keys(data || {}).length !== 1 || data.reason !== armed.reason) return route.abort("blockedbyclient");
    // active-toggle is not idempotent: never allow a second request, including application retries.
    posted = true;
    return route.continue();
  };
  let installed = false;
  async function install() {
    if (installed) return;
    await page.route("**/*", routeHandler); installed = true;
  }
  function responseFor(pathname, query = () => true) {
    return page.waitForResponse(response => {
      const u = new URL(response.url());
      return u.origin === API && u.pathname === pathname && query(u.searchParams)
        && response.request().method() === "GET";
    }, { timeout: 20000 });
  }
  async function body(response) {
    if (!response.ok() || await response.finished()) throw new Error("StudioMate 원본 읽기 실패");
    return response.json();
  }
  async function read(job) {
    await install();
    const listResponse = responseFor("/v2/staff/userTickets", q => q.get("member_id") === job.memberId && ["true", "1"].includes(q.get("is_all")));
    const listPending = listResponse.catch(error => ({ error }));
    await page.goto(`${HOST}/users/detail?id=${job.memberId}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const response = await listPending;
    if (response.error) throw response.error;
    const rawTickets = await body(response);
    if (!Array.isArray(rawTickets)) throw new Error("전체 수강권 원본 형식 확인 필요");
    const header = page.locator(".member-detail__header");
    await header.waitFor({ state: "visible", timeout: 20000 });
    const headerText = await header.innerText();
    if (new URL(page.url()).origin !== HOST || new URL(page.url()).searchParams.get("id") !== job.memberId
      || (await header.getByRole("heading", { name: job.memberName, exact: true }).count()) !== 1
      || !phone(headerText).includes(job.memberPhone)) throw new Error("StudioMate 화면 회원 정확 일치 확인 필요");
    const tickets = rawTickets.map(raw => {
      const t = normalizeUserTicket(raw, job.memberId);
      if (!t) throw new Error("수강권 고유 ID·회원 연결 원본 확인 필요");
      return { userTicketId: t.userTicketId, productId: t.productId, memberId: t.memberId, studioId: t.studioId,
        title: t.title, availabilityStartAt: t.availabilityStartAt, expireAt: t.expireAt, usable: t.usable && t.active,
        isShared: t.isShared, maxCoupon: t.maxCoupon, remainingCoupon: t.remainingCoupon,
        paymentFingerprint: hash(raw.payments || []) };
    });
    const targets = tickets.filter(t => t.title === job.ticketName && t.availabilityStartAt === job.lessonDate && t.expireAt === job.lessonDate);
    if (targets.length !== 1) throw new Error("해당일 강사레슨 수강권이 정확히 1개여야 합니다.");
    const target = targets[0];
    if (!target.usable) {
      const previous = page.getByRole("button", { name: "이전 수강권 보기", exact: true });
      await previous.click();
    }
    const compactDate = job.lessonDate.replaceAll("-", ".");
    let cards = page.locator(target.usable
      ? ".member-basic__user-tickets .userticket-card"
      : ".ticket-expired-modal__product-list .userticket-card").filter({
      has: page.getByRole("heading", { name: job.ticketName, exact: true }),
    });
    // Archived cards omit dates; the UI detail response below must match the exact issued ID.
    if (target.usable) cards = cards.filter({ hasText: compactDate });
    await cards.first().waitFor({ state: "visible", timeout: 20000 });
    if (await cards.count() !== 1) throw new Error("수강일에 연결된 화면 수강권이 중복되거나 없습니다.");
    const detailResponse = responseFor(`/v2/staff/userTickets/${target.userTicketId}`).catch(error => ({ error }));
    const bookingsResponse = responseFor(`/v2/staff/userTickets/reserve-list/${target.userTicketId}/booking`).catch(error => ({ error }));
    await cards.locator(".userticket-card__click-listener").click();
    const detail = await detailResponse;
    const bookings = await bookingsResponse;
    if (detail.error || bookings.error) throw new Error("화면 수강권과 예약 원본 응답 확인 필요");
    const rawDetail = await body(detail);
    const detailRow = rawDetail?.data || rawDetail;
    if (String(detailRow.id) !== target.userTicketId || String(detailRow.member?.id) !== job.memberId
      || String(detailRow.studio_id) !== job.studioId) throw new Error("선택된 화면의 발급 수강권 ID가 다릅니다.");
    const normalizedBookings = normalizeCancellationBookingResponse(await body(bookings), job, target.userTicketId);
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `${job.memberName}님의 수강권`, exact: true }) });
    await dialog.waitFor({ state: "visible" });
    await dialog.locator(".booking-history__tabs").getByRole("listitem").filter({ hasText: new RegExp(`^\\s*전체\\(${normalizedBookings.total}\\)\\s*$`) }).waitFor();
    if ((await dialog.locator(".booking-history__list .booking").count()) !== normalizedBookings.total) {
      throw new Error("화면과 전체 예약 원본의 건수가 다릅니다.");
    }
    if (await dialog.getByRole("heading", { name: job.ticketName, exact: true }).count() !== 1) throw new Error("수강권 화면 종류 확인 필요");
    return { complete: true, member: { memberId: job.memberId, name: job.memberName, phone: job.memberPhone, studioId: job.studioId },
      tickets, bookings: normalizedBookings };
  }
  async function disable(job, plan, checkpoint) {
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `${job.memberName}님의 수강권`, exact: true }) });
    await dialog.getByRole("button", { name: "사용불가 처리", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "사용불가 처리", exact: true });
    await confirmation.waitFor({ state: "visible" });
    if (!(await confirmation.innerText()).includes("예약되어 있는 수업은 자동으로 취소됩니다.")) throw new Error("수강권 사용불가·예약 취소 확인 양식이 변경됐습니다.");
    const reason = "강사레슨 수강 취소";
    await confirmation.getByRole("textbox").fill(reason);
    await checkpoint();
    armed = { userTicketId: plan.userTicketId, reason };
    const accepted = page.waitForResponse(r => r.url() === `${API}/v2/staff/userTickets/active-toggle/${plan.userTicketId}`
      && r.request().method() === "POST", { timeout: 20000 }).catch(error => ({ error }));
    try {
      await confirmation.getByRole("button", { name: "확인", exact: true }).click();
      const response = await accepted;
      if (response.error || !response.ok() || await response.finished()) throw new Error("취소 접수 결과 불명확: 자동 재시도 금지");
      return { accepted: true, postCount: posted ? 1 : 0 };
    } finally { armed = null; }
  }
  return { read, disable };
}
