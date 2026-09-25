import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudioMateSignatureRequestPayload,
  buildStudioMateJoinContractPayload,
  executeStudioMateMembershipContract,
  MEMBERSHIP_CONTRACT_TEMPLATES,
  validateCreatedContractReadback,
} from "./studiomate-native-contract-writer.mjs";

const CONTRACT_ID = "c".repeat(64);

function fixture(action = "first_purchase_contract") {
  const expectedTemplate = MEMBERSHIP_CONTRACT_TEMPLATES[action];
  return {
    selection: {
      action,
      jobKey: `membership_contract_${"a".repeat(64)}`,
      studioId: "11",
      memberId: "22",
      userTicketId: "33",
      productId: "44",
      memberPhone: "01012345678",
      signExpirationDays: 7,
    },
    member: {
      memberId: "22",
      name: "Synthetic Member",
      phone: "01012345678",
      gender: "F",
      birthday: "2000-01-02",
    },
    ticket: {
      source: "studiomate_native_ticket",
      verified: true,
      complete: true,
      studioId: "11",
      memberId: "22",
      userTicketId: "33",
      productId: "44",
      title: "Synthetic 10 Class Pass",
      type: "C",
      availableClassType: "group",
      availabilityStartAt: "2026-09-15",
      expireAt: "2026-12-31",
      status: "active",
      active: true,
      usable: true,
      cancelled: false,
      refunded: false,
      isShared: false,
      maxCoupon: 10,
      remainingCoupon: 10,
      maxCancel: 2,
      payment: {
        verified: true,
        complete: true,
        status: "paid",
        totalAmount: 120000,
        paidAmount: 120000,
        outstandingAmount: 0,
        refundedAmount: 0,
        contractPayment: {
          cardAmount: 120000,
          cashAmount: 0,
          wireAmount: 0,
          pointAmount: 0,
          amount: 120000,
          unpaidAmount: 0,
          installmentPeriod: 3,
        },
      },
    },
    staff: { id: "55", name: "Synthetic Staff" },
    template: {
      id: expectedTemplate.id,
      title: expectedTemplate.title,
      category_id: 1,
      basic: {
        optional: [{ field_label: "Synthetic optional field" }],
        additional: { "Synthetic additional field": {} },
      },
    },
    terms: [
      {
        title: "Required synthetic term",
        contents: "Synthetic required contents",
        agree_type: "R",
        is_agree: false,
      },
      {
        title: "Optional synthetic term",
        contents: "Synthetic optional contents",
        agree_type: "S",
        is_agree: false,
      },
    ],
  };
}

function nativeContract(input, status, { centerSignaturePresent = true } = {}) {
  const payload = buildStudioMateJoinContractPayload(input);
  const requiredTicket = payload.join_user_tickets[0].required;
  return {
    id: CONTRACT_ID,
    studio_id: 11,
    selected_member_id: 22,
    category_id: 1,
    title: payload.title,
    status,
    created_at: "2026-09-14 12:00:00",
    updated_at: "2026-09-14 12:01:00",
    manager_signature: centerSignaturePresent
      ? { signature_data: { path: "/synthetic/center-signature.png" } }
      : null,
    contractor_signature:
      status === "complete"
        ? {
            signed_at: "2026-09-14 12:02:00",
            signature_data: { path: "/synthetic/member-signature.png" },
          }
        : null,
    field_values: {
      basic: { required: { name: input.member.name, mobile: input.member.phone } },
      join_user_tickets: [{ required: { ...requiredTicket } }],
    },
    term: payload.terms.map((term) => ({ ...term })),
  };
}

function claimedJournal(events) {
  return {
    claim: async (request) => {
      events.push(["claim", request]);
      return { status: "claimed", payloadHash: request.payloadHash };
    },
    stage: async (jobKey, stage, details) => {
      events.push(["stage", stage, jobKey, details]);
    },
  };
}

