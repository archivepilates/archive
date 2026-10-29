import assert from "node:assert/strict";
import test from "node:test";
import { lookupExactMember, createInstructorMember, findTeamTicket, issueTeamTicket }
  from "../lib/team-instructor-fulfillment-ui.mjs";

const BASE = "https://arcpilates.studiomate.kr";
const INPUT = Object.freeze({ memberName: "Synthetic Member", memberPhone: "01000000001",
  memberId: "1234567", ticketName: "Team 강사레슨", paymentAmount: 80000,
  paymentMethod: "wiretransfer", lessonDate: "2026-11-20" });
const MEMBER = { id: INPUT.memberId, name: INPUT.memberName, phone: INPUT.memberPhone };
const MASTER = "Team 강사레슨\n그룹형 횟수제 5:1\n1일 2회\n판매금액 80,000원\n회당 가격 40,000원";
const CARD = "Team 강사레슨\n2026. 11. 20. ~ 2026. 11. 20.\n결제 금액 80,000원";
const ALLOCATION = { 판매가: "80,000", 결제금액: "80,000", 계좌이체: "80,000",
  카드: "0", 현금: "0", 포인트: "0", 미수금: "0", 할인금액: "0" };

class Locator {
  constructor(page, resolve) { this.page = page; this.resolve = resolve; }
  nodes() { return this.resolve(); }
  first() { return new Locator(this.page, () => this.nodes().slice(0, 1)); }
  nth(i) { return new Locator(this.page, () => this.nodes().slice(i, i + 1)); }
  filter({ hasText }) { return new Locator(this.page, () => this.nodes().filter(n =>
    hasText instanceof RegExp ? hasText.test(n.text || "") : (n.text || "").includes(hasText))); }
  locator(selector) { return new Locator(this.page, () => this.nodes().flatMap(n => n.children?.(selector) || [])); }
  getByRole(role, { name }) { return this.locator(`${role}:${name}`); }
  getByText(name) { return this.locator(`text:${name}`); }
  async count() { return this.nodes().length; }
  one() { assert.equal(this.nodes().length, 1, "stub expects one element"); return this.nodes()[0]; }
  async isVisible() { return this.one().visible !== false; }
  async isEnabled() { return this.one().enabled !== false; }
  async waitFor() { assert.ok(this.nodes().length, "stub element missing"); }
  async innerText() { return this.one().text || ""; }
  async inputValue() { return this.one().value; }
  async click() { await this.one().click?.(); }
  async fill(value) { const n = this.one(); n.value = value; await n.fill?.(value); }
  async press() {}
  async evaluate() { return this.one().nested === true; }
  async evaluateAll(fn) { return fn(this.nodes()); }
}

