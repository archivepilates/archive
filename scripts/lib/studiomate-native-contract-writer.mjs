import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  normalizeContractDetail,
  StudioMateNativeApiError,
} from "./studiomate-native-contract-source.mjs";
import { verifyStudioMateOfficialSeal } from "./studiomate-membership-contract-seal.mjs";

export const MEMBERSHIP_CONTRACT_TEMPLATES = Object.freeze({
  first_purchase_contract: Object.freeze({
    id: "608",
    title: "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
  }),
  renewal_purchase_confirmation: Object.freeze({
    id: "1341",
    title: "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D \uAD6C\uB9E4\uC870\uAC74 \uD655\uC778",
  }),
});

const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const money = (value) => Number.isSafeInteger(value) && value >= 0;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function buildStudioMateSignatureRequestPayload({
  prepared,
  contractId,
  memberName,
}) {
  const source = prepared?.data && typeof prepared.data === "object"
    ? prepared.data
    : prepared;
  const preparedContractId = clean(
    source?.contract_id_hash || source?.contractId || source?.id,
  );
  const contractorName = clean(
    source?.contractor_name || source?.contractorName || memberName,
  );
  const studioName = clean(
    source?.studio_name || source?.studioName || "ARCHIVE PILATES",
  );
  const contractLink = clean(
    source?.contract_link || source?.contractLink || source?.link,
  );
  if (
    preparedContractId !== contractId ||
    contractorName !== clean(memberName) ||
    !studioName ||
    !/^https:\/\/sign\.studiomate\.kr\/[a-f0-9]{64}$/.test(contractLink) ||
    !contractLink.endsWith(contractId)
  )
    throw new Error("Prepared signature request binding is invalid");

  const preparedMessage = clean(source?.message || source?.contents || source?.body);
  return Object.freeze({
    title: clean(source?.title) || "전자계약서가 도착했습니다.",
    message:
      preparedMessage ||
      `[${studioName}] 안녕하세요, '${contractorName}'님. 전자계약서 링크 입니다.\n${contractLink}`,
    status: "draft",
    is_message: false,
    filter: {},
  });
}

export function buildStudioMateJoinContractPayload(input) {
  const { selection, member, ticket, staff, template, terms } = input || {};
  validateSelection(selection, member, ticket);
  if (!nativeId(staff?.id) || !clean(staff?.name))
    throw new Error("Verified StudioMate staff is required");
  const expectedTemplate = MEMBERSHIP_CONTRACT_TEMPLATES[selection.action];
  if (
    !expectedTemplate ||
    String(template?.id) !== expectedTemplate.id ||
    clean(template?.title) !== expectedTemplate.title ||
    Number(template?.category_id ?? template?.categoryId) !== 1
  )
    throw new Error("Unexpected StudioMate contract template");
  if (
    !Array.isArray(terms) ||
    !terms.length ||
    terms.some(
      (term) =>
        !clean(term?.title) ||
        !clean(term?.contents) ||
        !["R", "S", "N"].includes(term?.agree_type) ||
        term?.is_agree === true,
    )
  )
    throw new Error("Contract terms are missing or pre-agreed");

  const periodLike = ticket.type.includes("P") || ticket.type === "S";
  const payment = ticket.payment.contractPayment;
  const payload = {
    category_id: 1,
    sign_type: 1,
    staff_name: staff.name,
    staff_id: Number(staff.id),
    sign_expiration_period: selection.signExpirationDays,
    title: expectedTemplate.title,
    contractor_member_id: Number(member.memberId),
    contractor_name: member.name,
    contractor_mobile: member.phone,
    basic: {
      required: {
        name: member.name,
        mobile: member.phone,
        gender: member.gender,
        birthday: member.birthday,
      },
      optional: optionalFields(template?.basic?.optional),
      additional: optionalFields(template?.basic?.additional),
    },
    join_user_tickets: [
      {
        required: {
          ticket_id: Number(ticket.productId),
          user_ticket_id: Number(ticket.userTicketId),
          is_shared: ticket.isShared,
          title: ticket.title,
          type: ticket.type,
          available_class_type: ticket.availableClassType,
          availability_start_at: ticket.availabilityStartAt,
          expire_at: ticket.expireAt,
          max_coupon: periodLike ? 999 : ticket.maxCoupon,
          remaining_coupon: periodLike ? 999 : ticket.remainingCoupon,
          max_cancel: periodLike ? 999 : ticket.maxCancel,
          card_amount: payment.cardAmount,
          installment: payment.installmentPeriod > 0 ? 1 : 0,
          installment_period: payment.installmentPeriod,
          cash_amount: payment.cashAmount,
          wiretransfer_amount: payment.wireAmount,
          point_amount: payment.pointAmount,
          amount: payment.amount,
          unpaid_amount: payment.unpaidAmount,
        },
      },
    ],
    terms: terms.map((term) => ({
      title: clean(term.title),
      contents: clean(term.contents),
      agree_type: term.agree_type,
      // Only the member may consent. The automation never checks a term.
      is_agree: false,
    })),
  };
  if (!periodLike && [ticket.maxCoupon, ticket.remainingCoupon, ticket.maxCancel].some((v) => !Number.isSafeInteger(v)))
    throw new Error("Count ticket balances are incomplete");
  return Object.freeze(payload);
}

