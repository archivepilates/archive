import {
  membershipContractJobKey,
  normalizeMembershipPhone,
} from "./studiomate-membership-contract-policy.mjs";

const MINUTE = 60_000;
const DAY = 86400_000;
const MAX_HISTORY = 100;
const nativeId = (v) => typeof v === "string" && /^[1-9]\d{0,63}$/.test(v);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v === v.trim() &&
  !/[<>\x00-\x1f\x7f]/.test(v);
const contractId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const money = (v) => Number.isSafeInteger(v) && v >= 0;
const statusByText = new Map([
  ["\uC791\uC131\uC911", "draft"],
  ["\uC694\uCCAD\uB300\uAE30", "sent"],
  ["\uC11C\uBA85\uC644\uB8CC", "signed"],
]);
const identityKeys = ["studioId", "memberId", "userTicketId", "productId"];
const historyBindingKeys = [...identityKeys, "selectionJobKey", "selectedAt"];
const sameIdentity = (a, b, keys = identityKeys) =>
  keys.every((key) => a?.[key] === b[key]);

/** Parse plain renderer text only; return YYYY-MM-DD or null, NEVER an instant. */
export function parseNativeSignedDate(value) {
  if (typeof value !== "string" || value.length > 60) return null;
  const input = value
    .trim()
    .replace(/^\uC11C\uBA85 \uC644\uB8CC\uC77C[ \t]*:[ \t]*/, "");
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) ||
    /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(input) ||
    /^(\d{4})\uB144\s*(\d{1,2})\uC6D4\s*(\d{1,2})\uC77C$/.exec(input);
  if (!match) return null;
  const [, y, m, d] = match;
  if (
    +y < 1970 ||
    +y > 9999 ||
    +m < 1 ||
    +m > 12 ||
    +d < 1 ||
    +d > new Date(Date.UTC(+y, +m, 0)).getUTCDate()
  )
    return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function utcMillis(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString() ===
      (value.length === 20 ? value.replace("Z", ".000Z") : value)
    ? ms
    : NaN;
}

function providerMillis(value) {
  if (typeof value !== "string") return NaN;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return NaN;
  const [, date, h, m, s, zone, zh, zm] = match;
  if (
    !parseNativeSignedDate(date) ||
    +h > 23 ||
    +m > 59 ||
    +s > 59 ||
    zone === "-00:00" ||
    (zone !== "Z" && (+zh > 14 || +zm > 59 || (+zh === 14 && +zm !== 0)))
  )
    return NaN;
  return Date.parse(value);
}

const iso = (ms) => new Date(ms).toISOString();
const kstDate = (ms) =>
  new Date(ms + 9 * 60 * MINUTE).toISOString().slice(0, 10);
const fresh = (ms, now, age = 30 * MINUTE) =>
  Number.isFinite(ms) && ms <= now && now - ms <= age;

function validBinding(binding) {
  return (
    record(binding) &&
    binding.verified === true &&
    text(binding.studioId) &&
    contractId(binding.contractId) &&
    text(binding.title) &&
    [binding.memberId, binding.userTicketId, binding.productId].every(
      nativeId,
    ) &&
    Boolean(binding.memberPhone) &&
    normalizeMembershipPhone(binding.memberPhone) === binding.memberPhone &&
    ["first_purchase_contract", "renewal_purchase_confirmation"].includes(
      binding.contractAction,
    ) &&
    binding.selectionJobKey ===
      membershipContractJobKey(binding.memberId, binding.userTicketId) &&
    money(binding.expectedTotalAmount ?? binding.expectedPaidAmount) &&
    (binding.expectedTotalAmount ?? binding.expectedPaidAmount) > 0 &&
    Number.isFinite(utcMillis(binding.selectedAt))
  );
}

