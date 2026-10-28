import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { firestoreJournal } from "./studiomate-membership-contract-processor.mjs";
import {
  buildStudioMateSignatureRequestPayload,
  buildStudioMateJoinContractPayload,
  executeStudioMateMembershipContract as executeWithClock,
  MEMBERSHIP_CONTRACT_TEMPLATES,
  validateCreatedContractReadback,
} from "./studiomate-native-contract-writer.mjs";

const CONTRACT_ID = "c".repeat(64);
const dayClock = () => Date.parse("2026-10-22T01:00:00.000Z");
const executeStudioMateMembershipContract = input => executeWithClock({ now: dayClock, ...input });

test("revoked maintenance approval stops before a claim", async () => {
  const result = await executeStudioMateMembershipContract({ ...fixture(),
    authorizeDispatch: async () => { throw Object.assign(new Error("revoked"), { code: "contract_dispatch_authorization_paused" }); },
    journal: { claim: () => assert.fail("no claim") }, api: { post: () => assert.fail("no POST") } });
  assert.equal(result.reason, "signature_recovery_approval_unavailable");
});

test("approval expiry across each journal await preserves the unsent checkpoint without replay", async t => {
  for (const crossing of ["attempting_create", "attempting_signature_request", "attempting_signature_message"]) {
    await t.test(crossing, async () => {
      const input = fixture(); let paused = false, saved;
      const posts = [];
      const result = await executeStudioMateMembershipContract({ ...input,
        authorizeDispatch: async () => { if (paused) throw Object.assign(new Error("expired"), { code: "contract_dispatch_authorization_paused" }); },
        journal: { claim: async ({ payloadHash }) => ({ status: "claimed", payloadHash }),
          stage: async (_key, stage, fields) => { saved = { stage, ...fields }; if (stage === crossing) paused = true; } },
        api: { get: async () => nativeContract(input, "draft"), post: async url => {
          posts.push(url);
          if (url.endsWith("/join")) return { id: CONTRACT_ID };
          if (url.endsWith(`/request/${CONTRACT_ID}`)) return { contract_id_hash: CONTRACT_ID,
            contractor_name: input.member.name, contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}` };
          assert.fail("must not send");
        } } });
      assert.equal(result.reason, "signature_recovery_approval_unavailable");
      assert.ok(!saved.stage.startsWith("attempting_"));
      assert.equal(saved.reason, "signature_recovery_approval_unavailable");
      assert.equal(posts.some(url => url.includes("/sms/")), false);
      assert.equal(posts.length, ["attempting_create", "attempting_signature_request", "attempting_signature_message"].indexOf(crossing));
    });
  }
});

test("quiet boundaries reject before journal/API access even with historical daytime operator approval", async () => {
  for (const time of ["2026-10-22T14:00:00.000Z", "2026-10-22T15:00:00.000Z", "2026-10-22T23:59:59.999Z"]) {
    for (const input of [fixture(), operatorTestFixture()]) {
      const result = await executeStudioMateMembershipContract({ ...input, now: () => Date.parse(time),
        api: { get: () => assert.fail("quiet read"), post: () => assert.fail("quiet POST") },
        journal: { claim: () => assert.fail("quiet claim"), stage: () => assert.fail("quiet stage") } });
      assert.equal(result.status, "deferred");
      assert.equal(result.jobKey, input.selection.jobKey);
      assert.equal(result.nextAllowedAt, "2026-10-23T00:00:00.000Z");
    }
  }
});

test("crossing 23:00 at a journal await restores only a proven unsent stage and resumes without replay", async t => {
  for (const crossing of ["attempting_create", "attempting_signature_request", "signature_prepared", "attempting_signature_message"]) {
    await t.test(crossing, async () => {
      const input = fixture();
      let clock = Date.parse("2026-10-22T13:59:59.999Z"), saved, sent = false, crossed = false;
      const posts = [];
      const journal = {
        claim: async ({payloadHash}) => saved ? { ...saved, status: "resume" } :
          (saved = { payloadHash, status: "claimed", stage: "claimed" }),
        stage: async (_key, stage, fields) => {
          saved = { ...saved, ...fields, stage };
          if (!crossed && stage === crossing) { crossed = true; clock = Date.parse("2026-10-22T14:00:00.000Z"); }
        },
      };
      const api = {
        get: async () => nativeContract(input, sent ? "waiting" : "draft"),
        post: async url => {
          assert.ok(clock < Date.parse("2026-10-22T14:00:00.000Z") || clock >= Date.parse("2026-10-23T00:00:00.000Z"));
          posts.push(url);
          if (url.endsWith("/join")) return {id: CONTRACT_ID};
          if (url.endsWith(`/request/${CONTRACT_ID}`)) return {contract_id_hash:CONTRACT_ID,
            contractor_name:input.member.name,contract_link:`https://sign.studiomate.kr/${CONTRACT_ID}`};
          sent = true; return {};
        },
      };
      const run = () => executeStudioMateMembershipContract({...input,api,journal,now:()=>clock});
      assert.equal((await run()).status, "deferred");
      assert.ok(!saved.stage.startsWith("attempting_"));
      assert.equal(saved.reason, null);
      assert.equal(posts.some(url=>url.includes("/sms/")), false);
      const snapshot = structuredClone(saved);
      assert.equal((await run()).status, "deferred");
      assert.deepEqual(saved, snapshot);
      clock = Date.parse("2026-10-23T00:00:00.000Z");
      assert.equal((await run()).status, "waiting");
      assert.equal(posts.filter(url=>url.endsWith("/join")).length, 1);
      assert.equal(posts.filter(url=>url.endsWith(`/request/${CONTRACT_ID}`)).length, 1);
      assert.equal(posts.filter(url=>url.includes("/sms/")).length, 1);
    });
  }
});

test("old no-ID resume and tampered persisted preparation never POST", async () => {
  const input = fixture();
  for (const stage of ["claimed", "attempting_create", "unknown"]) {
    const result = await executeStudioMateMembershipContract({...input,
      journal:{claim:async ({payloadHash})=>({status:"resume",payloadHash,stage}),stage:()=>assert.fail("no stage")},
      api:{post:()=>assert.fail("no replay")}});
    assert.equal(result.reason,"ambiguous_create_must_not_retry");
  }
  const preparedPayload=JSON.stringify({contract_id_hash:CONTRACT_ID,contractor_name:"Other Member",
    contract_link:`https://sign.studiomate.kr/${CONTRACT_ID}`});
  await assert.rejects(executeStudioMateMembershipContract({...input,
    journal:{claim:async ({payloadHash})=>({status:"resume",payloadHash,stage:"signature_prepared",contractId:CONTRACT_ID,preparedPayload}),stage:()=>assert.fail("no stage")},
    api:{get:async()=>nativeContract(input,"draft"),post:()=>assert.fail("no POST")}}),/binding is invalid/);
});

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

function operatorTestFixture() {
  const input = fixture("renewal_purchase_confirmation");
  const binding = {
    studioId: "5330",
    memberId: "1982133",
    userTicketId: "10277817",
    productId: "191164",
  };
  Object.assign(input.selection, binding, {
    now: "2026-10-22T03:00:00.000Z",
    jobKey: `membership_contract_${createHash("sha256").update(JSON.stringify([
      "studiomate-renewal-operator-test-v1", "1982133", "10277817", "20261022",
    ])).digest("hex")}`,
  });
  input.member.memberId = binding.memberId;
  Object.assign(input.ticket, binding);
  input.template.basic.additional = [
    { field_label: "구매조건 상세" },
    { field_label: "Synthetic additional field" },
  ];
  input.operatorTestApproval = {
    reference: "user_october_renewal_test_20261022",
    ...binding,
    action: input.selection.action,
    jobKey: input.selection.jobKey,
  };
  return input;
}

test("operator test has a deterministic label without changing native purchase facts or consent", () => {
  const input = operatorTestFixture();
  const before = structuredClone(input);
  const normal = buildStudioMateJoinContractPayload({ ...input, operatorTestApproval: undefined });
  const payload = buildStudioMateJoinContractPayload(input);
  assert.equal(payload.title, "(테스트) 아카이브 재등록");
  assert.deepEqual(payload.basic.additional, [
    {
      field_label: "구매조건 상세",
      val: "운영자 테스트 전용 문서입니다. 신규 구매나 결제를 생성하지 않으며, 회원 동의로 간주되지 않고 회원 동의나 서명을 대신하지 않습니다. 기존 실제 수강권의 금액과 이용기간을 그대로 표시합니다.",
    },
    { field_label: "Synthetic additional field", val: "" },
  ]);
  assert.ok(payload.terms.every((term) => term.is_agree === false));
  assert.equal(Object.hasOwn(payload, "contractor_signature"), false);
  assert.equal(Object.hasOwn(payload, "manager_signature"), false);
  assert.deepEqual(payload.join_user_tickets, normal.join_user_tickets);
  assert.deepEqual({
    ...payload,
    title: normal.title,
    basic: { ...payload.basic, additional: normal.basic.additional },
  }, normal);
  assert.equal(JSON.stringify(payload), JSON.stringify(buildStudioMateJoinContractPayload(input)));
  assert.deepEqual(input, before);
});

test("omitted or undefined operator approval preserves normal payload bytes for both actions", () => {
  for (const input of [fixture(), fixture("renewal_purchase_confirmation"), operatorTestFixture()]) {
    delete input.operatorTestApproval;
    const normal = buildStudioMateJoinContractPayload(input);
    assert.equal(normal.title, MEMBERSHIP_CONTRACT_TEMPLATES[input.selection.action].title);
    assert.ok(normal.basic.additional.every((field) => field.val === ""));
    assert.equal(JSON.stringify(normal), JSON.stringify(buildStudioMateJoinContractPayload({
      ...input, operatorTestApproval: undefined,
    })));
  }
});

test("operator test rejects wrong selection bindings even when approval matches the changed selection", async (t) => {
  for (const [field, value] of [
    ["studioId", "5331"], ["memberId", "1982134"], ["userTicketId", "10277818"],
    ["productId", "191165"], ["action", "first_purchase_contract"],
    ["jobKey", `membership_contract_${"b".repeat(64)}`],
  ]) {
    await t.test(field, () => {
      const input = operatorTestFixture();
      input.selection[field] = value;
      input.operatorTestApproval[field] = value;
      if (Object.hasOwn(input.ticket, field)) input.ticket[field] = value;
      if (field === "memberId") input.member.memberId = value;
      if (field === "action") Object.assign(input.template, MEMBERSHIP_CONTRACT_TEMPLATES[value]);
      assert.throws(() => buildStudioMateJoinContractPayload(input), /Invalid operator test/);
    });
  }
});

test("operator test requires every exact approval field and rejects absent or malformed approvals", async (t) => {
  for (const field of Object.keys(operatorTestFixture().operatorTestApproval)) {
    await t.test(field, () => {
      const input = operatorTestFixture();
      input.operatorTestApproval[field] = "wrong";
      assert.throws(() => buildStudioMateJoinContractPayload(input), /Invalid operator test/);
      delete input.operatorTestApproval[field];
      assert.throws(() => buildStudioMateJoinContractPayload(input), /Invalid operator test/);
    });
  }
  for (const approval of [null, false, "approved", []]) {
    assert.throws(() => buildStudioMateJoinContractPayload({
      ...operatorTestFixture(), operatorTestApproval: approval,
    }), /Invalid operator test/);
  }
});

test("operator test time window includes only the requested selection time boundaries", () => {
  for (const now of ["2026-10-21T15:00:00.000Z", "2026-10-22T15:00:00.000Z"]) {
    const input = operatorTestFixture();
    input.selection.now = now;
    assert.equal(buildStudioMateJoinContractPayload(input).title, "(테스트) 아카이브 재등록");
  }
  for (const now of [
    "2026-10-21T14:59:59.999Z", "2026-10-22T15:00:00.001Z",
    "invalid", undefined, null, Date.parse("2026-10-22T03:00:00.000Z"),
  ]) {
    const input = operatorTestFixture();
    input.selection.now = now;
    assert.throws(() => buildStudioMateJoinContractPayload(input), /Invalid operator test/);
  }
});

test("operator test requires exactly one active purchase detail field and supports native object fields", () => {
  for (const additional of [undefined, {}, [],
    [{ field_label: "Other" }], [{ field_label: "구매조건 상세", is_active: false }],
    [{ field_label: "구매조건 상세" }, { label: "구매조건 상세" }],
  ]) {
    const input = operatorTestFixture();
    input.template.basic.additional = additional;
    assert.throws(() => buildStudioMateJoinContractPayload(input), /exactly one active 구매조건 상세/);
  }
  const input = operatorTestFixture();
  input.template.basic.additional = { "구매조건 상세": {} };
  assert.equal(buildStudioMateJoinContractPayload(input).basic.additional[0].val,
    buildStudioMateJoinContractPayload(operatorTestFixture()).basic.additional[0].val);
});

test("renewal title changes without changing the template ID, issuance key or purchase fields", () => {
  const input = fixture("renewal_purchase_confirmation");
  const payload = buildStudioMateJoinContractPayload(input);
  assert.deepEqual(MEMBERSHIP_CONTRACT_TEMPLATES.renewal_purchase_confirmation, {
    id: "1341", title: "아카이브 재등록",
  });
  assert.equal(payload.title, "아카이브 재등록");
  assert.equal(input.selection.jobKey, `membership_contract_${"a".repeat(64)}`);
  const firstPurchase = buildStudioMateJoinContractPayload(fixture());
  assert.equal(firstPurchase.title, "아카이브 회원가입");
  assert.equal(MEMBERSHIP_CONTRACT_TEMPLATES.first_purchase_contract.id, "608");
  assert.deepEqual({ ...payload, title: firstPurchase.title }, firstPurchase);
});

test("renewal template title mismatch stays blocked after the rename", () => {
  const input = fixture("renewal_purchase_confirmation");
  input.template.title = "아카이브 재등록 구매조건 확인";
  assert.throws(() => buildStudioMateJoinContractPayload(input), /Unexpected StudioMate contract template/);
});

test("old-title renewal journals remain unchanged and never replay after a title mismatch", async (t) => {
  for (const stage of ["complete", "created", "signature_requested"]) {
    await t.test(stage, async () => {
      const input = fixture("renewal_purchase_confirmation");
      const oldPayload = { ...buildStudioMateJoinContractPayload(input), title: "아카이브 재등록 구매조건 확인" };
      const saved = {
        payloadHash: createHash("sha256").update(JSON.stringify(oldPayload)).digest("hex"),
        stage, contractId: CONTRACT_ID,
      };
      const original = structuredClone(saved);
      const ref = { set: async () => assert.fail("old journal must not be rewritten") };
      const db = {
        collection: (name) => {
          assert.equal(name, "studiomateMembershipContractJobs");
          return { doc: (id) => { assert.equal(id, input.selection.jobKey); return ref; } };
        },
        runTransaction: async (callback) => callback({
          get: async (target) => { assert.equal(target, ref); return { exists: true, data: () => saved }; },
          create: () => assert.fail("old issuance must not create another claim"),
        }),
      };
      const api = {
        get: async () => assert.fail("old-title mismatch must stop before provider calls"),
        post: async () => assert.fail("old-title mismatch must never recreate or resend"),
      };
      assert.deepEqual(await executeStudioMateMembershipContract({ ...input, api, journal: firestoreJournal(db, null, dayClock) }), {
        status: "review", reason: "job_payload_mismatch",
      });
      assert.deepEqual(saved, original);
    });
  }
});

function nativeContract(input, status, { centerSignaturePresent = true } = {}) {
  const payload = buildStudioMateJoinContractPayload(input);
  const requiredTicket = payload.join_user_tickets[0].required;
  return {
    id: CONTRACT_ID,
    studio_id: Number(input.selection.studioId),
    selected_member_id: Number(input.selection.memberId),
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

test("execute forwards operator approval and retains native readback and signature request flow", async () => {
  const input = operatorTestFixture();
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
      assert.equal(pathname, `/v2/staff/contract/signature/request/sms/${CONTRACT_ID}`);
      return { success: true };
    },
    get: async () => nativeContract(input, reads++ === 0 ? "draft" : "waiting"),
  };
  const result = await executeStudioMateMembershipContract({ ...input, api, journal: claimedJournal(events) });
  assert.deepEqual(result, {
    status: "waiting", reason: "native_signature_request_verified", contractId: CONTRACT_ID,
  });
  const posts = events.filter(([kind]) => kind === "post");
  assert.equal(posts.length, 3);
  assert.deepEqual(posts[0][2], buildStudioMateJoinContractPayload(input));
  assert.equal(posts[0][2].title, "(테스트) 아카이브 재등록");
  assert.ok(posts[0][2].terms.every((term) => term.is_agree === false));
  assert.equal(events[0][0], "claim");
  assert.equal(events[0][1].jobKey, input.selection.jobKey);
  assert.equal(events[0][1].payloadHash,
    createHash("sha256").update(JSON.stringify(posts[0][2])).digest("hex"));
});

test("execute rejects invalid operator approval before any journal or API access", async () => {
  const input = operatorTestFixture();
  input.operatorTestApproval.reference = "wrong";
  await assert.rejects(executeStudioMateMembershipContract({
    ...input,
    journal: { claim: async () => assert.fail("invalid approval must not claim") },
    api: {
      get: async () => assert.fail("invalid approval must not read"),
      post: async () => assert.fail("invalid approval must not write"),
    },
  }), /Invalid operator test/);
});

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

test("recovery claim persistence failures reject before any native API call", async (t) => {
  for (const failureAt of ["create", "commit"]) {
    await t.test(failureAt, async () => {
      const input = fixture();
      input.selection.now = "2026-09-30T00:00:00.000Z";
      const approval = {
        reference: "synthetic-operator-approval",
        memberId: input.member.memberId,
        userTicketId: input.ticket.userTicketId,
        originalMaxIssuanceAgeMs: null,
        approvedRecoveryMaxAgeMs: 7 * 86400000,
      };
      const failure = new Error(`Synthetic transaction ${failureAt} failure`);
      let creates = 0;
      let posts = 0;
      let reads = 0;
      const ref = { set: async () => assert.fail("failed claim must not be staged") };
      const db = {
        collection: (name) => {
          assert.equal(name, "studiomateMembershipContractJobs");
          return { doc: (id) => {
            assert.equal(id, input.selection.jobKey);
            return ref;
          } };
        },
        runTransaction: async (callback) => {
          await callback({
            get: async (target) => {
              assert.equal(target, ref);
              return { exists: false };
            },
            create: (target, data) => {
              creates++;
              assert.equal(target, ref);
              assert.deepEqual(data.recoveryApproval, approval);
              if (failureAt === "create") throw failure;
            },
          });
          throw failure;
        },
      };
      const api = {
        post: async () => { posts++; throw new Error("Unexpected native POST"); },
        get: async () => { reads++; throw new Error("Unexpected native GET"); },
      };

      await assert.rejects(
        executeStudioMateMembershipContract({ ...input, api, journal: firestoreJournal(db, approval, dayClock) }),
        (error) => error === failure,
      );
      assert.equal(creates, 1);
      assert.equal(posts, 0);
      assert.equal(reads, 0);
    });
  }
});

test("recovery approval is committed with the initial claim before native writes", async () => {
  const input = fixture();
  input.selection.now = "2026-09-30T00:00:00.000Z";
  const approval = {
    reference: "synthetic-operator-approval",
    memberId: input.member.memberId,
    userTicketId: input.ticket.userTicketId,
    originalMaxIssuanceAgeMs: null,
    approvedRecoveryMaxAgeMs: 7 * 86400000,
  };
  let committed = null;
  let creates = 0;
  const posts = [];
  const ref = {
    set: async (fields, options) => {
      assert.ok(committed, "staging must wait for the claim commit");
      assert.deepEqual(options, { merge: true });
      committed = { ...committed, ...fields };
    },
  };
  const db = {
    collection: (name) => {
      assert.equal(name, "studiomateMembershipContractJobs");
      return { doc: (id) => {
        assert.equal(id, input.selection.jobKey);
        return ref;
      } };
    },
    runTransaction: async (callback) => {
      let pending = null;
      const result = await callback({
        get: async (target) => {
          assert.equal(target, ref);
          return { exists: false };
        },
        create: (target, data) => {
          creates++;
          assert.equal(target, ref);
          assert.equal(data.stage, "claimed");
          assert.deepEqual(data.recoveryApproval, approval);
          assert.deepEqual(posts, []);
          pending = structuredClone(data);
        },
      });
      assert.deepEqual(posts, [], "native writes must wait for transaction commit");
      committed = pending;
      return result;
    },
  };
  const api = {
    post: async (pathname) => {
      assert.deepEqual(committed?.recoveryApproval, approval);
      assert.equal(committed.jobKey, input.selection.jobKey);
      posts.push(pathname);
      assert.equal(pathname, "/v2/staff/contract/join");
      return { id: CONTRACT_ID };
    },
    get: async () => nativeContract(input, "waiting"),
  };

  const result = await executeStudioMateMembershipContract({
    ...input, api, journal: firestoreJournal(db, approval, dayClock),
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.contractId, CONTRACT_ID);
  assert.equal(creates, 1);
  assert.deepEqual(posts, ["/v2/staff/contract/join"]);
  assert.deepEqual(committed.recoveryApproval, approval);
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

test("persisted review reasons prevent replay after an uncertain first request", async (t) => {
  for (const reason of [
    "signature_message_outcome_unknown",
    "signature_request_outcome_unknown",
    "signature_request_prepare_outcome_unknown",
    "signature_request_prepare_binding_invalid",
  ]) {
    await t.test(reason, async () => {
      const input = fixture();
      let saved = null;
      const posts = [];
      const claims = [];
      const journal = {
        claim: async ({ jobKey, payloadHash }) => {
          const status = saved ? "resume" : "claimed";
          saved ||= { jobKey, payloadHash, stage: "claimed" };
          assert.equal(jobKey, saved.jobKey);
          assert.equal(payloadHash, saved.payloadHash);
          const claim = { ...saved, status };
          claims.push(claim);
          return claim;
        },
        stage: async (jobKey, stage, fields = {}) => {
          assert.equal(jobKey, saved.jobKey);
          saved = { ...saved, stage, ...fields };
        },
      };
      const api = {
        post: async (pathname) => {
          posts.push(pathname);
          if (pathname === "/v2/staff/contract/join") return { id: CONTRACT_ID };
          if (pathname === `/v2/staff/contract/signature/request/${CONTRACT_ID}`) {
            if (reason === "signature_request_prepare_outcome_unknown")
              throw new Error("Synthetic preparation response lost");
            return {
              contract_id_hash: reason === "signature_request_prepare_binding_invalid"
                ? "d".repeat(64)
                : CONTRACT_ID,
              contractor_name: input.member.name,
              studio_name: "Synthetic Studio",
              contract_link: `https://sign.studiomate.kr/${CONTRACT_ID}`,
            };
          }
          if (pathname === `/v2/staff/contract/signature/request/sms/${CONTRACT_ID}`) {
            if (reason === "signature_message_outcome_unknown")
              throw new Error("Synthetic send response lost");
            return { success: true };
          }
          throw new Error(`Unexpected synthetic POST: ${pathname}`);
        },
        get: async () => nativeContract(input, "draft"),
      };

      const first = await executeStudioMateMembershipContract({ ...input, api, journal });
      assert.deepEqual(first, { status: "review", reason, contractId: CONTRACT_ID });
      assert.equal(saved.stage, "review");
      assert.equal(saved.reason, reason);
      assert.equal(saved.contractId, CONTRACT_ID);
      const expectedPosts = [
        "/v2/staff/contract/join",
        `/v2/staff/contract/signature/request/${CONTRACT_ID}`,
      ];
      if (!reason.startsWith("signature_request_prepare_"))
        expectedPosts.push(`/v2/staff/contract/signature/request/sms/${CONTRACT_ID}`);
      assert.deepEqual(posts, expectedPosts);

      const second = await executeStudioMateMembershipContract({ ...input, api, journal });
      assert.equal(second.status, "review");
      assert.equal(second.contractId, CONTRACT_ID);
      assert.equal(claims.length, 2);
      assert.equal(claims[1].status, "resume");
      assert.equal(claims[1].stage, "review");
      assert.equal(claims[1].reason, reason);
      assert.deepEqual(posts, expectedPosts, "resume must not create, prepare or send again");
    });
  }
});

test("an interrupted signature preparation is not replayed on resume", async () => {
  const input = fixture();
  const posts = [];
  const api = {
    post: async (pathname) => {
      posts.push(pathname);
      throw new Error("Unexpected synthetic POST after interrupted preparation");
    },
    get: async () => nativeContract(input, "draft"),
  };
  const journal = {
    claim: async ({ payloadHash }) => ({
      status: "resume",
      payloadHash,
      contractId: CONTRACT_ID,
      stage: "attempting_signature_request",
    }),
    stage: async () => {},
  };

  const result = await executeStudioMateMembershipContract({ ...input, api, journal });
  assert.equal(result.status, "review");
  assert.equal(result.contractId, CONTRACT_ID);
  assert.deepEqual(posts, []);
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

test("readback rejects a different or missing issuance with otherwise identical purchase fields", () => {
  const input = fixture();
  const payload = buildStudioMateJoinContractPayload(input);
  for (const userTicketId of [34, undefined]) {
    const contract = nativeContract(input, "draft");
    const required = contract.field_values.join_user_tickets[0].required;
    if (userTicketId === undefined) delete required.user_ticket_id;
    else required.user_ticket_id = userTicketId;

    assert.deepEqual(
      validateCreatedContractReadback(contract, input.selection, payload, CONTRACT_ID),
      { ok: false, reason: "contract_ticket_mismatch", detail: null },
    );
  }
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
