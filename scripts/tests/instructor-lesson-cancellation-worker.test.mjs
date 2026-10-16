import assert from "node:assert/strict";
import test from "node:test";
import { runInstructorCancellationJob, processInstructorLessonCancellations } from "../lib/instructor-lesson-cancellation-worker.mjs";
import { createInstructorCancellationBrowser, normalizeCancellationBookingResponse } from "../lib/instructor-lesson-cancellation-browser.mjs";

const instant = new Date("2026-10-16T03:00:00Z");
const job = { jobId: "ilc_test", registrationId: "ilr_test", status: "pending", studioId: "5330", memberId: "101",
  memberName: "합성 강사", memberPhone: "01012345678", profilePath: "memberProfiles/101", lessonDate: "2026-10-24",
  ticketName: "강사레슨 (2T)", expectedTicketId: "201", reason: "일정 변경", paymentRefundAllowed: false,
  requestedBy: { staffId: "operator" }, createdAt: instant };
const snapshot = () => ({ complete: true, member: { memberId: "101", studioId: "5330", name: job.memberName, phone: job.memberPhone },
  tickets: [{ userTicketId: "201", productId: "301", memberId: "101", studioId: "5330", title: job.ticketName,
    availabilityStartAt: job.lessonDate, expireAt: job.lessonDate, usable: true, isShared: false,
    maxCoupon: 2, remainingCoupon: 2, paymentFingerprint: "payment-hash" }],
  bookings: { complete: true, total: 1, rows: [{ key: "401", date: job.lessonDate, startTime: "13:00", status: "reserved", title: "강사레슨 A", staff: "합성 강사" }] } });
const after = () => { const s = snapshot(); s.tickets[0].usable = false; s.bookings.rows[0].status = "cancelled"; return s; };

function fixture(changes = {}) {
  const data = new Map([["cancel/test", { ...job, ...changes }], ["instructorLessonRegistrations/ilr_test", {
    status: "cancellation_pending", cancellation: { jobId: "test", status: "pending" },
  }], [job.profilePath, { studioId: "5330", name: job.memberName, phone: job.memberPhone }]]);
  const ref = path => ({ path, id: path.split("/").at(-1), get: async () => snap(path) });
  const snap = path => ({ ref: ref(path), exists: data.has(path), data: () => structuredClone(data.get(path)) });
  const patch = (path, update) => {
    const row = data.get(path);
    for (const [key, value] of Object.entries(update)) {
      const fields = key.split("."); let current = row;
      for (const field of fields.slice(0, -1)) current = current[field] ||= {};
      current[fields.at(-1)] = structuredClone(value);
    }
  };
  const db = { doc: ref, runTransaction: async callback => callback({ get: async r => snap(r.path), update: (r, p) => patch(r.path, p) }) };
  const admin = { firestore: { FieldValue: { serverTimestamp: () => instant }, Timestamp: { fromMillis: n => new Date(n) } } };
  let reads = 0, effects = 0;
  const notifications = [];
  const adapter = { read: async () => ++reads <= 2 ? snapshot() : after(), disable: async (_job, _plan, checkpoint) => {
    await checkpoint(); assert.equal(data.get("cancel/test").externalEffectStarted, true); effects++;
  } };
  return { data, adapter, db, admin, ref: ref("cancel/test"), now: () => instant, notify: async detail => notifications.push(detail),
    effects: () => effects, notifications };
}

test("worker checkpoints before native action and verifies twice before completed", async () => {
  const f = fixture(); const result = await runInstructorCancellationJob(f);
  assert.equal(result.status, "completed"); assert.equal(f.effects(), 1); assert.equal(f.notifications.length, 0);
  assert.equal(f.data.get("cancel/test").nativeVerified, true);
  assert.equal(f.data.get("instructorLessonRegistrations/ilr_test").status, "cancelled");
  assert.equal(f.data.get("instructorLessonRegistrations/ilr_test").cancellation.nativeVerified, true);
  await runInstructorCancellationJob(f); assert.equal(f.effects(), 1);
});

test("unknown result after checkpoint requires review and never retries the active toggle", async () => {
  const f = fixture(); const original = f.adapter.disable;
  f.adapter.disable = async (...args) => { await original(...args); throw new Error("response lost"); };
  assert.equal((await runInstructorCancellationJob(f)).status, "review_required");
  assert.equal(f.data.get("cancel/test").externalEffectStarted, true);
  assert.equal(f.data.get("instructorLessonRegistrations/ilr_test").status, "cancellation_review");
  assert.equal(f.notifications.length, 1);
  await runInstructorCancellationJob(f); assert.equal(f.effects(), 1);
});