export function validateCreatedContractReadback(raw, selection, payload, contractId) {
  const detail = raw?.source === "studiomate_native_contract" ? raw : normalizeContractDetail(raw);
  const expectedTicket = payload.join_user_tickets[0].required;
  const issue =
    !detail
      ? "invalid_contract_readback"
      : detail.contractId !== contractId
        ? "contract_id_mismatch"
        : detail.studioId !== selection.studioId || detail.memberId !== selection.memberId
          ? "contract_identity_mismatch"
          : detail.categoryId !== 1 || detail.title !== payload.title
            ? "contract_template_mismatch"
            : detail.memberPhone !== selection.memberPhone
              ? "contract_recipient_mismatch"
              : !detail.ticket ||
                  detail.ticket.productId !== String(expectedTicket.ticket_id) ||
                  detail.ticket.title !== expectedTicket.title ||
                  detail.ticket.availabilityStartAt !== expectedTicket.availability_start_at ||
                  detail.ticket.expireAt !== expectedTicket.expire_at ||
                  detail.ticket.amount !== expectedTicket.amount ||
                  detail.ticket.unpaidAmount !== expectedTicket.unpaid_amount
                ? "contract_ticket_mismatch"
                : !["draft", "sent", "signed"].includes(detail.status)
                  ? "unexpected_contract_status"
                  : "";
  return issue
    ? { ok: false, reason: issue, detail: null }
    : { ok: true, reason: "exact_contract_readback", detail };
}

/**
 * The journal is the idempotency boundary. It must durably claim the native member +
 * issuance job before POST and retain ambiguous states. A create without an ID is never
 * retried automatically.
 */