function fixture(t, config = {}) {
  let now = Date.parse("2026-10-29T05:00:00Z");
  t.mock.method(Date, "now", () => now);
  const events = [], receipts = [];
  const state = { members: [{ ...MEMBER }], grade: "회원등급:\n강사회원", cards: [], products: [MASTER],
    allocation: { ...ALLOCATION }, payload: { data: [{ id: "7654321" }] }, status: 201,
    readerId: "7654321", ...config };
  const el = (text = "", children) => ({ text, children });
  let url = `${BASE}/users`, waiters = [];
  const respond = (method, path, payload, status = 200) => {
    const response = { request: () => ({ method: () => method }), url: () => `https://api.studiomate.kr${path}`,
      ok: () => status >= 200 && status < 300, status: () => status,
      headers: () => ({ "content-type": "application/json" }), json: async () => payload };
    const pending = waiters; waiters = [];
    for (const w of pending) {
      if (!state.noResponse && w.predicate(response)) w.resolve(response);
      else w.reject(new Error("synthetic response absent"));
    }
  };
  const fields = Object.fromEntries(Object.entries({ name: "", phone: "", grade: "", start: "", end: "" })
    .map(([key, value]) => [key, { value }]));
  const header = el("member header");
  const search = { value: "", fill: async () => {
    events.push("search"); respond("GET", "/v2/staff/members/top-bar-search", state.searchPayload ?? { data: state.members });
  } };
  const memberSave = { click: async () => {
    events.push("click:member_create");
    if (state.clickThrows) throw new Error("synthetic transport uncertainty");
    state.members = [{ ...MEMBER }]; url = `${BASE}/users/detail?id=${MEMBER.id}`;
    if (state.noCreatedUrl) url = `${BASE}/users/create`;
  } };
  const ticketSave = { click: async () => {
    events.push("click:ticket_issue");
    if (state.clickThrows) { respond("POST", "/v2/staff/user-tickets", null, 500); throw new Error("synthetic uncertain click"); }
    state.cards = [state.readbackCard ?? CARD];
    respond("POST", "/v2/staff/user-tickets", state.payload, state.status);
  } };
  const payment = el("", key => key === "text:계좌이체" ? [{ click: async () => events.push("wire") }] : []);
  const dialog = el("", key => {
    if (key === 'input[placeholder="수강권명 검색"]') return [{ value: "" }];
    if (key === ".ticket-card") return state.products.map(text => el(text, child =>
      child === "h3" ? [el(text.split("\n")[0])] : child === ".ticket-card__click-listener" ? [{ click: async () => events.push("select:Team") }] : []));
    if (key === 'input[placeholder="이용시작일"]') return [fields.start];
    if (key === 'input[placeholder="이용종료일"]') return [fields.end];
    if (key === "button:다음") return [{ click: async () => events.push("next") }];
    if (key === "button:완료") return [ticketSave];
    if (key === ".payment-form__element.right") return [payment];
    if (key === ".price-input, .point-input") return Object.entries(state.allocation).map(([label, value]) => ({
      querySelector: selector => selector === "label" ? { textContent: label } : { value },
      querySelectorAll: () => [{}],
    }));
    return [];
  });
  const owned = el("", key => key === ".userticket-card, .ticket-card" ? [
    ...state.cards.map(text => el(text, child => child === "h3" ? [el(text.split("\n")[0])] : [])),
    { text: "새로운 수강권 만들기", click: async () => events.push("add:ticket") },
  ] : []);
  const page = {
    url: () => url,
    goto: async next => { events.push(`goto:${new URL(next).pathname}`); url = next; },
    waitForResponse: (predicate) => new Promise((resolve, reject) => waiters.push({ predicate, resolve, reject })),
    waitForURL: async pattern => { assert.match(url, pattern); },
    waitForFunction: async () => {},
    getByRole: (role, { name }) => new Locator(page, () => name === "회원 등록 완료" ? [memberSave] : []),
    locator: selector => new Locator(page, () => {
      if (selector === 'input[placeholder="이름 또는 전화번호로 검색"]') return [search];
      if (selector === ".members .member") return (state.uiMembers ?? state.members).map(m => ({
        text: `${m.name}\n${m.phone}`, click: async () => { url = `${BASE}/users/detail?id=${state.detailId ?? m.id}`; },
      }));
      if (selector === ".member-detail__header") return [header];
      if (selector === ".member-detail__header__user-grade") return [el(state.grade)];
      if (selector === 'input[placeholder="이름을 입력해주세요"]') return [fields.name];
      if (selector === 'input[placeholder="휴대폰 번호"]') return [fields.phone];
      if (selector === ".member-form__header__user-grade") return [el("", () => [fields.grade])];
      if (selector === ".el-select-dropdown__item:visible") return [{ text: "강사회원", click: async () => { fields.grade.value = "강사회원"; } }];
      if (selector === ".member-basic__user-tickets") return [owned];
      if (selector === ".ticket-issue-modal") return [dialog];
      return [];
    }),
  };
  const options = {
    beforeEffect: async action => { events.push(`before:${action}`); },
    onReceipt: async receipt => { events.push(`receipt:${receipt.effect}`); receipts.push(receipt); },
    readTicketIdentity: async context => {
      events.push("independent:ticket");
      assert.equal(context.memberPhone, INPUT.memberPhone);
      return { verified: true, memberId: INPUT.memberId, ticketId: state.readerId,
        ticketName: INPUT.ticketName, availableFrom: INPUT.lessonDate, expiresAt: INPUT.lessonDate, paymentAmount: 80000 };
    },
  };
  return { page, state, events, receipts, options, fields, setNow: value => { now = Date.parse(value); } };
}

test("full phone, full name, native ID and exact instructor grade must agree", async t => {
  const f = fixture(t);
  assert.deepEqual(await lookupExactMember(f.page, INPUT), { memberId: MEMBER.id, verified: true, verifiedZero: false });
  for (const patch of [{ memberName: "Different Name" }, { memberId: "9999999" }]) {
    await assert.rejects(lookupExactMember(f.page, { ...INPUT, ...patch }));
  }
  f.state.grade = "스텝";
  await assert.rejects(lookupExactMember(f.page, INPUT), /no grade changes/);
});

