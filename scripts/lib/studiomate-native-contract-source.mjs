import { normalizeMembershipPhone } from "./studiomate-membership-contract-policy.mjs";

export const STUDIOMATE_ORIGIN = "https://arcpilates.studiomate.kr";
const API_PREFIX = "/v2/staff";
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const REQUIRED_SESSION_HEADERS = ["authorization", "x-sm-signature", "web-version"];
const SAFE_SESSION_HEADERS = [
  ...REQUIRED_SESSION_HEADERS,
  "accept",
  "accept-language",
  "content-type",
  "origin",
  "referer",
];
const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const money = (value) => {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};
const firstText = (row, keys) => {
  for (const key of keys) {
    const value = cleanText(row?.[key]);
    if (value) return value;
  }
  return "";
};

export class StudioMateNativeApiError extends Error {
  constructor(message, { status = 0, method = "GET", ambiguous = false } = {}) {
    super(message);
    this.name = "StudioMateNativeApiError";
    this.status = status;
    this.method = method;
    this.ambiguous = ambiguous;
  }
}

export function parseStudioMateLocalTime(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  const values = [year, month, day, hour, minute, second].map(Number);
  if (
    values[0] < 1970 ||
    values[1] < 1 ||
    values[1] > 12 ||
    values[2] < 1 ||
    values[2] > new Date(Date.UTC(values[0], values[1], 0)).getUTCDate() ||
    values[3] > 23 ||
    values[4] > 59 ||
    values[5] > 59
  )
    return null;
  const millis = Date.UTC(
    values[0],
    values[1] - 1,
    values[2],
    values[3] - 9,
    values[4],
    values[5],
    Number(fraction.padEnd(3, "0")),
  );
  const roundTrip = new Date(millis + 9 * 3600_000).toISOString();
  if (
    roundTrip.slice(0, 10) !== `${year}-${month}-${day}` ||
    roundTrip.slice(11, 19) !== `${hour}:${minute}:${second}`
  )
    return null;
  return new Date(millis).toISOString();
}