export async function executeStudioMateMembershipContract({
  api,
  journal,
  selection,
  member,
  ticket,
  staff,
  template,
  terms,
  sealPath,
}) {
  const payload = buildStudioMateJoinContractPayload({
    selection,
    member,
    ticket,
    staff,
    template,
    terms,
  });
  const payloadHash = hash(payload);
  const claim = await journal.claim({
    jobKey: selection.jobKey,
    payloadHash,
    selection,
  });
  if (!claim || !["claimed", "resume", "complete"].includes(claim.status))
    return { status: "review", reason: claim?.reason || "write_claim_rejected" };
  if (claim.status === "complete")
    return { status: "existing", reason: "contract_job_already_complete", contractId: claim.contractId };
  if (claim.payloadHash !== payloadHash)
    return { status: "review", reason: "claimed_payload_mismatch" };

  let contractId = claim.contractId || "";
  if (!contractId) {
    if (claim.status === "resume")
      return { status: "review", reason: "ambiguous_create_must_not_retry" };
    await journal.stage(selection.jobKey, "attempting_create", { payloadHash });
    try {
      const created = await api.post("/v2/staff/contract/join", payload);
      contractId = String(created?.id || created?.data?.id || "");
      if (!/^[a-f0-9]{64}$/.test(contractId))
        throw new StudioMateNativeApiError("StudioMate create response has no contract ID", {
          method: "POST",
          ambiguous: true,
        });
      await journal.stage(selection.jobKey, "created", { contractId });
    } catch (error) {
      await journal.stage(selection.jobKey, "unknown", {
        reason: "contract_create_outcome_unknown",
      });
      return { status: "review", reason: "contract_create_outcome_unknown" };
    }
  }

  let readback = validateCreatedContractReadback(
    await api.get(`/v2/staff/contract/${contractId}`),
    selection,
    payload,
    contractId,
  );
  if (!readback.ok) {
    await journal.stage(selection.jobKey, "review", { reason: readback.reason, contractId });
    return { status: "review", reason: readback.reason, contractId };
  }

  if (!readback.detail.centerSignaturePresent) {
    const seal = await verifyStudioMateOfficialSeal({ path: sealPath });
    const bytes = await readFile(seal.path);
    const signatureData = `data:${seal.mimeType};base64,${bytes.toString("base64")}`;
    await journal.stage(selection.jobKey, "attempting_seal", { contractId, sealSha256: seal.sha256 });
    try {
      await api.post("/v2/staff/contract/signature/direct", {
        contract_id_hash: contractId,
        signature_party: "M",
        signature_method: "upload",
        signature_data: signatureData,
      });
    } catch {
      // A failed response may still have committed. Read back once, never blind-retry.
    }
    readback = validateCreatedContractReadback(
      await api.get(`/v2/staff/contract/${contractId}`),
      selection,
      payload,
      contractId,
    );
    if (!readback.ok || !readback.detail.centerSignaturePresent) {
      await journal.stage(selection.jobKey, "review", {
        reason: "official_seal_outcome_unknown",
        contractId,
      });
      return { status: "review", reason: "official_seal_outcome_unknown", contractId };
    }
    await journal.stage(selection.jobKey, "sealed", { contractId, sealSha256: seal.sha256 });
  }

  if (readback.detail.status === "draft") {
    if (
      claim.status === "resume" &&
      ["attempting_signature_message", "signature_message_outcome_unknown"].includes(
        claim.stage,
      )
    ) {
      await journal.stage(selection.jobKey, "signature_message_outcome_unknown", {
        reason: "signature_message_outcome_unknown",
        contractId,
      });
      return {
        status: "review",
        reason: "signature_message_outcome_unknown",
        contractId,
      };
    }
    await journal.stage(selection.jobKey, "attempting_signature_request", { contractId });
    let prepared;
    try {
      prepared = await api.post(`/v2/staff/contract/signature/request/${contractId}`);
    } catch {
      // Preparation may have completed, but it does not send the member message.
      // Stop rather than guessing a second write payload.
      await journal.stage(selection.jobKey, "review", {
        reason: "signature_request_prepare_outcome_unknown",
        contractId,
      });
      return {
        status: "review",
        reason: "signature_request_prepare_outcome_unknown",
        contractId,
      };
    }
    let requestPayload;
    try {
      requestPayload = buildStudioMateSignatureRequestPayload({
        prepared,
        contractId,
        memberName: member.name,
      });
    } catch {
      await journal.stage(selection.jobKey, "review", {
        reason: "signature_request_prepare_binding_invalid",
        contractId,
      });
      return {
        status: "review",
        reason: "signature_request_prepare_binding_invalid",
        contractId,
      };
    }
    await journal.stage(selection.jobKey, "attempting_signature_message", { contractId });
    let signatureMessageError = false;
    try {
      await api.post(
        `/v2/staff/contract/signature/request/sms/${contractId}`,
        requestPayload,
      );
    } catch {
      // The provider may have accepted the send before a transport failure.
      // Resolve that ambiguity through the authoritative contract status below.
      signatureMessageError = true;
    }
    readback = validateCreatedContractReadback(
      await api.get(`/v2/staff/contract/${contractId}`),
      selection,
      payload,
      contractId,
    );
    if (!readback.ok || !["sent", "signed"].includes(readback.detail.status)) {
      await journal.stage(selection.jobKey, "review", {
        reason: signatureMessageError
          ? "signature_message_outcome_unknown"
          : "signature_request_outcome_unknown",
        contractId,
      });
      return {
        status: "review",
        reason: signatureMessageError
          ? "signature_message_outcome_unknown"
          : "signature_request_outcome_unknown",
        contractId,
      };
    }
  }

  if (!readback.detail.centerSignaturePresent) {
    await journal.stage(selection.jobKey, "review", {
      reason: "center_signature_missing_after_request",
      contractId,
    });
    return { status: "review", reason: "center_signature_missing_after_request", contractId };
  }
  await journal.stage(selection.jobKey, "signature_requested", {
    contractId,
    providerStatus: readback.detail.providerStatus,
  });
  return {
    status: readback.detail.status === "signed" ? "signed" : "waiting",
    reason:
      readback.detail.status === "signed"
        ? "member_already_signed"
        : "native_signature_request_verified",
    contractId,
  };
}