for (const [label, config] of [
  ["duplicate phone", { members: [{ ...MEMBER }, { ...MEMBER, id: "2222222" }] }],
  ["UI/API disagreement", { uiMembers: [] }],
  ["unknown payload", { searchPayload: { unexpected: [] } }],
  ["missing response", { noResponse: true }],
  ["detail ID mismatch", { detailId: "2222222" }],
]) test(`lookup fails closed: ${label}`, async t => {
  const f = fixture(t, config);
  await assert.rejects(lookupExactMember(f.page, INPUT));
  assert.ok(!f.events.some(e => e.startsWith("click:")));
});

test("verified zero permits creation; receipt precedes independent lookup", async t => {
  const f = fixture(t, { members: [] }), input = { ...INPUT, memberId: undefined };
  const result = await createInstructorMember(f.page, input, f.options);
  assert.equal(result.memberId, MEMBER.id);
  assert.equal(f.events.filter(e => e === "click:member_create").length, 1);
  const receipt = f.events.indexOf("receipt:member_create");
  assert.ok(receipt > f.events.indexOf("before:member_create"));
  assert.ok(f.events.indexOf("search", receipt) > receipt);
  await assert.rejects(createInstructorMember(f.page, input, f.options), /already attempted/);
});

test("existing member and UI-only nonzero cannot create", async t => {
  const f = fixture(t), input = { ...INPUT, memberId: undefined };
  await assert.rejects(createInstructorMember(f.page, input, f.options), /must not be recreated/);
  f.state.members = []; f.state.uiMembers = [{ ...MEMBER }];
  await assert.rejects(createInstructorMember(f.page, input, f.options));
  assert.ok(!f.events.includes("click:member_create"));
});

test("exact live master wording issues once, persists response ID before readback", async t => {
  const f = fixture(t);
  assert.deepEqual(await issueTeamTicket(f.page, INPUT, f.options), { memberId: MEMBER.id, ticketId: "7654321", verified: true });
  assert.equal(f.fields.start.value, "2026. 11. 20.");
  assert.equal(f.fields.end.value, "2026. 11. 20.");
  const receipt = f.events.indexOf("receipt:ticket_issue");
  assert.ok(receipt > f.events.indexOf("click:ticket_issue"));
  assert.ok(f.events.indexOf("search", receipt) > receipt);
  assert.ok(f.events.indexOf("independent:ticket") > receipt);
  assert.equal(f.receipts[0].ticketId, "7654321");
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), /already attempted/);
  assert.equal(f.events.filter(e => e === "click:ticket_issue").length, 1);
});

test("existing unique Team ticket is reconciled, not reissued; no data-id assumed", async t => {
  const f = fixture(t, { cards: [CARD] });
  assert.equal((await issueTeamTicket(f.page, INPUT, f.options)).ticketId, "7654321");
  assert.ok(!f.events.includes("before:ticket_issue") && !f.events.includes("click:ticket_issue"));
  await assert.rejects(findTeamTicket(f.page, INPUT), /identity callback required/);
});

for (const [label, config] of [
  ["duplicate tickets", { cards: [CARD, CARD] }],
  ["wrong paid amount", { cards: [CARD.replace("80,000", "70,000")] }],
  ["overlapping validity", { cards: [CARD.replace("2026. 11. 20.", "2026. 11. 19.")] }],
  ["unknown card dates", { cards: ["Team 강사레슨\nunknown"] }],
  ["cancelled ticket", { cards: [CARD + "\n취소"] }],
]) test(`ticket reconciliation blocks issuance: ${label}`, async t => {
  const f = fixture(t, config);
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options));
  assert.ok(!f.events.includes("click:ticket_issue"));
});

for (const [label, products] of [
  ["ordinary 2T", [MASTER.replace("Team 강사레슨", "강사레슨 (2T)")]],
  ["duplicate exact product", [MASTER, MASTER]],
  ["wrong uses", [MASTER.replace("1일 2회", "1일 1회")]],
  ["wrong price", [MASTER.replace("80,000", "70,000")]],
  ["unknown unit wording", [MASTER.replace("회당 가격", "unknown")]],
]) test(`master card fails closed: ${label}`, async t => {
  const f = fixture(t, { products });
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options));
  assert.ok(!f.events.includes("before:ticket_issue") && !f.events.includes("click:ticket_issue"));
});