test("builds the exact native payload with verified IDs, template and no member consent", () => {
  const input = fixture();
  const payload = buildStudioMateJoinContractPayload(input);

  assert.deepEqual(payload, {
    category_id: 1,
    sign_type: 1,
    staff_name: "Synthetic Staff",
    staff_id: 55,
    sign_expiration_period: 7,
    title: MEMBERSHIP_CONTRACT_TEMPLATES.first_purchase_contract.title,
    contractor_member_id: 22,
    contractor_name: "Synthetic Member",
    contractor_mobile: "01012345678",
    basic: {
      required: {
        name: "Synthetic Member",
        mobile: "01012345678",
        gender: "F",
        birthday: "2000-01-02",
      },
      optional: [{ field_label: "Synthetic optional field", val: "" }],
      additional: [{ field_label: "Synthetic additional field", val: "" }],
    },
    join_user_tickets: [
      {
        required: {
          ticket_id: 44,
          user_ticket_id: 33,
          is_shared: false,
          title: "Synthetic 10 Class Pass",
          type: "C",
          available_class_type: "group",
          availability_start_at: "2026-09-15",
          expire_at: "2026-12-31",
          max_coupon: 10,
          remaining_coupon: 10,
          max_cancel: 2,
          card_amount: 120000,
          installment: 1,
          installment_period: 3,
          cash_amount: 0,
          wiretransfer_amount: 0,
          point_amount: 0,
          amount: 120000,
          unpaid_amount: 0,
        },
      },
    ],
    terms: [
      {
        title: "Required synthetic term",
        contents: "Synthetic required contents",
        agree_type: "R",
        is_agree: false,
      },
      {
        title: "Optional synthetic term",
        contents: "Synthetic optional contents",
        agree_type: "S",
        is_agree: false,
      },
    ],
  });
  assert.ok(payload.terms.every((term) => term.is_agree === false));

  const preAgreed = fixture();
  preAgreed.terms[0].is_agree = true;
  assert.throws(
    () => buildStudioMateJoinContractPayload(preAgreed),
    /missing or pre-agreed/,
  );
});

test("writes unpaid and partial balances into the contract without blocking creation", () => {
  const unpaid = fixture();
  Object.assign(unpaid.ticket.payment, {
    status: "unpaid",
    totalAmount: 398000,
    paidAmount: 0,
    outstandingAmount: 398000,
    contractPayment: {
      cardAmount: 0,
      cashAmount: 0,
      wireAmount: 0,
      pointAmount: 0,
      amount: 0,
      unpaidAmount: 398000,
      installmentPeriod: 0,
    },
  });
  const unpaidTicket = buildStudioMateJoinContractPayload(unpaid).join_user_tickets[0].required;
  assert.equal(unpaidTicket.amount, 0);
  assert.equal(unpaidTicket.unpaid_amount, 398000);

  const partial = fixture();
  Object.assign(partial.ticket.payment, {
    status: "partial",
    totalAmount: 398000,
    paidAmount: 100000,
    outstandingAmount: 298000,
    contractPayment: {
      cardAmount: 100000,
      cashAmount: 0,
      wireAmount: 0,
      pointAmount: 0,
      amount: 100000,
      unpaidAmount: 298000,
      installmentPeriod: 0,
    },
  });
  const partialTicket = buildStudioMateJoinContractPayload(partial).join_user_tickets[0].required;
  assert.equal(partialTicket.amount, 100000);
  assert.equal(partialTicket.unpaid_amount, 298000);
});