function validateSelection(selection, member, ticket) {
  if (
    !selection ||
    !Object.hasOwn(MEMBERSHIP_CONTRACT_TEMPLATES, selection.action) ||
    !/^membership_contract_[a-f0-9]{64}$/.test(clean(selection.jobKey)) ||
    !nativeId(selection.studioId) ||
    !nativeId(selection.memberId) ||
    !nativeId(selection.userTicketId) ||
    !nativeId(selection.productId) ||
    !clean(selection.memberPhone) ||
    !Number.isSafeInteger(selection.signExpirationDays) ||
    selection.signExpirationDays < 1 ||
    selection.signExpirationDays > 30
  )
    throw new Error("Invalid verified contract selection");
  if (
    member?.memberId !== selection.memberId ||
    member?.phone !== selection.memberPhone ||
    !clean(member?.name) ||
    !clean(member?.gender) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(clean(member?.birthday))
  )
    throw new Error("Member identity is incomplete");
  if (
    ticket?.source !== "studiomate_native_ticket" ||
    ticket?.verified !== true ||
    ticket?.complete !== true ||
    ticket?.studioId !== selection.studioId ||
    ticket?.memberId !== selection.memberId ||
    ticket?.userTicketId !== selection.userTicketId ||
    ticket?.productId !== selection.productId ||
    !["active", "scheduled"].includes(ticket?.status) ||
    ticket?.cancelled !== false ||
    ticket?.refunded !== false ||
    !clean(ticket?.title) ||
    !clean(ticket?.type) ||
    !clean(ticket?.availableClassType) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ticket?.availabilityStartAt) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ticket?.expireAt) ||
    ticket?.payment?.verified !== true ||
    ticket?.payment?.complete !== true ||
    ticket?.payment?.status !== "paid" ||
    !money(ticket?.payment?.paidAmount) ||
    ticket.payment.paidAmount <= 0 ||
    ticket.payment.outstandingAmount !== 0 ||
    !ticket.payment.contractPayment
  )
    throw new Error("Ticket/payment binding is incomplete");
}

function optionalFields(value) {
  if (!value) return undefined;
  if (Array.isArray(value))
    return value
      .filter((field) => field?.is_active !== false)
      .map((field) => ({
        field_label: clean(field.field_label || field.label || field.title),
        val: "",
      }))
      .filter((field) => field.field_label);
  return Object.entries(value).map(([fieldLabel]) => ({
    field_label: fieldLabel,
    val: "",
  }));
}