for (const key of Object.keys(ALLOCATION)) test(`every payment allocation is checked before save: ${key}`, async t => {
  const f = fixture(t); f.state.allocation[key] = key === "카드" ? "80000" : "1";
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), /allocation mismatch/);
  assert.ok(!f.events.includes("click:ticket_issue"));
});

test("callback mutations of payment or dates are caught before save", async t => {
  const f = fixture(t);
  f.options.beforeEffect = async () => { f.fields.end.value = "2026. 11. 21."; };
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), /validity dates/);
  assert.ok(!f.events.includes("click:ticket_issue"));
});

for (const action of ["ticket_issue", "member_create"]) test(`quiet hours and crossing 23:00 block ${action}`, async t => {
  const f = fixture(t, action === "member_create" ? { members: [] } : {});
  const input = action === "member_create" ? { ...INPUT, memberId: undefined } : INPUT;
  const run = () => action === "member_create" ? createInstructorMember(f.page, input, f.options) : issueTeamTicket(f.page, input, f.options);
  f.setNow("2026-10-29T14:00:00Z");
  await assert.rejects(run(), e => e.code === "member_dispatch_deferred");
  f.setNow("2026-10-29T13:59:59Z");
  f.options.beforeEffect = async () => f.setNow("2026-10-29T14:00:00Z");
  await assert.rejects(run(), e => e.code === "member_dispatch_deferred");
  assert.ok(!f.events.includes(`click:${action}`));
});

for (const [label, config] of [
  ["accepted malformed response", { payload: { success: true } }],
  ["HTTP failure", { status: 500 }],
  ["missing response", { noResponse: true }],
  ["readback ID differs", { readerId: "9999999" }],
  ["click transport uncertainty", { clickThrows: true }],
]) test(`no retry after ${label}`, async t => {
  const f = fixture(t, config);
  // Search responses must remain available; suppress only the issuance response.
  if (config.noResponse) { f.state.noResponse = false; f.options.beforeEffect = async () => { f.state.noResponse = true; }; }
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), e => e.code === "TEAM_UI_EFFECT_REVIEW_REQUIRED" && e.replayAllowed === false);
  assert.equal(f.receipts.length, 1);
  assert.ok(!JSON.stringify(f.receipts).includes(INPUT.memberPhone));
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), /already attempted/);
  assert.equal(f.events.filter(e => e === "click:ticket_issue").length, 1);
});

test("receipt storage failure prevents readback and never repeats callback or effect", async t => {
  const f = fixture(t); let calls = 0;
  f.options.onReceipt = async () => { calls++; throw new Error("durable store unavailable"); };
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), e => e.code === "TEAM_UI_EFFECT_REVIEW_REQUIRED");
  assert.equal(calls, 1);
  assert.ok(!f.events.includes("independent:ticket"));
  await assert.rejects(issueTeamTicket(f.page, INPUT, f.options), /already attempted/);
});

test("member creation uncertainty is reported once without retry", async t => {
  const f = fixture(t, { members: [], noCreatedUrl: true });
  const input = { ...INPUT, memberId: undefined };
  await assert.rejects(createInstructorMember(f.page, input, f.options), e => e.code === "TEAM_UI_EFFECT_REVIEW_REQUIRED");
  assert.equal(f.receipts.length, 1);
  assert.equal(f.receipts[0].outcome, "unknown");
  await assert.rejects(createInstructorMember(f.page, input, f.options), /already attempted/);
});

test("wrong scope, prior receipts and absent callbacks stop before UI effects", async t => {
  const f = fixture(t);
  for (const patch of [{ ticketName: "강사레슨 (2T)" }, { paymentAmount: 70000 }, { ticketPrice: 70000 },
    { paymentMethod: "card" }, { lessonDate: "2026-11-21" }, { ticketId: "7654321" },
    { ticketIssueReceipt: { ticketId: "7654321" } }, { externalEffectStarted: true }]) {
    await assert.rejects(issueTeamTicket(f.page, { ...INPUT, ...patch }, f.options));
  }
  await assert.rejects(issueTeamTicket(f.page, INPUT, {}), /callbacks required/);
  assert.ok(!f.events.some(e => e.startsWith("click:")));
});

test("missing independent reader fails before any navigation or issuance", async t => {
  const f = fixture(t);
  const { readTicketIdentity, ...options } = f.options;
  await assert.rejects(issueTeamTicket(f.page, INPUT, options), /identity callback required before issuance/);
  assert.deepEqual(f.events, []);
});
