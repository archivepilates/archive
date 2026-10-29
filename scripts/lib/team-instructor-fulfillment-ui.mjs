import { assertMemberDispatchAllowed } from "./member-dispatch-window.mjs";
import { issuedInstructorTicketId, instructorTicketResponseDiagnostics } from "./instructor-ticket-issue-evidence.mjs";

const BASE = "https://arcpilates.studiomate.kr";
const nativeApiResponse = response => {
  const url = new URL(response.url());
  return url.protocol === "https:" && (url.hostname === "studiomate.kr" || url.hostname.endsWith(".studiomate.kr"));
};
const TITLE = "Team 강사레슨";
const DATE = "2026-11-20";
const PRICE = 80000;
const attempts = new WeakMap();
const nativeId = value => /^[1-9]\d{0,63}$/.test(String(value || ""));
const name = value => String(value || "").replace(/\s+/g, " ").trim();
const phone = value => {
  const digits = String(value || "").replace(/\D/g, "");
  return /^8210\d{8}$/.test(digits) ? `0${digits.slice(2)}` : digits;
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function inputFor(input, needsMember = false) {
  check(input && input.ticketName === TITLE && input.lessonDate === DATE
    && input.paymentMethod === "wiretransfer", "Unsupported Team ticket, date or payment method");
  check((input.ticketPrice ?? input.paymentAmount) === PRICE
    && (input.ticketPrice === undefined || input.ticketPrice === PRICE)
    && (input.paymentAmount === undefined || input.paymentAmount === PRICE), "Team payment must be 80000");
  const memberName = name(input.memberName), memberPhone = phone(input.memberPhone);
  check(memberName.length >= 2 && memberName.length <= 40 && /^010\d{8}$/.test(memberPhone), "Invalid member identity");
  const memberId = String(input.studiomateMemberId || input.memberId || "");
  check(!(input.memberId && input.studiomateMemberId && String(input.memberId) !== String(input.studiomateMemberId)), "Conflicting member IDs");
  check((!memberId && !needsMember) || nativeId(memberId), "Native member ID required");
  return { memberName, memberPhone, memberId };
}

function callbacks(options) {
  check(typeof options?.beforeEffect === "function" && typeof options?.onReceipt === "function", "Effect and durable receipt callbacks required");
  return options;
}

function actionKey(action, identity) {
  return `${action}|${identity.memberPhone}|${DATE}`;
}

function noReplay(page, action, identity, input) {
  check(!attempts.get(page)?.has(actionKey(action, identity)), "Action already attempted; reconcile, never replay");
  const fields = action === "ticket_issue"
    ? ["ticketId", "ticketIssueReceipt", "ticketIssueResponseObservation"] : ["memberCreateReceipt"];
  check(![...fields, "externalEffectStarted", "effectStartedAt"].some(key => Boolean(input[key])), "Prior effect evidence requires reconciliation, never replay");
}

function attempted(page, action, identity) {
  if (!attempts.has(page)) attempts.set(page, new Set());
  attempts.get(page).add(actionKey(action, identity));
}

function uncertain(action) {
  return Object.assign(new Error(`${action}: external result requires reconciliation; do not retry`), {
    code: "TEAM_UI_EFFECT_REVIEW_REQUIRED", action, externalEffectStarted: true, replayAllowed: false,
  });
}

function memberRows(payload) {
  const paths = [payload, payload?.data, payload?.members, payload?.items, payload?.content,
    payload?.results, payload?.rows, payload?.list, payload?.data?.members, payload?.data?.items,
    payload?.data?.content, payload?.data?.results, payload?.data?.rows, payload?.data?.list];
  const rows = paths.find(Array.isArray);
  check(rows, "Unknown member-search response structure");
  return rows.map(row => ({
    id: String(row?.id || row?.memberId || row?.userId || row?.user?.id || ""),
    name: name(row?.name || row?.memberName || row?.userName || row?.user?.name),
    phone: phone(row?.phone || row?.phoneNumber || row?.mobile || row?.mobilePhone || row?.contact || row?.user?.phone),
  }));
}

async function verifiedDetail(page, memberId) {
  await page.waitForURL(/\/users\/detail\?id=\d+/, { timeout: 30000 });
  const url = new URL(page.url());
  check(url.origin === BASE && url.pathname === "/users/detail" && url.searchParams.get("id") === memberId, "Search and detail member IDs differ");
  await page.locator(".member-detail__header").waitFor({ state: "visible", timeout: 30000 });
  check(/^(?:회원등급:\s*)?강사회원$/.test(name(await page.locator(".member-detail__header__user-grade").innerText())), "Member is not 강사회원; no grade changes allowed");
  return { memberId, verified: true };
}

/** Opens the matched member. Zero means both the observed search response and UI are empty. */
export async function lookupExactMember(page, input, _options = {}) {
  const identity = inputFor(input);
  await page.goto(`${BASE}/users`, { waitUntil: "networkidle", timeout: 60000 });
  const search = page.locator('input[placeholder="이름 또는 전화번호로 검색"]').first();
  await search.waitFor({ state: "visible" });
  const responsePromise = page.waitForResponse(response => response.request().method() === "GET"
    && nativeApiResponse(response)
    && /\/v2\/staff\/members\/top-bar-search(?:\?|$)/.test(response.url()), { timeout: 15000 }).catch(() => null);
  await search.fill(identity.memberPhone);
  const response = await responsePromise;
  check(response?.ok(), "Member search response unavailable");
  const api = memberRows(await response.json());
  const rows = page.locator(".members .member"), visible = [];
  for (let i = 0; i < await rows.count(); i++) {
    const locator = rows.nth(i);
    if (!await locator.isVisible()) continue;
    const text = await locator.innerText();
    visible.push({ locator, name: name(text.split(/\n/)[0]), phone: phone(text.match(/01\d[\s-]*\d{3,4}[\s-]*\d{4}/)?.[0]) });
  }
  if (!api.length && !visible.length) {
    check(!identity.memberId, "Expected member is missing; do not create a replacement");
    return { memberId: null, verifiedZero: true };
  }
  const apiMatches = api.filter(row => row.phone === identity.memberPhone);
  const matches = visible.filter(row => row.phone === identity.memberPhone);
  check(apiMatches.length === 1 && matches.length === 1, "Member phone match must be unique in response and UI");
  const member = apiMatches[0];
  check(member.name === identity.memberName && matches[0].name === identity.memberName, "Member full name does not match");
  check(nativeId(member.id) && (!identity.memberId || identity.memberId === member.id), "Member native ID does not match");
  await matches[0].locator.click();
  return { ...await verifiedDetail(page, member.id), verifiedZero: false };
}

export async function createInstructorMember(page, input, options) {
  const identity = inputFor(input), { beforeEffect, onReceipt } = callbacks(options);
  check(!identity.memberId, "Existing member ID cannot enter member creation");
  noReplay(page, "member_create", identity, input);
  check((await lookupExactMember(page, input)).verifiedZero, "Existing member must not be recreated");
  await page.goto(`${BASE}/users/create`, { waitUntil: "networkidle", timeout: 60000 });
  const nameInput = page.locator('input[placeholder="이름을 입력해주세요"]').first();
  const phoneInput = page.locator('input[placeholder="휴대폰 번호"]').first();
  await nameInput.fill(identity.memberName);
  await phoneInput.fill(identity.memberPhone);
  const grade = page.locator(".member-form__header__user-grade").first().locator('input[placeholder="선택"]').first();
  await grade.click();
  const option = page.locator(".el-select-dropdown__item:visible").filter({ hasText: /^강사회원$/ });
  await option.first().waitFor({ state: "visible", timeout: 15000 });
  check(await option.count() === 1, "Unknown instructor-grade option structure");
  await option.first().click();
  const verifyForm = async () => {
    check(new URL(page.url()).origin === BASE && new URL(page.url()).pathname === "/users/create", "Unexpected member creation page");
    check(name(await nameInput.inputValue()) === identity.memberName && phone(await phoneInput.inputValue()) === identity.memberPhone
      && name(await grade.inputValue()) === "강사회원", "Member creation form changed");
  };
  await verifyForm();
  const save = page.getByRole("button", { name: "회원 등록 완료", exact: true });
  check(await save.count() === 1 && await save.isEnabled(), "Unknown member save button structure");
  assertMemberDispatchAllowed();
  await beforeEffect("member_create");
  await verifyForm();
  assertMemberDispatchAllowed();
  attempted(page, "member_create", identity);
  let receiptAttempted = false;
  try {
    await save.click();
    await page.waitForURL(/\/users\/detail\?id=\d+/, { timeout: 30000 });
    const url = new URL(page.url()), memberId = url.searchParams.get("id");
    check(url.origin === BASE && nativeId(memberId), "Created member ID unavailable");
    receiptAttempted = true;
    await onReceipt({ effect: "member_create", memberId, outcome: "accepted_pending_readback" });
    return await lookupExactMember(page, { ...input, studiomateMemberId: memberId });
  } catch {
    if (!receiptAttempted) {
      try { await onReceipt({ effect: "member_create", memberId: null, outcome: "unknown" }); } catch { /* Keep the durable pre-effect claim. */ }
    }
    throw uncertain("member_create");
  }
}

function money(value) {
  const text = String(value ?? "").trim();
  check(/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text), "Unknown payment number format");
  const amount = Number(text.replaceAll(",", ""));
  check(Number.isSafeInteger(amount), "Invalid payment number");
  return amount;
}

