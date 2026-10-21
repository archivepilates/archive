import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  normalizeContractDetail,
  StudioMateNativeApiError,
} from "./studiomate-native-contract-source.mjs";
import { verifyStudioMateOfficialSeal } from "./studiomate-membership-contract-seal.mjs";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred } from "./member-dispatch-window.mjs";

export const MEMBERSHIP_CONTRACT_TEMPLATES = Object.freeze({
  first_purchase_contract: Object.freeze({
    id: "608",
    title: "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
  }),
  renewal_purchase_confirmation: Object.freeze({
    id: "1341",
    title: "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D",
  }),
});

const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const money = (value) => Number.isSafeInteger(value) && value >= 0;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const OPERATOR_TEST_BINDING = Object.freeze({
  reference: "user_october_renewal_test_20261022",
  studioId: "5330",
  memberId: "1982133",
  userTicketId: "10277817",
  productId: "191164",
  action: "renewal_purchase_confirmation",
  jobKey: `membership_contract_${hash([
    "studiomate-renewal-operator-test-v1", "1982133", "10277817", "20261022",
  ])}`,
});
const OPERATOR_TEST_PURCHASE_DETAILS =
  "운영자 테스트 전용 문서입니다. 신규 구매나 결제를 생성하지 않으며, 회원 동의로 간주되지 않고 회원 동의나 서명을 대신하지 않습니다. 기존 실제 수강권의 금액과 이용기간을 그대로 표시합니다.";

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
  const { selection, member, ticket, staff, template, terms, operatorTestApproval } = input || {};
  if (operatorTestApproval !== undefined)
    validateOperatorTestApproval(operatorTestApproval, selection);
  validateSelection(selection, member, ticket, operatorTestApproval !== undefined);
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
  const additional = optionalFields(template?.basic?.additional);
  if (operatorTestApproval !== undefined) {
    const purchaseDetails = additional?.filter((field) => field.field_label === "구매조건 상세") || [];
    if (purchaseDetails.length !== 1)
      throw new Error("Operator test requires exactly one active 구매조건 상세 field");
    purchaseDetails[0].val = OPERATOR_TEST_PURCHASE_DETAILS;
  }
  const payload = {
    category_id: 1,
    sign_type: 1,
    staff_name: staff.name,
    staff_id: Number(staff.id),
    sign_expiration_period: selection.signExpirationDays,
    title: operatorTestApproval === undefined ? expectedTemplate.title : "(테스트) 아카이브 재등록",
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
      additional,
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
                  detail.ticket.userTicketId !== String(expectedTicket.user_ticket_id) ||
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
  operatorTestApproval,
  now = Date.now,
}) {
  const deferred = () => ({ ...memberDispatchWindow(now()), status: "deferred", jobKey: selection?.jobKey });
  if (!memberDispatchWindow(now()).allowed) return deferred();
  const payload = buildStudioMateJoinContractPayload({
    selection,
    member,
    ticket,
    staff,
    template,
    terms,
    operatorTestApproval,
  });
  const payloadHash = hash(payload);
  let claim;
  try {
    assertMemberDispatchAllowed(now());
    claim = await journal.claim({ jobKey: selection.jobKey, payloadHash, selection });
  } catch (error) {
    if (isMemberDispatchDeferred(error)) return deferred();
    throw error;
  }
  if (!claim || !["claimed", "resume", "complete"].includes(claim.status))
    return { status: "review", reason: claim?.reason || "write_claim_rejected" };
  if (claim.status === "complete")
    return { status: "existing", reason: "contract_job_already_complete", contractId: claim.contractId };
  if (claim.payloadHash !== payloadHash)
    return { status: "review", reason: "claimed_payload_mismatch" };

  let contractId = claim.contractId || "";
  let safeStage = claim.stage || "claimed";
  let preparedPayload = claim.preparedPayload || "";
  let postStarted = false;
  let blockedStage = "";
  // A journal await can cross 23:00. Undo only our marker, never an attempted POST.
  const post = async (stage, url, body, fields = {}) => {
    postStarted = false;
    blockedStage = stage;
    assertMemberDispatchAllowed(now());
    await journal.stage(selection.jobKey, stage, { contractId, ...fields });
    assertMemberDispatchAllowed(now());
    postStarted = true;
    return api.post(url, body);
  };
  try {
    if (!contractId) {
      if (claim.status === "resume" && claim.stage !== "deferred_create")
        return { status: "review", reason: "ambiguous_create_must_not_retry" };
      safeStage = "deferred_create";
      try {
        const created = await post("attempting_create", "/v2/staff/contract/join", payload, { payloadHash });
        contractId = String(created?.id || created?.data?.id || "");
        if (!/^[a-f0-9]{64}$/.test(contractId))
          throw new StudioMateNativeApiError("StudioMate create response has no contract ID", {
            method: "POST",
            ambiguous: true,
          });
        await journal.stage(selection.jobKey, "created", { contractId });
        safeStage = "created";
        postStarted = false;
      } catch (error) {
        if (isMemberDispatchDeferred(error) && !postStarted) throw error;
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
      if (claim.status === "resume" && (claim.stage === "attempting_seal" || claim.reason === "official_seal_outcome_unknown"))
        return { status: "review", reason: "official_seal_outcome_unknown", contractId };
      blockedStage = "before_seal_read";
      assertMemberDispatchAllowed(now());
      const seal = await verifyStudioMateOfficialSeal({ path: sealPath });
      const bytes = await readFile(seal.path);
      const signatureData = `data:${seal.mimeType};base64,${bytes.toString("base64")}`;
      try {
        await post("attempting_seal", "/v2/staff/contract/signature/direct", {
          contract_id_hash: contractId,
          signature_party: "M",
          signature_method: "upload",
          signature_data: signatureData,
        }, { sealSha256: seal.sha256 });
      } catch (error) {
        if (isMemberDispatchDeferred(error) && !postStarted) throw error;
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
      safeStage = "sealed";
      postStarted = false;
    }

    if (readback.detail.status === "draft") {
      if (claim.stage === "signature_prepared" && !preparedPayload)
        return { status: "review", reason: "signature_prepared_payload_missing", contractId };
      if (
        claim.status === "resume" &&
        (["attempting_signature_request", "attempting_signature_message", "signature_message_outcome_unknown"].includes(claim.stage) ||
          ["signature_message_outcome_unknown", "signature_request_outcome_unknown",
            "signature_request_prepare_outcome_unknown", "signature_request_prepare_binding_invalid"].includes(claim.reason))
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
      if (!preparedPayload) {
        let prepared;
        try {
          prepared = await post("attempting_signature_request", `/v2/staff/contract/signature/request/${contractId}`);
        } catch (error) {
          if (isMemberDispatchDeferred(error) && !postStarted) throw error;
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
        preparedPayload = JSON.stringify({ contract_id_hash: contractId, contractor_name: member.name,
          studio_name: "ARCHIVE PILATES", contract_link: `https://sign.studiomate.kr/${contractId}`,
          title: requestPayload.title, message: requestPayload.message });
        await journal.stage(selection.jobKey, "signature_prepared", { contractId, preparedPayload, reason: null });
        safeStage = "signature_prepared";
        postStarted = false;
      }
      const requestPayload = buildStudioMateSignatureRequestPayload({
        prepared: JSON.parse(preparedPayload), contractId, memberName: member.name,
      });
      let signatureMessageError = false;
      try {
        await post(
          "attempting_signature_message",
          `/v2/staff/contract/signature/request/sms/${contractId}`,
          requestPayload,
        );
      } catch (error) {
        if (isMemberDispatchDeferred(error) && !postStarted) throw error;
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
  } catch (error) {
    if (!isMemberDispatchDeferred(error) || postStarted) throw error;
    const window = memberDispatchWindow(now());
    await journal.stage(selection.jobKey, safeStage, { contractId, preparedPayload, reason: null,
      dispatchDeferrals: [...(claim.dispatchDeferrals || []), { stage: blockedStage || "before_seal_read",
        deferredAt: new Date(now()).toISOString(), nextAllowedAt: window.nextAllowedAt, providerPostCount: 0 }] });
    return { ...deferred(), contractId };
  }
}

function validateOperatorTestApproval(approval, selection) {
  if (
    !approval ||
    typeof approval !== "object" ||
    Array.isArray(approval) ||
    Object.entries(OPERATOR_TEST_BINDING).some(
      ([field, expected]) =>
        approval[field] !== expected ||
        (field !== "reference" && selection[field] !== expected),
    ) ||
    typeof selection.now !== "string" ||
    !Number.isFinite(Date.parse(selection.now)) ||
    Date.parse(selection.now) < Date.parse("2026-10-21T15:00:00.000Z") ||
    Date.parse(selection.now) > Date.parse("2026-10-22T15:00:00.000Z")
  )
    throw new Error("Invalid operator test approval or selection");
}

function validateSelection(selection, member, ticket, approvedOperatorTest = false) {
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
    !["paid", "partial", "unpaid"].includes(ticket?.payment?.status) ||
    !money(ticket?.payment?.totalAmount) ||
    (ticket.payment.totalAmount <= 0 && !approvedOperatorTest) ||
    !money(ticket?.payment?.paidAmount) ||
    !money(ticket?.payment?.outstandingAmount) ||
    ticket.payment.totalAmount !== ticket.payment.paidAmount + ticket.payment.outstandingAmount ||
    ticket.payment.refundedAmount !== 0 ||
    !ticket.payment.contractPayment ||
    ticket.payment.contractPayment.amount !== ticket.payment.paidAmount ||
    ticket.payment.contractPayment.unpaidAmount !== ticket.payment.outstandingAmount
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