test("changed snapshots, wrong profile, expired approval and incomplete cascade cannot succeed", async () => {
  for (const failure of ["changed", "profile", "expired", "cascade", "refund"]) {
    const f = fixture();
    if (failure === "changed") { let reads = 0; f.adapter.read = async () => { const s = snapshot(); if (++reads > 1) s.tickets[0].paymentFingerprint = "changed"; return s; }; }
    if (failure === "profile") f.data.get(job.profilePath).phone = "01099999999";
    if (failure === "expired") f.data.get("cancel/test").createdAt = new Date("2026-10-10");
    if (failure === "refund") f.data.get("cancel/test").paymentRefundAllowed = true;
    if (failure === "cascade") f.adapter.read = async () => snapshot();
    assert.equal((await runInstructorCancellationJob(f)).status, "review_required", failure);
    assert.equal(f.effects(), failure === "cascade" ? 1 : 0, failure);
    assert.notEqual(f.data.get("instructorLessonRegistrations/ilr_test").status, "cancelled");
  }
});

test("a mismatched cancellation owner or an existing effect cannot claim", async () => {
  for (const failure of ["owner", "effect", "processing"]) {
    const f = fixture();
    if (failure === "owner") f.data.get("instructorLessonRegistrations/ilr_test").cancellation.jobId = "other";
    if (failure === "effect") f.data.get("cancel/test").externalEffectStarted = true;
    if (failure === "processing") f.data.get("cancel/test").status = "processing";
    assert.equal((await runInstructorCancellationJob(f)).status, "not_claimed"); assert.equal(f.effects(), 0);
  }
});

test("stale recovery holds the browser lock, counts review and never dispatches", async () => {
  const f = fixture({ status: "processing", leaseExpiresAt: new Date(0), externalEffectStarted: true });
  let held = false, released = false;
  f.db.collection = () => ({ where: (_field, _op, status) => ({ limit: () => ({ get: async () => {
    const docs = f.data.get("cancel/test").status === status ? [{ id: "test", ref: f.ref, data: () => f.data.get("cancel/test") }] : [];
    return { docs, empty: docs.length === 0 };
  } }) }) });
  const updateTransaction = f.db.runTransaction;
  f.db.runTransaction = async callback => { assert.equal(held, true); return updateTransaction(callback); };
  const result = await processInstructorLessonCancellations({ ...f, apply: true,
    acquireLock: async () => { held = true; return async () => { held = false; released = true; }; },
    browserFactory: () => { throw Error("must not open browser"); } });
  assert.equal(result.reviewRequired, 1); assert.equal(result.results[0].recovered, true);
  assert.equal(released, true); assert.equal(f.effects(), 0);
});

test("busy owner prevents stale recovery itself, not just the later browser launch", async () => {
  const f = fixture({ status: "processing", leaseExpiresAt: new Date(0), externalEffectStarted: true });
  f.db.collection = () => ({ where: (_field, _op, status) => ({ limit: () => ({ get: async () => {
    const docs = status === "processing" ? [{ id: "test", ref: f.ref, data: () => f.data.get("cancel/test") }] : [];
    return { docs, empty: docs.length === 0 };
  } }) }) });
  const result = await processInstructorLessonCancellations({ ...f, apply: true,
    acquireLock: async () => { throw Error("StudioMate browser profile is locked by existing owner"); } });
  assert.equal(result.deferred, true); assert.equal(f.data.get("cancel/test").status, "processing");
  assert.equal(f.notifications.length, 0); assert.equal(f.effects(), 0);
});

const bookingBody = () => ({ bookings: { current_page: 1, last_page: 1, total: 1, data: [{ id: 401, studio_id: 5330,
  user_ticket_id: 201, lecture_id: 501, member: { id: 101 }, status: "booked", deleted_at: null,
  lecture: { studio_id: 5330, title: "강사레슨 A", start_on: "2026-10-24 13:00:00", instructor: { name: "합성 강사" } } }] } });