test("builds the native signature message only from an exact prepared binding", () => {
  assert.deepEqual(
    buildStudioMateSignatureRequestPayload({
      prepared: {
        contract_id_hash: CONTRACT_ID,
        contractor_name: "Synthetic Member",
        studio_name: "Synthetic Studio",
        contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}`,
      },
      contractId: CONTRACT_ID,
      memberName: "Synthetic Member",
    }),
    {
      title: "전자계약서가 도착했습니다.",
      message: `[Synthetic Studio] 안녕하세요, 'Synthetic Member'님. 전자계약서 링크 입니다.\nhttps://sign.studiomate.kr/${CONTRACT_ID}`,
      status: "draft",
      is_message: false,
      filter: {},
    },
  );
  assert.throws(
    () =>
      buildStudioMateSignatureRequestPayload({
        prepared: {
          contract_id_hash: "d".repeat(64),
          contractor_name: "Synthetic Member",
          contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}`,
        },
        contractId: CONTRACT_ID,
        memberName: "Synthetic Member",
      }),
    /binding is invalid/,
  );
});

test("claims before create POST and completes both native signature request steps", async () => {
  const input = fixture();
  const events = [];
  let reads = 0;
  const api = {
    post: async (pathname, body) => {
      events.push(["post", pathname, body]);
      if (pathname === "/v2/staff/contract/join") return { id: CONTRACT_ID };
      if (pathname === `/v2/staff/contract/signature/request/${CONTRACT_ID}`)
        return {
          contract_id_hash: CONTRACT_ID,
          contractor_name: input.member.name,
          studio_name: "Synthetic Studio",
          contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}`,
        };
      if (pathname === `/v2/staff/contract/signature/request/sms/${CONTRACT_ID}`)
        return { success: true };
      throw new Error(`Unexpected synthetic POST: ${pathname}`);
    },
    get: async (pathname) => {
      events.push(["get", pathname]);
      return nativeContract(input, reads++ === 0 ? "draft" : "waiting");
    },
  };

  const result = await executeStudioMateMembershipContract({
    ...input,
    api,
    journal: claimedJournal(events),
  });

  assert.deepEqual(result, {
    status: "waiting",
    reason: "native_signature_request_verified",
    contractId: CONTRACT_ID,
  });
  assert.ok(events.findIndex(([kind]) => kind === "claim") < events.findIndex(([kind]) => kind === "post"));
  const posts = events.filter(([kind]) => kind === "post");
  assert.deepEqual(
    posts.map(([, pathname]) => pathname),
    [
      "/v2/staff/contract/join",
      `/v2/staff/contract/signature/request/${CONTRACT_ID}`,
      `/v2/staff/contract/signature/request/sms/${CONTRACT_ID}`,
    ],
  );
  assert.ok(posts[0][2].terms.every((term) => term.is_agree === false));
  assert.deepEqual(posts[2][2], {
    title: "전자계약서가 도착했습니다.",
    message: `[Synthetic Studio] 안녕하세요, 'Synthetic Member'님. 전자계약서 링크 입니다.\nhttps://sign.studiomate.kr/${CONTRACT_ID}`,
    status: "draft",
    is_message: false,
    filter: {},
  });
});

test("an ambiguous create is retained and never retried automatically", async () => {
  const input = fixture();
  let payloadHash = "";
  let claims = 0;
  let posts = 0;
  const stages = [];
  const journal = {
    claim: async (request) => {
      payloadHash ||= request.payloadHash;
      claims++;
      return {
        status: claims === 1 ? "claimed" : "resume",
        payloadHash,
      };
    },
    stage: async (_jobKey, stage, details) => stages.push([stage, details]),
  };
  const api = {
    post: async () => {
      posts++;
      throw new Error("synthetic unknown write result");
    },
    get: async () => {
      throw new Error("readback must not run without a contract ID");
    },
  };

  const first = await executeStudioMateMembershipContract({ ...input, api, journal });
  const second = await executeStudioMateMembershipContract({ ...input, api, journal });

  assert.deepEqual(first, { status: "review", reason: "contract_create_outcome_unknown" });
  assert.deepEqual(second, { status: "review", reason: "ambiguous_create_must_not_retry" });
  assert.equal(posts, 1);
  assert.deepEqual(
    stages.map(([stage]) => stage),
    ["attempting_create", "unknown"],
  );
});

test("an ambiguous signature message is not sent again on resume", async () => {
  const input = fixture();
  let posts = 0;
  const api = {
    post: async () => {
      posts++;
      assert.fail("resume after an ambiguous message must not POST again");
    },
    get: async () => nativeContract(input, "draft"),
  };
  const journal = {
    claim: async (request) => ({
      status: "resume",
      payloadHash: request.payloadHash,
      contractId: CONTRACT_ID,
      stage: "attempting_signature_message",
    }),
    stage: async () => {},
  };

  const result = await executeStudioMateMembershipContract({
    ...input,
    api,
    journal,
  });
  assert.deepEqual(result, {
    status: "review",
    reason: "signature_message_outcome_unknown",
    contractId: CONTRACT_ID,
  });
  assert.equal(posts, 0);
});

test("a complete duplicate claim produces no API write or read", async () => {
  const input = fixture("renewal_purchase_confirmation");
  let apiCalls = 0;
  const api = {
    post: async () => apiCalls++,
    get: async () => apiCalls++,
  };
  const journal = {
    claim: async () => ({ status: "complete", contractId: CONTRACT_ID }),
    stage: async () => assert.fail("complete claim must not be staged"),
  };

  const result = await executeStudioMateMembershipContract({ ...input, api, journal });
  assert.deepEqual(result, {
    status: "existing",
    reason: "contract_job_already_complete",
    contractId: CONTRACT_ID,
  });
  assert.equal(apiCalls, 0);
});

test("preflight/readback rejects changed native bindings", () => {
  const input = fixture();
  const payload = buildStudioMateJoinContractPayload(input);
  const exact = validateCreatedContractReadback(
    nativeContract(input, "draft"),
    input.selection,
    payload,
    CONTRACT_ID,
  );
  assert.equal(exact.ok, true);
  assert.equal(exact.detail.centerSignaturePresent, true);

  const wrongRecipient = nativeContract(input, "draft");
  wrongRecipient.field_values.basic.required.mobile = "01099999999";
  assert.deepEqual(
    validateCreatedContractReadback(
      wrongRecipient,
      input.selection,
      payload,
      CONTRACT_ID,
    ),
    { ok: false, reason: "contract_recipient_mismatch", detail: null },
  );

  const wrongTicket = nativeContract(input, "draft");
  wrongTicket.field_values.join_user_tickets[0].required.ticket_id = 45;
  assert.deepEqual(
    validateCreatedContractReadback(wrongTicket, input.selection, payload, CONTRACT_ID),
    { ok: false, reason: "contract_ticket_mismatch", detail: null },
  );
});

test("signature request readback requires both sent state and retained center seal", async () => {
  for (const scenario of [
    {
      status: "draft",
      centerSignaturePresent: true,
      reason: "signature_request_outcome_unknown",
    },
    {
      status: "waiting",
      centerSignaturePresent: false,
      reason: "center_signature_missing_after_request",
    },
  ]) {
    const input = fixture();
    let reads = 0;
    const api = {
      post: async (pathname) => {
        if (pathname === "/v2/staff/contract/join") return { id: CONTRACT_ID };
        if (pathname === `/v2/staff/contract/signature/request/${CONTRACT_ID}`)
          return {
            contract_id_hash: CONTRACT_ID,
            contractor_name: input.member.name,
            studio_name: "Synthetic Studio",
            contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}`,
          };
        return { success: true };
      },
      get: async () =>
        reads++ === 0
          ? nativeContract(input, "draft")
          : nativeContract(input, scenario.status, {
              centerSignaturePresent: scenario.centerSignaturePresent,
            }),
    };
    const result = await executeStudioMateMembershipContract({
      ...input,
      api,
      journal: claimedJournal([]),
    });
    assert.equal(result.status, "review");
    assert.equal(result.reason, scenario.reason);
    assert.equal(result.contractId, CONTRACT_ID);
  }
});