export function createStudioMateNativeApiClient({
  headers,
  fetchImpl = globalThis.fetch,
  origin = STUDIOMATE_ORIGIN,
  timeoutMs = 20_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const source = Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const key of REQUIRED_SESSION_HEADERS) {
    if (typeof source[key] !== "string" || !source[key].trim())
      throw new Error(`StudioMate session header missing: ${key}`);
  }
  const sessionHeaders = Object.fromEntries(
    SAFE_SESSION_HEADERS.flatMap((key) =>
      typeof source[key] === "string" && source[key].trim()
        ? [[key, source[key]]]
        : [],
    ),
  );
  const request = async (method, pathname, body) => {
    if (!/^\/v2\/staff\/[A-Za-z0-9_/?=&%.,:+-]+$/.test(pathname))
      throw new Error("Invalid StudioMate API path");
    const upper = method.toUpperCase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(new URL(pathname, origin), {
        method: upper,
        headers: {
          ...sessionHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new StudioMateNativeApiError("StudioMate API request outcome is unknown", {
        method: upper,
        ambiguous: WRITE_METHODS.has(upper),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new StudioMateNativeApiError(`StudioMate API returned ${response.status}`, {
        status: response.status,
        method: upper,
        ambiguous: WRITE_METHODS.has(upper),
      });
    }
    if (response.status === 204) return null;
    const contentType = response.headers?.get?.("content-type") || "";
    if (!contentType.includes("json")) return null;
    return response.json();
  };
  return Object.freeze({
    get: (pathname) => request("GET", pathname),
    post: (pathname, body) => request("POST", pathname, body),
    patch: (pathname, body) => request("PATCH", pathname, body),
  });
}

export async function captureStudioMateNativeApiClient(page, input = {}) {
  const origin = input.origin || STUDIOMATE_ORIGIN;
  const listUrl = input.bootstrapUrl || `${origin}/users/contract`;
  const waitForRequest = () =>
    page.waitForRequest(
      (request) => {
        const url = new URL(request.url());
        return (
          url.protocol === "https:" &&
          (url.hostname === "studiomate.kr" || url.hostname.endsWith(".studiomate.kr")) &&
          (url.pathname === `${API_PREFIX}/contract` ||
            /^\/v2\/staff\/contract\/[a-f0-9]{64}$/.test(url.pathname)) &&
          request.method() === "GET"
        );
      },
      { timeout: input.timeoutMs || 20_000 },
    );
  let requestPromise = waitForRequest();
  await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (typeof input.ensureLoggedIn === "function") {
    const changed = await input.ensureLoggedIn(page);
    if (changed || !page.url().startsWith(origin)) {
      requestPromise = waitForRequest();
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
  }
  const request = await requestPromise;
  const headers = await request.allHeaders();
  const apiOrigin = new URL(request.url()).origin;
  return createStudioMateNativeApiClient({
    headers,
    origin: apiOrigin,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.apiTimeoutMs,
  });
}

export async function readExactStudioMateMember(api, phone) {
  const normalizedPhone = normalizeMembershipPhone(phone);
  if (!normalizedPhone) throw new Error("Invalid member phone");
  const body = await api.get(
    `${API_PREFIX}/contract/member-list?search_word=${encodeURIComponent(normalizedPhone)}`,
  );
  const rows = arrayBody(body);
  const matches = rows.filter(
    (row) => normalizeMembershipPhone(row?.mobile) === normalizedPhone,
  );
  if (matches.length !== 1 || !nativeId(matches[0]?.id)) {
    return Object.freeze({
      status: "review",
      reason: matches.length ? "ambiguous_exact_phone" : "member_not_found",
      matchCount: matches.length,
      member: null,
    });
  }
  const row = matches[0];
  const memberGrade = firstText(row, [
    "grade",
    "member_grade",
    "memberGrade",
    "member_type",
    "memberType",
    "등급",
    "회원구분",
  ]);
  return Object.freeze({
    status: "verified",
    reason: "exact_phone_match",
    matchCount: 1,
    member: Object.freeze({
      memberId: String(row.id),
      name: cleanText(row.name),
      phone: normalizedPhone,
      gender: cleanText(row.gender),
      birthday: cleanText(row.birthday),
      ...(memberGrade ? { memberGrade } : {}),
      inactive: row.inactiveMember === true,
      hasAccount: row.has_user_account === true,
    }),
  });
}

export async function readStudioMateUserTickets(api, memberId) {
  if (!nativeId(memberId)) throw new Error("Invalid StudioMate member ID");
  const body = await api.get(
    `${API_PREFIX}/userTickets?is_all=1&member_id=${encodeURIComponent(memberId)}`,
  );
  const rows = arrayBody(body);
  const tickets = rows.map((row) => normalizeUserTicket(row, String(memberId)));
  if (tickets.some((row) => !row))
    return { status: "review", reason: "invalid_native_ticket_shape", tickets: [] };
  const ids = tickets.map((row) => row.userTicketId);
  if (new Set(ids).size !== ids.length)
    return { status: "review", reason: "duplicate_native_ticket_id", tickets: [] };
  return { status: "verified", reason: "complete_native_ticket_list", tickets };
}

export function buildNativeContractCompletionReadback({
  memberResult,
  ticketRead,
  contract,
  binding,
  checkedAt = new Date().toISOString(),
}) {
  if (
    memberResult?.status !== "verified" ||
    ticketRead?.status !== "verified" ||
    !contract?.verified ||
    !binding ||
    contract.contractId !== binding.contractId ||
    contract.memberId !== binding.memberId ||
    contract.studioId !== binding.studioId ||
    memberResult.member.memberId !== binding.memberId ||
    memberResult.member.phone !== binding.memberPhone
  )
    return { status: "review", reason: "native_completion_identity_mismatch" };
  const matches = ticketRead.tickets.filter(
    (ticket) =>
      ticket.userTicketId === binding.userTicketId &&
      ticket.productId === binding.productId &&
      ticket.memberId === binding.memberId &&
      ticket.studioId === binding.studioId,
  );
  if (matches.length !== 1)
    return { status: "review", reason: "bound_native_ticket_not_unique" };
  const ticket = matches[0];
  if (!ticket.payment?.verified || !ticket.payment?.complete)
    return { status: "review", reason: ticket.payment?.reason || "native_payment_not_verified" };
  const identity = {
    verified: true,
    complete: true,
    checkedAt,
    studioId: binding.studioId,
    memberId: binding.memberId,
  };
  return {
    status: "verified",
    reason: "fresh_native_completion_readback",
    nativeReadback: Object.freeze({
      member: Object.freeze({
        ...identity,
        source: "studiomate_native_member",
        phone: memberResult.member.phone,
        phoneMatchCount: memberResult.matchCount,
        classification: "member",
        currentRecipientEligible: memberResult.member.inactive !== true,
      }),
      ticket: Object.freeze({
        ...identity,
        source: "studiomate_native_ticket",
        userTicketId: ticket.userTicketId,
        productId: ticket.productId,
        classification: "regular",
        status: ticket.status,
        refunded: ticket.refunded,
        cancelled: ticket.cancelled,
      }),
      payment: Object.freeze({
        ...identity,
        source: "studiomate_native_payment",
        userTicketId: ticket.userTicketId,
        productId: ticket.productId,
        status: ticket.payment.status,
        totalAmount: ticket.payment.totalAmount,
        paidAmount: ticket.payment.paidAmount,
        outstandingAmount: ticket.payment.outstandingAmount,
        refundedAmount: ticket.payment.refundedAmount,
      }),
      providerSignature:
        contract.status === "signed" &&
        contract.signedAt &&
        contract.memberSignaturePresent &&
        contract.centerSignaturePresent
          ? Object.freeze({
              ...identity,
              source: "studiomate_native_contract",
              userTicketId: ticket.userTicketId,
              productId: ticket.productId,
              contractId: contract.contractId,
              signedAt: contract.signedAt,
            })
          : null,
    }),
  };
}

export function normalizeUserTicket(row, expectedMemberId) {
  if (
    !record(row) ||
    !nativeId(row.id) ||
    !nativeId(row.ticket_id ?? row.ticket?.id) ||
    !nativeId(row.member?.id) ||
    String(row.member.id) !== String(expectedMemberId) ||
    row.deleted_at
  )
    return null;
  const issuedAt = parseStudioMateLocalTime(row.created_at);
  const updatedAt = parseStudioMateLocalTime(row.updated_at);
  if (!issuedAt || !updatedAt) return null;
  const payments = normalizePayments(row.payments || []);
  const active = row.active === true;
  const usable = row.ticket_usable === true;
  const ticket = row.ticket || {};
  return Object.freeze({
    source: "studiomate_native_ticket",
    verified: true,
    complete: true,
    studioId: String(row.studio_id),
    memberId: String(row.member.id),
    userTicketId: String(row.id),
    productId: String(row.ticket_id ?? ticket.id),
    title: cleanText(ticket.title),
    type: cleanText(ticket.type),
    availableClassType: cleanText(ticket.available_class_type),
    availabilityStartAt: cleanDate(row.availability_start_at),
    expireAt: cleanDate(row.expire_at),
    issuedAt,
    updatedAt,
    status: active && usable ? "active" : !active && usable ? "scheduled" : "inactive",
    active,
    usable,
    cancelled: /cancel/i.test(String(row.status || row.inactive_reason || "")),
    refunded: /refund|return/i.test(String(row.status || row.inactive_reason || "")),
    isShared: Boolean(row.is_shared),
    maxCoupon: integer(row.max_coupon),
    remainingCoupon: integer(row.remaining_coupon),
    maxCancel: integer(row.max_cancel),
    payment: payments,
  });
}

export function normalizePayments(rows) {
  if (!Array.isArray(rows)) return invalidPayment("invalid_payment_rows");
  const live = rows.filter((row) => record(row) && !row.deleted_at);
  if (!live.length) return invalidPayment("missing_payment_rows");
  // StudioMate updates the original unpaid ledger after adding a settlement row.
  // Creation order is therefore authoritative; updated_at can invert the events.
  const sorted = [...live].sort((a, b) => {
    const createdDelta =
      Date.parse(parseStudioMateLocalTime(a.created_at) || "") -
      Date.parse(parseStudioMateLocalTime(b.created_at) || "");
    return createdDelta || Number(a.id || 0) - Number(b.id || 0);
  });
  if (sorted.some((row) => /refund|cancel|return/i.test(String(row.status || row.type || ""))))
    return invalidPayment("refunded_or_cancelled_payment");
  const latestOutstanding = money(sorted.at(-1)?.unpaid_amount);
  if (latestOutstanding === null) return invalidPayment("invalid_outstanding_amount");
  const transactions = [];
  const components = [
    ["card_amount", "card"],
    ["cash_amount", "cash"],
    ["wiretransfer_amount", "bank_transfer"],
    ["transfer_amount", "bank_transfer"],
  ];
  for (const row of sorted) {
    if (!nativeId(row.id)) return invalidPayment("invalid_payment_id");
    const paidAt = parseStudioMateLocalTime(row.settlement_at || row.created_at);
    if (!paidAt) return invalidPayment("invalid_payment_time");
    const seenMethods = new Set();
    for (const [key, method] of components) {
      const amount = money(row[key]);
      if (amount === null) return invalidPayment("invalid_payment_amount");
      if (!amount || seenMethods.has(method)) continue;
      seenMethods.add(method);
      const transaction = {
        paymentId: `${row.id}:${method}`,
        method,
        status: "paid",
        amount,
        paidAt,
      };
      const installment = integer(row.installment_period);
      if (method === "card" && installment && installment > 0)
        transaction.installmentMonths = installment;
      transactions.push(Object.freeze(transaction));
    }
  }
  const paidAmount = transactions.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0 || latestOutstanding !== 0)
    return invalidPayment("unsettled_or_zero_payment");
  return Object.freeze({
    verified: true,
    complete: true,
    status: "paid",
    totalAmount: paidAmount + latestOutstanding,
    paidAmount,
    outstandingAmount: latestOutstanding,
    refundedAmount: 0,
    transactions: Object.freeze(transactions),
    contractPayment: Object.freeze({
      cardAmount: transactions
        .filter((row) => row.method === "card")
        .reduce((sum, row) => sum + row.amount, 0),
      cashAmount: transactions
        .filter((row) => row.method === "cash")
        .reduce((sum, row) => sum + row.amount, 0),
      wireAmount: transactions
        .filter((row) => row.method === "bank_transfer")
        .reduce((sum, row) => sum + row.amount, 0),
      pointAmount: 0,
      amount: paidAmount,
      unpaidAmount: latestOutstanding,
      installmentPeriod:
        transactions.find((row) => row.method === "card")?.installmentMonths || 0,
    }),
  });
}

export async function readStudioMateContract(api, contractId) {
  if (!/^[a-f0-9]{64}$/.test(String(contractId || "")))
    throw new Error("Invalid StudioMate contract ID");
  return normalizeContractDetail(
    await api.get(`${API_PREFIX}/contract/${contractId}`),
  );
}

export async function readCompleteStudioMateContractHistory(
  api,
  { phone, startDate = "2023-01-01", endDate = kstToday() } = {},
) {
  const normalizedPhone = normalizeMembershipPhone(phone);
  if (!normalizedPhone || !cleanDate(startDate) || !cleanDate(endDate) || startDate > endDate)
    throw new Error("Invalid contract history range");
  const summaries = [];
  for (const range of yearWindows(startDate, endDate)) {
    let page = 1;
    let lastPage = 1;
    do {
      const query = new URLSearchParams({
        start_date: range.start,
        end_date: range.end,
        page: String(page),
        limit: "50",
        sort_updated_at: "desc",
        keyword_type: "mobile",
        keyword_search: normalizedPhone,
      });
      const body = await api.get(`${API_PREFIX}/contract?${query}`);
      const rows = arrayBody(body);
      summaries.push(...rows);
      lastPage = integer(body?.meta?.last_page) || 1;
      if (lastPage > 100 || summaries.length > 1_000)
        throw new Error("Contract history exceeds safe review limits");
      page += 1;
    } while (page <= lastPage);
  }
  const ids = [
    ...new Set(
      summaries
        .map((row) => String(row?.id || row?.contract_id_hash || ""))
        .filter((id) => /^[a-f0-9]{64}$/.test(id)),
    ),
  ];
  const details = (
    await Promise.all(ids.map((id) => readStudioMateContract(api, id)))
  ).filter(Boolean);
  if (details.some((row) => row.memberPhone !== normalizedPhone))
    throw new Error("Contract history exact-phone readback mismatch");
  return Object.freeze({
    status: "verified",
    reason: "complete_exact_phone_contract_history",
    allTime: startDate === "2023-01-01",
    phone: normalizedPhone,
    startDate,
    endDate,
    records: Object.freeze(details),
  });
}

export function normalizeContractDetail(row) {
  if (
    !record(row) ||
    !/^[a-f0-9]{64}$/.test(String(row.id || "")) ||
    !nativeId(row.studio_id) ||
    !nativeId(row.selected_member_id) ||
    ![1, 2, 3, 4].includes(integer(row.category_id))
  )
    return null;
  const required = row.field_values?.basic?.required || {};
  const ticket = row.field_values?.join_user_tickets?.[0]?.required || null;
  return Object.freeze({
    source: "studiomate_native_contract",
    verified: true,
    complete: true,
    contractId: String(row.id),
    studioId: String(row.studio_id),
    memberId: String(row.selected_member_id),
    title: cleanText(row.title),
    categoryId: integer(row.category_id),
    status: normalizeStudioMateContractStatus(row.status),
    providerStatus: cleanText(row.status),
    memberName: cleanText(required.name),
    memberPhone: normalizeMembershipPhone(required.mobile),
    createdAt: parseStudioMateLocalTime(row.created_at),
    updatedAt: parseStudioMateLocalTime(row.updated_at),
    signedAt:
      parseStudioMateLocalTime(row.sign_complete_at) ||
      parseStudioMateLocalTime(row.contractor_signature?.signed_at),
    centerSignaturePresent: Boolean(row.manager_signature?.signature_data?.path),
    memberSignaturePresent: Boolean(row.contractor_signature?.signature_data?.path),
    terms: Object.freeze(
      (Array.isArray(row.term) ? row.term : []).map((term) =>
        Object.freeze({
          title: cleanText(term?.title),
          agreeType: cleanText(term?.agree_type),
          agreed: term?.is_agree === true,
        }),
      ),
    ),
    ticket: ticket
      ? Object.freeze({
          productId: nativeId(ticket.ticket_id) ? String(ticket.ticket_id) : "",
          userTicketId: nativeId(ticket.user_ticket_id)
            ? String(ticket.user_ticket_id)
            : "",
          title: cleanText(ticket.title),
          type: cleanText(ticket.type),
          availableClassType: cleanText(ticket.available_class_type),
          availabilityStartAt: cleanDate(ticket.availability_start_at),
          expireAt: cleanDate(ticket.expire_at),
          amount: money(ticket.amount),
          unpaidAmount: money(ticket.unpaid_amount),
        })
      : null,
  });
}

export function normalizeStudioMateContractStatus(status) {
  return (
    {
      complete: "signed",
      waiting: "sent",
      draft: "draft",
      opened: "opened",
      cancel: "cancelled",
      cancelled: "cancelled",
      expired: "expired",
    }[String(status || "").toLowerCase()] || "unknown"
  );
}

export async function readStudioMateTemplates(api) {
  const templates = arrayBody(
    await api.get(`${API_PREFIX}/contract-template/use-contract-create`),
  );
  return templates.map((row) => ({
    id: nativeId(row?.id) ? String(row.id) : "",
    title: cleanText(row?.title),
    categoryId: integer(row?.category_id),
    raw: row,
  }));
}

export async function readStudioMateTemplateTerms(api, templateId) {
  if (!nativeId(templateId)) throw new Error("Invalid contract template ID");
  const template = await api.get(`${API_PREFIX}/contract-template/${templateId}`);
  const refs = [
    ...(Array.isArray(template?.terms) ? template.terms : []),
    ...(Array.isArray(template?.term) ? template.term : []),
    ...(Array.isArray(template?.contract_terms) ? template.contract_terms : []),
    ...(Array.isArray(template?.template_fields?.terms)
      ? template.template_fields.terms
      : []),
  ];
  const ids = [
    ...new Set(
      refs
        .map(
          (row) =>
            row?.contract_term_id ??
            row?.contract_terms_id ??
            row?.term_id ??
            row?.id ??
            row,
        )
        .filter(nativeId)
        .map(String),
    ),
  ];
  if (!ids.length) throw new Error("Contract template has no verifiable terms");
  const terms = await Promise.all(
    ids.map((id) => api.get(`${API_PREFIX}/contract-terms/${id}`)),
  );
  return {
    template: {
      ...template,
      basic: {
        optional: template?.template_fields?.basic?.optional || [],
        additional: template?.template_fields?.basic?.additional || [],
      },
    },
    terms: terms.map((term) => ({
      title: cleanText(term?.title),
      contents: cleanText(term?.contents),
      agree_type: cleanText(term?.agree_type),
      is_agree: false,
    })),
  };
}

function arrayBody(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["data", "items", "list", "rows", "results"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function invalidPayment(reason) {
  return Object.freeze({
    verified: false,
    complete: false,
    status: "review",
    reason,
    totalAmount: 0,
    paidAmount: 0,
    outstandingAmount: 0,
    refundedAmount: 0,
    transactions: Object.freeze([]),
  });
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStudioMateDate(value) {
  const text = cleanText(value);
  const match = /^(\d{4})[-.]\s?(\d{2})[-.]\s?(\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/.exec(
    text,
  );
  if (!match) return "";
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
}

const cleanDate = normalizeStudioMateDate;

function kstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function yearWindows(startDate, endDate) {
  const ranges = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const year = Number(cursor.slice(0, 4));
    const end = `${year}-12-31` < endDate ? `${year}-12-31` : endDate;
    ranges.push({ start: cursor, end });
    cursor = `${year + 1}-01-01`;
  }
  return ranges;
}