function dates(text) {
  return [...text.matchAll(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/g)]
    .map(match => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
}

async function currentTeamTicket(page, identity, options) {
  const cards = page.locator(".member-basic__user-tickets").first().locator(".userticket-card, .ticket-card");
  const matches = [];
  for (let i = 0; i < await cards.count(); i++) {
    const locator = cards.nth(i);
    if (!await locator.isVisible() || await locator.evaluate(element => Boolean(element.parentElement?.closest(".userticket-card, .ticket-card")))) continue;
    const heading = locator.locator("h3");
    if (!await heading.count() && (await locator.innerText()).includes("새로운 수강권 만들기")) continue;
    check(await heading.count() === 1, "Unknown member ticket card heading");
    if (name(await heading.innerText()) !== TITLE) continue;
    const text = await locator.innerText(), validity = dates(text);
    check(validity.length === 2, "Unknown Team ticket validity structure");
    if (validity[0] !== DATE || validity[1] !== DATE) {
      check(validity[0] > DATE || validity[1] < DATE, "Overlapping Team ticket requires reconciliation");
      continue;
    }
    check(!/취소|환불|만료|사용\s*완료/.test(text), "Inactive or ambiguous Team ticket");
    const paid = [...text.matchAll(/결제\s*금액\s*([\d,]+)\s*원/g)];
    check(paid.length === 1 && money(paid[0][1]) === PRICE, "Team ticket payment readback mismatch");
    matches.push(true);
  }
  check(matches.length <= 1, "Duplicate same-day Team tickets; no issuance allowed");
  if (!matches.length) return null;
  // The original worker's data-id attribute is not proven to be a user-ticket ID.
  check(typeof options?.readTicketIdentity === "function", "Independent ticket identity callback required; do not infer an ID from card attributes");
  const evidence = await options.readTicketIdentity({ ...identity, ticketName: TITLE, lessonDate: DATE, paymentAmount: PRICE });
  check(evidence?.verified === true && String(evidence.memberId) === identity.memberId && nativeId(evidence.ticketId)
    && evidence.ticketName === TITLE && evidence.availableFrom === DATE && evidence.expiresAt === DATE
    && evidence.paymentAmount === PRICE, "Independent Team ticket identity mismatch");
  return String(evidence.ticketId);
}

/** readTicketIdentity must independently return verified memberId/ticketId, ticketName,
 * availableFrom/expiresAt and paymentAmount for exactly one current source ticket. */
export async function findTeamTicket(page, input, options = {}) {
  const identity = inputFor(input, true);
  await lookupExactMember(page, input);
  // Reopen independently, rather than trusting the page left by a previous operation.
  await page.goto(`${BASE}/users/detail?id=${encodeURIComponent(identity.memberId)}`, { waitUntil: "networkidle", timeout: 60000 });
  await verifiedDetail(page, identity.memberId);
  const ticketId = await currentTeamTicket(page, identity, options);
  check(!input.ticketId || String(input.ticketId) === ticketId, "Expected and independently read ticket IDs differ");
  return { memberId: identity.memberId, ticketId, verified: Boolean(ticketId) };
}

async function setDate(locator) {
  await locator.click();
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.fill("2026. 11. 20.");
  await locator.press("Enter");
}

async function verifyIssueForm(dialog, start, end) {
  const startCount = await start.count(), endCount = await end.count();
  check(startCount === endCount && startCount <= 1, "Unknown validity field structure");
  // Native step 3 unmounts step 2's date inputs. They are verified before advancing.
  if (startCount) check(dates(await start.inputValue()).join() === DATE && dates(await end.inputValue()).join() === DATE, "Team validity dates changed");
  const fields = await dialog.locator(".price-input, .point-input").evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector("label")?.textContent?.trim(),
    value: node.querySelector("input")?.value,
    inputCount: node.querySelectorAll("input").length,
  })));
  const allocation = { 판매가: PRICE, 결제금액: PRICE, 계좌이체: PRICE, 카드: 0, 현금: 0, 포인트: 0, 미수금: 0, 할인금액: 0 };
  for (const [label, amount] of Object.entries(allocation)) {
    const matches = fields.filter(field => field.label === label);
    check(matches.length === 1 && matches[0].inputCount === 1 && money(matches[0].value) === amount, `Team payment allocation mismatch: ${label}`);
  }
}