function domObservation(dom, binding, historical = false) {
  if (
    !record(dom) ||
    dom.schemaVersion !== 1 ||
    dom.source !== "studiomate_contract_dom" ||
    dom.verified !== true ||
    dom.complete !== true ||
    dom.loading !== false ||
    dom.matchCount !== 1 ||
    !Number.isFinite(utcMillis(dom.observedAt)) ||
    !text(dom.memberName) ||
    !statusByText.has(dom.statusText) ||
    typeof dom.centerSignaturePresent !== "boolean" ||
    typeof dom.memberSignaturePresent !== "boolean" ||
    ["signedAt", "providerSignedAt", "firstObservedSignedAt"].some((key) =>
      Object.hasOwn(dom, key),
    )
  ) {
    return { reason: "incomplete_contract_dom" };
  }
  if (
    dom.contractId !== binding.contractId ||
    dom.title !== binding.title ||
    normalizeMembershipPhone(dom.memberPhone) !== binding.memberPhone
  )
    return { reason: "contract_binding_mismatch" };
  if (
    (historical || Object.hasOwn(dom, "bindingIdentity")) &&
    (!record(dom.bindingIdentity) ||
      !sameIdentity(dom.bindingIdentity, binding, historyBindingKeys))
  ) {
    return { reason: "historical_native_binding_mismatch" };
  }
  const status = statusByText.get(dom.statusText);
  const signedDate =
    dom.signedDateText === null
      ? null
      : parseNativeSignedDate(dom.signedDateText);
  if (status === "signed" && !signedDate)
    return { reason: "invalid_signed_date" };
  if (
    status !== "signed" &&
    (dom.signedDateText !== null || dom.memberSignaturePresent)
  ) {
    return { reason: "conflicting_signature_state" };
  }
  return {
    observation: Object.freeze({
      schemaVersion: 1,
      source: dom.source,
      verified: true,
      complete: true,
      loading: false,
      matchCount: 1,
      observedAt: iso(utcMillis(dom.observedAt)),
      contractId: dom.contractId,
      title: dom.title,
      memberName: dom.memberName,
      memberPhone: binding.memberPhone,
      bindingIdentity: Object.freeze(
        Object.fromEntries(
          historyBindingKeys.map((key) => [key, binding[key]]),
        ),
      ),
      statusText: dom.statusText,
      status,
      signedDateText: signedDate,
      signedDate,
      centerSignaturePresent: dom.centerSignaturePresent,
      memberSignaturePresent: dom.memberSignaturePresent,
    }),
  };
}

/**
 * DOM-only persistence gate, NOT completion/eligibility proof. No current readback
 * or clock is needed. Caller supplies an authentic bound observation clock; this
 * wrapper can verify syntax and selectedAt ordering, not freshness against now.
 * Returns {status:'observed'|'review',reason,observation|null}; never returns completion.
 */
export function normalizeNativeContractDom(rawDOM, binding) {
  if (!validBinding(binding))
    return {
      status: "review",
      reason: "invalid_native_binding",
      observation: null,
    };
  const parsed = domObservation(rawDOM, binding);
  if (parsed.reason)
    return { status: "review", reason: parsed.reason, observation: null };
  if (
    utcMillis(parsed.observation.observedAt) < utcMillis(binding.selectedAt)
  ) {
    return {
      status: "review",
      reason: "observation_predates_binding",
      observation: null,
    };
  }
  return {
    status: "observed",
    reason: "verified_bound_contract_dom",
    observation: parsed.observation,
  };
}