function archivedTicketReadFixture({ cardCount = 1, detailPatch = {} } = {}) {
  const ticket = { id: 201, ticket_id: 301, studio_id: 5330, member: { id: 101 },
    ticket: { id: 301, title: job.ticketName, type: "coupon", available_class_type: "group" },
    created_at: "2026-10-16 12:00:00", updated_at: "2026-10-16 12:01:00", deleted_at: null,
    availability_start_at: job.lessonDate, expire_at: job.lessonDate, active: false, ticket_usable: false,
    is_shared: false, max_coupon: 2, remaining_coupon: 2,
    payments: [{ id: 601, created_at: "2026-10-16 12:00:00", unpaid_amount: 0,
      card_amount: 20000, cash_amount: 0, wiretransfer_amount: 0, transfer_amount: 0, point_amount: 0 }] };
  const response = (path, value) => ({ url: () => `https://api.studiomate.kr${path}`,
    request: () => ({ method: () => "GET" }), ok: () => true, finished: async () => null,
    json: async () => structuredClone(value) });
  const responses = [response("/v2/staff/userTickets?member_id=101&is_all=true", [ticket]),
    response("/v2/staff/userTickets/201", { data: { ...ticket, ...detailPatch } }),
    response("/v2/staff/userTickets/reserve-list/201/booking", bookingBody())];
  const events = [], writes = [];
  let previousClicked = false, visible = false, previousCounts = 0, routeHandler, currentUrl;
  const heading = name => ({ role: "heading", name, exact: true });
  const previous = {
    count: async () => { previousCounts++; return previousClicked ? 1 : 0; },
    click: async () => {
      events.push("previous:start");
      await Promise.resolve();
      previousClicked = true;
      events.push("previous:done");
    },
  };
  const cards = {
    filter: options => {
      // Archived cards contain only the title, not the lesson date.
      assert.deepEqual(options, { has: heading(job.ticketName) });
      events.push("cards:title-filter");
      return cards;
    },
    first: () => ({ waitFor: async options => {
      assert.deepEqual(options, { state: "visible", timeout: 20000 });
      assert.equal(previousClicked, true, "previous.click() must finish before waiting for archived cards");
      events.push("cards:wait-start");
      await Promise.resolve();
      visible = true;
      events.push("cards:visible");
    } }),
    count: async () => { events.push("cards:count"); return visible ? cardCount : 0; },
    locator: selector => {
      assert.equal(selector, ".userticket-card__click-listener");
      return { click: async () => {
        assert.equal(visible, true); assert.equal(cardCount, 1);
        events.push("cards:open");
      } };
    },
  };
  const dialog = {
    filter: options => { assert.deepEqual(options, { has: heading(`${job.memberName}님의 수강권`) }); return dialog; },
    waitFor: async options => { assert.deepEqual(options, { state: "visible" }); },
    getByRole: (role, options) => {
      if (role !== "heading") { writes.push({ role, options }); assert.fail("read must not access disable controls"); }
      assert.deepEqual(options, { name: job.ticketName, exact: true });
      return { count: async () => 1 };
    },
    locator: selector => {
      if (selector === ".booking-history__list .booking") return { count: async () => 1 };
      assert.equal(selector, ".booking-history__tabs");
      return { getByRole: role => {
        assert.equal(role, "listitem");
        return { filter: options => {
          assert.ok(options.hasText instanceof RegExp);
          return { waitFor: async () => {} };
        } };
      } };
    },
  };
  const page = {
    route: async (pattern, handler) => { assert.equal(pattern, "**/*"); routeHandler = handler; },
    waitForResponse: predicate => {
      const matched = responses.find(predicate);
      assert.ok(matched, "only expected native GET responses may be requested");
      return Promise.resolve(matched);
    },
    goto: async url => { currentUrl = url; }, url: () => currentUrl,
    locator: selector => {
      if (selector === ".ticket-expired-modal__product-list .userticket-card") return cards;
      assert.equal(selector, ".member-detail__header", "inactive passes must use the archived modal, not active cards");
      return { waitFor: async () => {}, innerText: async () => `${job.memberName} ${job.memberPhone}`,
        getByRole: (role, options) => {
          assert.equal(role, "heading"); assert.deepEqual(options, { name: job.memberName, exact: true });
          return { count: async () => 1 };
        } };
    },
    getByRole: (role, options) => {
      if (role === "heading") { assert.equal(options.exact, true); return heading(options.name); }
      if (role === "dialog" && !options) return dialog;
      if (role === "button" && options?.name === "이전 수강권 보기") {
        assert.equal(options.exact, true); return previous;
      }
      writes.push({ role, options }); assert.fail("unexpected write/disable control during read");
    },
  };
  return { adapter: createInstructorCancellationBrowser(page), events, writes,
    previousCounts: () => previousCounts, routeHandler: () => routeHandler };
}