export async function issueTeamTicket(page, input, options) {
  const identity = inputFor(input, true), { beforeEffect, onReceipt } = callbacks(options);
  check(typeof options.readTicketIdentity === "function", "Independent ticket identity callback required before issuance");
  noReplay(page, "ticket_issue", identity, input);
  const existing = await findTeamTicket(page, input, options);
  if (existing.ticketId) return existing;
  const cards = page.locator(".member-basic__user-tickets").first().locator(".userticket-card, .ticket-card");
  const add = cards.filter({ hasText: "새로운 수강권 만들기" });
  check(await add.count() === 1, "Unknown add-ticket card structure");
  await add.click();
  const dialog = page.locator(".ticket-issue-modal");
  await dialog.waitFor({ state: "visible" });
  await dialog.locator('input[placeholder="수강권명 검색"]').first().fill(TITLE);
  await page.waitForFunction(ticketName => [...document.querySelectorAll(".ticket-issue-modal .ticket-card h3")]
    .some(node => String(node.textContent || "").replace(/\s+/g, " ").trim() === ticketName), TITLE);
  const products = dialog.locator(".ticket-card"), matches = [];
  for (let i = 0; i < await products.count(); i++) {
    const product = products.nth(i);
    if (await product.isVisible() && name(await product.locator("h3").innerText()) === TITLE) matches.push(product);
  }
  check(matches.length === 1, "Exact Team product card must be unique");
  const summary = await matches[0].innerText();
  const sale = [...summary.matchAll(/판매\s*금액\s*([\d,]+)/g)];
  const unit = [...summary.matchAll(/회당\s*가격\s*([\d,]+)/g)];
  check(/그룹형\s*횟수제\s*5\s*:\s*1/.test(summary) && /(?<!\d)1\s*일\s*2\s*회(?!\d)/.test(summary)
    && sale.length === 1 && money(sale[0][1]) === PRICE
    && unit.length === 1 && money(unit[0][1]) === PRICE / 2, "Team master card terms changed or unknown");
  const select = matches[0].locator(".ticket-card__click-listener");
  check(await select.count() === 1, "Unknown Team product selection structure");
  await select.click();
  const start = dialog.locator('input[placeholder="이용시작일"]');
  const end = dialog.locator('input[placeholder="이용종료일"]');
  check(await start.count() === 1 && await end.count() === 1, "Unknown validity field structure");
  await setDate(start);
  await setDate(end);
  check(dates(await start.inputValue()).join() === DATE && dates(await end.inputValue()).join() === DATE, "Team validity dates changed before payment");
  await dialog.getByRole("button", { name: "다음", exact: true }).click();
  const save = dialog.getByRole("button", { name: "완료", exact: true });
  await save.waitFor({ state: "visible" });
  check(await save.count() === 1 && await save.isEnabled(), "Unknown ticket save button structure");
  const payment = dialog.locator(".payment-form__element.right").first();
  await payment.waitFor({ state: "visible" });
  const wire = payment.getByText("계좌이체", { exact: true });
  check(await wire.count() === 1, "Unknown wire-transfer payment control");
  await wire.click();
  await verifyIssueForm(dialog, start, end);
  await verifiedDetail(page, identity.memberId);
  assertMemberDispatchAllowed();
  await beforeEffect("ticket_issue");
  await verifyIssueForm(dialog, start, end);
  await verifiedDetail(page, identity.memberId);
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST"
    && nativeApiResponse(response) && /\/v2\/staff\/user-tickets(?:\?|$)/.test(response.url()),
  { timeout: 15000 }).catch(() => null);
  assertMemberDispatchAllowed();
  attempted(page, "ticket_issue", identity);
  let receiptAttempted = false;
  try {
    await save.click();
    const response = await responsePromise;
    const payload = response ? await response.json().catch(() => null) : null;
    const observation = instructorTicketResponseDiagnostics({ observed: Boolean(response), ok: response?.ok(),
      status: response?.status(), contentType: response?.headers()?.["content-type"], payload });
    let ticketId = null;
    if (response?.ok()) {
      try { ticketId = issuedInstructorTicketId(payload); } catch { /* Persist uncertainty before stopping. */ }
    }
    receiptAttempted = true;
    await onReceipt({ effect: "ticket_issue", memberId: identity.memberId, ticketId,
      outcome: ticketId ? "accepted_pending_readback" : "unknown", observation });
    check(ticketId, "Ticket response has no verified unique native ID");
    const readback = await findTeamTicket(page, { ...input, ticketId }, options);
    check(readback.ticketId === ticketId, "Issued and independently read ticket IDs differ");
    return readback;
  } catch {
    if (!receiptAttempted) {
      try { await onReceipt({ effect: "ticket_issue", memberId: identity.memberId,
        ticketId: null, outcome: "unknown" }); } catch { /* Keep the durable pre-effect claim. */ }
    }
    throw uncertain("ticket_issue");
  }
}