/**
 * Pure, staged adapter; no clock reads, browser, persistence or send permission.
 * This is a VERIFIED COLLECTOR DTO, not a claimed StudioMate API/selector schema.
 * Confirmed reader inputs: .contract-template-form-title__input input (title),
 * .contract-form-field.name input (memberName), .contract-form-field.mobile input
 * (memberPhone), .contract-status-tag (statusText), p.sign-completed-date (signedDateText).
 * Status text is exactly U+C791 U+C131 U+C911 (draft),
 * U+C694 U+CCAD U+B300 U+AE30 (sent/waiting), or
 * U+C11C U+BA85 U+C644 U+B8CC (signed); the reader may trim outer whitespace.
 * Signature booleans require p img under the footer li with the exact direct span
 * label, nonempty src, image.complete AND naturalWidth > 0. Never pass/store images.
 * DOM HAS NO native issuance/product IDs. Those come from independent native reads
 * and an immutable verified binding, never invented DOM fields or phone-only inference.
 * Flags are attestations, NOT authentication of arbitrary JSON.
 *
 * binding: { verified:true, studioId, contractId, title, memberPhone:canonicalPhone,
 *   memberId, userTicketId, productId, contractAction, selectionJobKey,
 *   selectedAt:UTC, expectedTotalAmount:positiveIntegerKRW,
 *   previousObservations?: readonly BoundObservation[], currentMemberTicket:{
 *     member:MemberRead, ticket:TicketRead, payment:PaymentRead,
 *     providerSignature?:ProviderRead|null } }
 * IDs for member/issuance/product are positive decimal strings. contractId is an
 * opaque ASCII identifier; title matches exactly. Action/key/amount come from the
 * immutable selection ALREADY accepted by the shared membership policy.
 *
 * raw (flat ContractDOM from the reader):
 * { schemaVersion:1, source:'studiomate_contract_dom', verified:true,
 *   complete:true, loading:false, matchCount:1, observedAt:UTC, contractId, title,
 *   memberName, memberPhone, statusText, // two exact confirmed native status labels
 *   centerSignaturePresent:boolean, memberSignaturePresent:boolean,
 *   signedDateText:null|string, fields?:Record<string,string> }
 * signedDateText is the UI calendar date only, in Asia/Seoul. fields is display-only:
 * contract amounts/dates/counts NEVER supply current member/ticket/payment eligibility.
 * fields is not retained in the returned observation. Signature images are never retained.
 * Every Read has verified:true, complete:true, checkedAt:UTC and studioId/memberId.
 * MemberRead: {source:'studiomate_native_member', phone, phoneMatchCount:1,
 *   classification:'member', currentRecipientEligible:true, ...Read}
 * TicketRead: {source:'studiomate_native_ticket', userTicketId, productId,
 *   classification:'regular', status:'active'|'scheduled', refunded:false,
 *   cancelled:false, ...Read}
 * PaymentRead: {source:'studiomate_native_payment', userTicketId, productId,
 *   status:'paid'|'partial'|'unpaid', totalAmount, paidAmount, outstandingAmount,
 *   refundedAmount, ...Read} // Display/audit snapshot, never an eligibility gate.
 * ProviderRead: {source:'studiomate_native_contract', contractId, userTicketId,
 *   productId, signedAt:RFC3339_WITH_ZONE, ...Read} // Actual native timestamp only.
 *
 * BoundObservation is the returned observation: normalized ContractDOM plus status, signedDate
 * and bindingIdentity:{studioId,memberId,userTicketId,productId,selectionJobKey,selectedAt}.
 * bindingIdentity comes from the verified immutable binding, not a DOM claim or
 * current eligibility proof. normalizeNativeContractDom may persist it before reads.
 * Previous observations are append-only trusted snapshots since binding;
 * supply the full bounded history (<=100), not just the latest signed snapshot.
 * Inputs are never mutated; observation is a detached, frozen snapshot for storage.
 * now/observation/read clocks are canonical UTC (seconds or three-digit millis).
 * Each current read must be <=30 minutes old, independently of contract freshness.
 * currentMemberTicket is supplied separately by the trusted worker, NEVER from old
 * selection evidence. Member and issued-ticket state determine eligibility; payment
 * settlement is retained for contract display and audit only.
 *
 * Returns {status:'complete'|'review'|'waiting',reason,completion|null,
 *   observation|null,firstObservedSignedAt|null,transition|null,sendAllowed:false}.
 * Only verified provider time populates completion.signedAt. A date-only transition
 * instead returns signatureTimeSource:'observed_transition' and signatureObservation:
 * {draftObservedAt,signedObservedAt,signedDate}; no signedAt property is emitted.
 * Both interval bounds must be <=24h old, selectedAt<=draft<signed<=checkedAt.
 */