test("browser read awaits archived-card visibility without a previous-button count or date filter", async () => {
  const f = archivedTicketReadFixture();
  const result = await f.adapter.read(job);
  assert.equal(result.complete, true);
  assert.deepEqual(result.member, snapshot().member);
  assert.equal(result.tickets.length, 1);
  assert.equal(result.tickets[0].userTicketId, "201");
  assert.equal(result.tickets[0].productId, "301");
  assert.equal(result.tickets[0].usable, false);
  assert.deepEqual(result.bookings, snapshot().bookings);
  assert.equal(f.previousCounts(), 0, "the initially absent previous button must never be count-gated");
  assert.deepEqual(f.events, ["previous:start", "previous:done", "cards:title-filter",
    "cards:wait-start", "cards:visible", "cards:count", "cards:open"]);
  assert.deepEqual(f.writes, []);
  let continued = 0, aborted = 0;
  for (const method of ["POST", "PATCH", "DELETE"]) await f.routeHandler()({
    request: () => ({ method: () => method,
      url: () => "https://api.studiomate.kr/v2/staff/userTickets/active-toggle/201",
      postDataJSON: () => ({ reason: "강사레슨 수강 취소" }) }),
    continue: async () => { continued++; }, abort: async () => { aborted++; },
  });
  assert.equal(continued, 0, "read must never arm native writes");
  assert.equal(aborted, 3);
});

test("browser read rejects duplicate same-title archived cards after awaiting visibility", async () => {
  const f = archivedTicketReadFixture({ cardCount: 2 });
  await assert.rejects(f.adapter.read(job), /화면 수강권이 중복되거나 없습니다/);
  assert.equal(f.previousCounts(), 0);
  assert.deepEqual(f.events, ["previous:start", "previous:done", "cards:title-filter",
    "cards:wait-start", "cards:visible", "cards:count"]);
  assert.deepEqual(f.writes, []);
});

test("browser read rejects archived detail for a different issued ticket, member or studio", async () => {
  for (const detailPatch of [{ id: 202 }, { member: { id: 102 } }, { studio_id: 5331 }]) {
    const f = archivedTicketReadFixture({ detailPatch });
    await assert.rejects(f.adapter.read(job), /선택된 화면의 발급 수강권 ID가 다릅니다/);
    assert.ok(f.events.includes("cards:open"));
    assert.deepEqual(f.writes, []);
  }
});

test("UI booking response is bounded by native issued pass, member, studio and complete pagination", () => {
  const body = bookingBody();
  assert.equal(normalizeCancellationBookingResponse(body, job, "201").rows[0].startTime, "13:00");
  for (const change of [x => x.bookings.last_page = 2, x => x.bookings.total = 0,
    x => x.bookings.data[0].user_ticket_id = 301, x => x.bookings.data[0].member.id = 999,
    x => x.bookings.data[0].lecture.studio_id = 999, x => x.bookings.data[0].status = "unknown"]) {
    const bad = bookingBody(); change(bad); assert.throws(() => normalizeCancellationBookingResponse(bad, job, "201"));
  }
});

test("browser write gate allows exactly one UI active-toggle with fixed reason, never refund/delete/send", async () => {
  let handler, continued = 0, aborted = 0, captured, lastUrl;
  const nativeReason = "강사레슨 수강 취소";
  const route = (method, url, data) => ({ request: () => ({ method: () => method, url: () => url, postDataJSON: () => data }),
    continue: async () => { continued++; }, abort: async () => { aborted++; } });
  const confirm = { waitFor: async () => {}, innerText: async () => "예약되어 있는 수업은 자동으로 취소됩니다.",
    getByRole: (role, { name } = {}) => role === "textbox" ? { fill: async () => {} } : { click: async () => {
      if (name === "확인") { await handler(route("POST", lastUrl, { reason: nativeReason })); }
    } } };
  const page = { route: async (_pattern, callback) => { handler = callback; },
    waitForResponse: () => captured || Promise.resolve({ error: new Error("not loaded") }),
    goto: async () => { throw new Error("fixture setup only"); },
    getByRole: (_role, options) => options?.name === "사용불가 처리" ? confirm : { filter: () => confirm } };
  const adapter = createInstructorCancellationBrowser(page);
  await assert.rejects(adapter.read(job), /fixture setup/);
  for (const method of ["POST", "PATCH", "DELETE"]) await handler(route(method, "https://api.studiomate.kr/v2/staff/payment/201", {}));
  assert.equal(continued, 0); assert.equal(aborted, 3);
  lastUrl = "https://api.studiomate.kr/v2/staff/userTickets/active-toggle/201";
  captured = Promise.resolve({ ok: () => true, finished: async () => null });
  await adapter.disable(job, { userTicketId: "201" }, async () => assert.equal(continued, 0));
  assert.equal(continued, 1);
  await handler(route("POST", lastUrl, { reason: nativeReason }));
  assert.equal(continued, 1); assert.equal(aborted, 4);
});