export function normalizeNativeContractObservation(raw, binding, now) {
  let observation = null;
  let firstObservedSignedAt = null;
  let transition = null;
  const result = (status, reason, completion = null) => ({
    status,
    reason,
    completion,
    observation,
    firstObservedSignedAt,
    transition,
    sendAllowed: false,
  });
  const nowMs = utcMillis(now);
  if (!Number.isFinite(nowMs))
    return result("review", "invalid_observation_clock");
  if (
    !validBinding(binding) ||
    !fresh(utcMillis(binding.selectedAt), nowMs, 7 * DAY)
  )
    return result("review", "invalid_native_binding");
  const selectedMs = utcMillis(binding.selectedAt);
  if (!record(raw)) return result("review", "missing_native_readback");
  const current = domObservation(raw, binding);
  if (current.reason) return result("review", current.reason);
  const observedMs = utcMillis(current.observation.observedAt);
  if (!fresh(observedMs, nowMs) || observedMs < selectedMs)
    return result("review", "stale_contract_source");
  observation = current.observation;

  const readback = binding.currentMemberTicket;
  if (!record(readback))
    return result("review", "current_member_ticket_readback_required");
  const reads = [readback.member, readback.ticket, readback.payment];
  const sources = [
    "studiomate_native_member",
    "studiomate_native_ticket",
    "studiomate_native_payment",
  ];
  for (let index = 0; index < reads.length; index += 1) {
    const read = reads[index];
    if (
      !record(read) ||
      read.source !== sources[index] ||
      read.verified !== true ||
      read.complete !== true ||
      !sameIdentity(
        read,
        binding,
        index ? identityKeys : ["studioId", "memberId"],
      )
    ) {
      return result(
        "review",
        `unverified_${["member", "ticket", "payment"][index]}_source`,
      );
    }
    if (
      !fresh(utcMillis(read.checkedAt), nowMs) ||
      utcMillis(read.checkedAt) < selectedMs
    ) {
      return result(
        "review",
        `stale_${["member", "ticket", "payment"][index]}_source`,
      );
    }
  }
  if (readback.member.phoneMatchCount !== 1)
    return result("review", "ambiguous_native_phone");
  if (normalizeMembershipPhone(readback.member.phone) !== binding.memberPhone)
    return result("review", "current_phone_mismatch");
  if (
    readback.member.classification !== "member" ||
    readback.member.currentRecipientEligible !== true ||
    readback.ticket.classification !== "regular" ||
    readback.ticket.refunded !== false ||
    readback.ticket.cancelled !== false ||
    !["active", "scheduled"].includes(readback.ticket.status)
  )
    return result("review", "current_member_or_ticket_ineligible");
  const payment = readback.payment;

  const previous =
    binding.previousObservations === undefined
      ? []
      : binding.previousObservations;
  if (!Array.isArray(previous) || previous.length > MAX_HISTORY)
    return result("review", "invalid_observation_history");
  const byTime = new Map();
  for (const [index, dom] of [...previous, raw].entries()) {
    const parsed = domObservation(dom, binding, index < previous.length);
    if (parsed.reason)
      return result("review", "invalid_bound_observation_history");
    const snapshot = parsed.observation;
    const at = utcMillis(snapshot.observedAt);
    if (at < selectedMs || at > observedMs)
      return result("review", "invalid_observation_history_time");
    if (
      byTime.has(at) &&
      JSON.stringify(byTime.get(at)) !== JSON.stringify(snapshot)
    ) {
      return result("review", "conflicting_observation_history");
    }
    byTime.set(at, snapshot);
  }
  const history = [...byTime.values()].sort(
    (a, b) => utcMillis(a.observedAt) - utcMillis(b.observedAt),
  );
  let firstSigned = null;
  let draft = null;
  for (const snapshot of history) {
    if (["cancelled", "expired"].includes(snapshot.status))
      return result("review", "contract_inactive_history");
    const fullySigned =
      snapshot.status === "signed" &&
      snapshot.centerSignaturePresent &&
      snapshot.memberSignaturePresent;
    if (
      firstSigned &&
      (!fullySigned || snapshot.signedDate !== firstSigned.signedDate)
    ) {
      return result("review", "signature_history_regression");
    }
    if (!firstSigned && snapshot.status === "draft") draft = snapshot;
    if (!firstSigned && fullySigned) firstSigned = snapshot;
  }
  firstObservedSignedAt = firstSigned?.observedAt || null;
  if (firstSigned && draft)
    transition = Object.freeze({
      draftObservedAt: draft.observedAt,
      signedObservedAt: firstSigned.observedAt,
    });
  if (
    observation.status !== "signed" ||
    !observation.centerSignaturePresent ||
    !observation.memberSignaturePresent
  ) {
    if (readback.providerSignature != null)
      return result("review", "provider_signature_conflicts_with_dom");
    return result("waiting", "native_member_signature_required");
  }
  if (!fresh(utcMillis(firstObservedSignedAt), nowMs, DAY))
    return result("review", "stale_first_signed_observation");
  if (
    observation.signedDate > kstDate(utcMillis(firstObservedSignedAt)) ||
    (draft && observation.signedDate < kstDate(utcMillis(draft.observedAt)))
  ) {
    return result("review", "signed_date_conflicts_with_observations");
  }

  const provider = readback.providerSignature;
  let signedMs;
  if (provider != null) {
    if (
      !record(provider) ||
      provider.source !== "studiomate_native_contract" ||
      provider.verified !== true ||
      provider.complete !== true ||
      provider.contractId !== binding.contractId ||
      !sameIdentity(provider, binding)
    ) {
      return result("review", "unverified_provider_signature");
    }
    if (!fresh(utcMillis(provider.checkedAt), nowMs))
      return result("review", "stale_provider_source");
    signedMs = providerMillis(provider.signedAt);
    if (
      !fresh(signedMs, nowMs, DAY) ||
      signedMs < selectedMs ||
      signedMs > utcMillis(firstObservedSignedAt) ||
      signedMs > utcMillis(provider.checkedAt) ||
      (draft && signedMs <= utcMillis(draft.observedAt)) ||
      kstDate(signedMs) !== observation.signedDate
    )
      return result("review", "invalid_provider_signature_time");
  } else if (!transition) {
    return result("review", "native_signed_transition_unproven");
  } else if (
    !fresh(utcMillis(transition.draftObservedAt), nowMs, DAY) ||
    utcMillis(transition.draftObservedAt) >= utcMillis(firstObservedSignedAt)
  ) {
    return result("review", "invalid_signature_observation_interval");
  }
  const evidenceTime =
    provider != null ? signedMs : utcMillis(firstObservedSignedAt);
  if (reads.some((read) => utcMillis(read.checkedAt) < evidenceTime))
    return result("review", "current_read_predates_signature_evidence");
  const signatureEvidence =
    provider != null
      ? { signatureTimeSource: "provider", signedAt: iso(signedMs) }
      : {
          signatureTimeSource: "observed_transition",
          signatureObservation: Object.freeze({
            ...transition,
            signedDate: observation.signedDate,
          }),
        };

  return result(
    "complete",
    provider != null
      ? "verified_provider_signed_at"
      : "verified_observed_signature_transition",
    Object.freeze({
      source: "studiomate_native_contract",
      authoritative: true,
      contractId: binding.contractId,
      ...Object.fromEntries(identityKeys.map((key) => [key, binding[key]])),
      memberPhone: binding.memberPhone,
      currentPhone: binding.memberPhone,
      contractAction: binding.contractAction,
      selectionJobKey: binding.selectionJobKey,
      checkedAt: iso(
        Math.min(
          observedMs,
          provider != null ? utcMillis(provider.checkedAt) : observedMs,
          ...reads.map((read) => utcMillis(read.checkedAt)),
        ),
      ),
      ...signatureEvidence,
      firstObservedSignedAt,
      signedDate: observation.signedDate,
      memberClassification: readback.member.classification,
      ticketClassification: readback.ticket.classification,
      currentRecipientEligible: true,
      identityVerified: true,
      nativePhoneMatchCount: 1,
      refunded: false,
      cancelled: false,
      ticketStatus: readback.ticket.status,
      paymentStatus: payment.status,
      paidAmount: payment.paidAmount,
      outstandingAmount: payment.outstandingAmount,
      status: "signed",
      memberSigned: true,
      centerSigned: true,
    }),
  );
}
