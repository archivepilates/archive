import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { membershipContractJobKey } from "./studiomate-membership-contract-policy.mjs";
import {
  MEMBERSHIP_WELCOME_TEMPLATE as spec,
  membershipWelcomeKey,
  membershipWelcomeTemplateIssue,
  planMembershipContractWelcome,
} from "./studiomate-membership-welcome.mjs";

const PHONE = "01012345678";
const STUDIO = "studio-synthetic-1";
const LEGACY_TEMPLATE_IDS = [
  "KA01TP260513132546184k4RpQF0exqz",
  "KA01TP260514081318309wQGfeIJxIAJ",
  "KA01TP260602101939427lPhGyuDLvFM",
];

function approvedTemplate() {
  return {
    ...structuredClone(spec),
    templateId: spec.templateId,
    status: "APPROVED",
  };
}

function fixture() {
  const observed = "2026-09-14T03:00:00.000Z";
  const selection = {
    now: observed,
    member: {
      memberId: "100",
      identityVerified: true,
      classification: "member",
    },
    ticket: {
      memberId: "100",
      userTicketId: "200",
      productId: "300",
      identityVerified: true,
      classification: "regular",
      status: "active",
      refunded: false,
      cancelled: false,
      issuedAt: "2026-09-14T02:30:00.000Z",
      source: {
        kind: "studiomate_member_excel",
        verified: true,
        complete: true,
        capturedAt: "2026-09-14T02:50:00.000Z",
      },
      payment: {
        verified: true,
        complete: true,
        status: "paid",
        totalAmount: 100000,
        paidAmount: 100000,
        outstandingAmount: 0,
        refundedAmount: 0,
        transactions: [
          {
            paymentId: "synthetic-payment",
            method: "card",
            status: "paid",
            amount: 100000,
            paidAt: "2026-09-14T02:31:00.000Z",
          },
        ],
      },
    },
    policy: {
      regularProductIds: ["300"],
      termsVersion: "v1",
      cutoverAt: "2026-09-14T00:00:00.000Z",
      maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
    history: {
      previousIssuanceIds: [],
      currentIssuanceIds: ["200"],
      baselineCapturedAt: "2026-09-14T02:00:00.000Z",
      purchases: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: observed,
        priorRegularIssuanceIds: [],
      },
      contracts: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: observed,
        records: [],
      },
    },
  };
  return {
    selection,
    now: "2026-09-14T04:00:00.000Z",
    template: approvedTemplate(),
    completion: {
      source: "studiomate_native_contract",
      authoritative: true,
      contractId: "synthetic-contract",
      studioId: STUDIO,
      memberPhone: PHONE,
      currentPhone: PHONE,
      memberId: "100",
      userTicketId: "200",
      productId: "300",
      contractAction: "first_purchase_contract",
      selectionJobKey: membershipContractJobKey("100", "200"),
      checkedAt: "2026-09-14T03:55:00.000Z",
      signedAt: "2026-09-14T03:50:00.000Z",
      memberClassification: "member",
      ticketClassification: "regular",
      currentRecipientEligible: true,
      identityVerified: true,
      nativePhoneMatchCount: 1,
      refunded: false,
      cancelled: false,
      ticketStatus: "active",
      paymentStatus: "paid",
      paidAmount: 100000,
      outstandingAmount: 0,
      status: "signed",
      memberSigned: true,
      centerSigned: true,
    },
    history: {
      authoritative: true,
      complete: true,
      allVersions: true,
      allTime: true,
      memberAliasesComplete: true,
      providerComplete: true,
      studioId: STUDIO,
      phone: PHONE,
      checkedAt: "2026-09-14T03:56:00.000Z",
      records: [],
    },
  };
}

test("verified first signed regular contract produces only a non-sendable intent", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = assertStaged(input, {
    status: "ready",
    reason: "first_regular_contract_signed",
    ready: true,
  });
  assert.equal(result.intent.templateCode, spec.templateId);
  assert.equal(result.intent.dedupeKey, membershipWelcomeKey(STUDIO, PHONE));
  assert.equal(result.intent.maxAttempts, 1);
  assert.equal(result.intent.sourceContractId, "synthetic-contract");
  assert.deepEqual(input, before);
});

test("valid renewal never gets welcome even without previous welcome sends", () => {
  const input = fixture();
  const h = input.selection.history;
  h.previousIssuanceIds = ["199"];
  h.currentIssuanceIds = ["199", "200"];
  h.purchases.priorRegularIssuanceIds = ["199"];
  h.contracts.records = [
    {
      contractId: "prior-synthetic",
      scope: "regular_membership",
      status: "signed",
      termsVersion: "v1",
      applicable: true,
      revoked: false,
      signedAt: "2026-09-01T00:00:00.000Z",
      validUntil: null,
    },
  ];
  assertStaged(input, { status: "excluded", reason: "renewal_no_welcome" });
});

test("draft, request acceptance and center seal alone do not qualify", () => {
  for (const patch of [
    { status: "draft" },
    { status: "sent" },
    { memberSigned: false },
    { centerSigned: false },
  ]) {
    const input = fixture();
    Object.assign(input.completion, patch);
    assertStaged(input, {
      status: "waiting",
      reason: "native_member_signature_required",
    });
  }
  const input = fixture();
  delete input.completion;
  assertStaged(input, {
    status: "waiting",
    reason: "native_member_signature_required",
  });
});

test("exclusions cannot be overridden by test flags or a later signed contract", () => {
  for (const classification of [
    "staff",
    "instructor",
    "instructor_lesson",
    "trial",
    "one_off",
    "compensation",
    "gift",
    "complimentary",
    "test",
  ]) {
    const input = fixture();
    input.selection.ticket.classification = classification;
    input.testOverride = true;
    input.completion.testOverride = true;
    assertStaged(input, { status: "blocked" });
  }
  const free = fixture();
  free.selection.ticket.payment.paidAmount = 0;
  assertStaged(free, { status: "blocked" });
});

test("fresh native completion must bind the exact selected issuance and member", () => {
  for (const patch of [
    { source: "workLanes" },
    { authoritative: false },
    { contractId: "" },
    { studioId: "" },
    { memberId: "101" },
    { userTicketId: "201" },
    { productId: "301" },
    { selectionJobKey: "wrong" },
    { contractAction: "renewal_purchase_confirmation" },
    { memberPhone: "" },
    { checkedAt: "2026-09-14T03:29:59.000Z" },
    { checkedAt: "2026-09-14T04:00:01.000Z" },
  ]) {
    const input = fixture();
    Object.assign(input.completion, patch);
    assertStaged(input, {
      status: "review",
      reason: "unverified_native_completion",
    });
  }
});

test("send-time member/phone/ticket/payment changes block welcome", () => {
  for (const patch of [
    { memberClassification: "staff" },
    { ticketClassification: "trial" },
    { currentRecipientEligible: false },
    { identityVerified: false },
    { nativePhoneMatchCount: 2 },
    { currentPhone: "01087654321" },
    { refunded: true },
    { cancelled: true },
    { ticketStatus: "expired" },
    { paymentStatus: "pending" },
    { paidAmount: 0 },
    { outstandingAmount: 1 },
  ]) {
    const input = fixture();
    Object.assign(input.completion, patch);
    assertStaged(input, {
      status: "excluded",
      reason: "current_member_or_ticket_ineligible",
    });
  }
});

test("stale, pre-selection or future signatures never become catch-up sends", () => {
  for (const signedAt of [
    "2026-09-12T03:50:00.000Z",
    "2026-09-14T02:59:59.000Z",
    "2026-09-14T04:00:01.000Z",
    "2026-09-14",
    "invalid",
  ]) {
    const input = fixture();
    input.completion.signedAt = signedAt;
    assertStaged(input, {
      status: "review",
      reason: "invalid_or_stale_signature_time",
    });
  }
});

test("complete all-time history is mandatory across provider, aliases and template versions", () => {
  for (const patch of [
    null,
    { authoritative: false },
    { complete: false },
    { allVersions: false },
    { allTime: false },
    { memberAliasesComplete: false },
    { providerComplete: false },
    { studioId: "other" },
    { phone: "01087654321" },
    { checkedAt: "2026-09-14T03:54:00.000Z" },
    { records: null },
  ]) {
    const input = fixture();
    input.history = patch === null ? null : { ...input.history, ...patch };
    assertStaged(input, {
      status: "review",
      reason: "complete_welcome_history_required",
    });
  }
});

test("legacy/new welcome successes, pending and ambiguous attempts prevent resend", () => {
  for (const templateId of [...LEGACY_TEMPLATE_IDS, spec.templateId]) {
    for (const status of [
      "delivered",
      "accepted",
      "queued",
      "sending",
      "unknown",
      "failed",
      "cancelled",
    ]) {
      const input = fixture();
      input.history.records = [
        {
          id: "synthetic-send",
          templateId,
          family: "new_member_welcome",
          status,
          attempted: true,
        },
      ];
      assertStaged(input, {
        status: ["delivered", "accepted"].includes(status)
          ? "excluded"
          : "review",
      });
    }
  }
});

test("only proven unattempted terminal records can leave welcome eligible", () => {
  for (const status of ["cancelled", "skipped", "failed"]) {
    const input = fixture();
    input.history.records = [
      {
        id: "synthetic-cancel",
        family: "new_member_welcome",
        status,
        attempted: false,
      },
    ];
    assertStaged(input, { status: "ready", ready: true });
  }
  for (const records of [
    [null],
    new Array(1),
    [{ id: "x", family: "other", status: "delivered" }],
    [{ id: "x", family: "new_member_welcome", status: "mystery" }],
  ]) {
    const input = fixture();
    input.history.records = records;
    assertStaged(input, {
      status: "review",
      reason: "invalid_welcome_history",
    });
  }
});

test("actual INSPECTING v6 keeps an otherwise eligible signed contract waiting", () => {
  const input = fixture();
  input.template.status = "INSPECTING";
  assertStaged(input, { status: "waiting", reason: "template_not_approved" });
});

test("repeated completion, phone formats and member merge preserve the family intent key", () => {
  const input = fixture();
  const key = planMembershipContractWelcome(input).intent.dedupeKey;
  input.completion.contractId = "another-synthetic-contract";
  input.completion.memberPhone = "+82 10-1234-5678";
  assert.equal(planMembershipContractWelcome(input).intent.dedupeKey, key);
  input.selection.member.memberId = "101";
  input.selection.ticket.memberId = "101";
  input.selection.history.purchases.memberId = "101";
  input.selection.history.contracts.memberId = "101";
  input.completion.memberId = "101";
  input.completion.selectionJobKey = membershipContractJobKey("101", "200");
  assert.equal(assertStaged(input, { ready: true }).intent.dedupeKey, key);
});

test("contract verification command evaluates welcome without IO side effects", () => {
  const input = fixture();
  const { selection, ...welcomeCompletion } = input;
  const command = fileURLToPath(
    new URL("../verify-studiomate-membership-contracts.mjs", import.meta.url),
  );
  const run = spawnSync(process.execPath, [command, "--input", "/dev/stdin"], {
    input: JSON.stringify([{ ...selection, welcomeCompletion }]),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.mode, "read_only");
  assert.equal(output.sends, 0);
  assert.equal(output.results[0].welcome.status, "ready");
  assert.equal(output.results[0].welcome.sendAllowed, false);
  assert.ok(!run.stdout.includes(PHONE));
});

function assertStaged(input, { status, reason, ready = false } = {}) {
  let actual;
  assert.doesNotThrow(() => {
    actual = planMembershipContractWelcome(input);
  });
  assert.equal(
    actual.sendAllowed,
    false,
    "The staged hook must never authorize a send",
  );
  assert.equal(actual.eligibleForCandidate, ready);
  if (status) assert.equal(actual.status, status);
  if (reason) assert.equal(actual.reason, reason);
  if (!ready) assert.equal(actual.intent, null);
  return actual;
}

test("manifest pins the created v6 template, preserved image, channel, and BA/IMAGE contract", () => {
  assert.equal(spec.templateId, "KA01TP260914091233543JoFDsn7KfCr");
  assert.equal(spec.imageId, "ST01FZ260602081207381GWsxSyw1Yo5");
  assert.equal(spec.channelId, "KA01PF260511123220162lk0NUjstpVl");
  assert.equal(spec.messageType, "BA");
  assert.equal(spec.emphasizeType, "IMAGE");
  assert.notEqual(spec.templateId, spec.referenceTemplateId);
  assert.equal(spec.buttons.length, 2);
  assert.doesNotMatch(
    JSON.stringify(spec.buttons),
    /\/s\/|memberSignup|onsiteWelcome|#\{/,
  );
  assert.equal(membershipWelcomeTemplateIssue(approvedTemplate()), "");
});

for (const [name, value] of [
  ["omitted", undefined],
  ["null", null],
  ["empty object", {}],
  ["empty string", ""],
  ["number", 7],
  ["array", []],
  ["boolean", true],
]) {
  test(`missing or malformed template fails closed: ${name}`, () => {
    assert.equal(membershipWelcomeTemplateIssue(value), "template_missing");
  });
}

for (const status of [
  undefined,
  null,
  "INSPECTING",
  "PENDING",
  "REJECTED",
  "DELETED",
  "approved",
  "APPROVED ",
]) {
  test(`template requires exact approval status: ${String(status)}`, () => {
    assert.equal(
      membershipWelcomeTemplateIssue({ ...approvedTemplate(), status }),
      "template_not_approved",
    );
  });
}

test("inspection-only template validation does not relax exact template identity", () => {
  const template = { ...approvedTemplate(), status: "INSPECTING" };
  assert.equal(
    membershipWelcomeTemplateIssue(template, { requireApproved: false }),
    "",
  );
  template.templateId = "synthetic-unapproved-other-id";
  assert.equal(
    membershipWelcomeTemplateIssue(template, { requireApproved: false }),
    "template_id_mismatch",
  );
});

for (const templateId of [...LEGACY_TEMPLATE_IDS, "synthetic-other-template"]) {
  test(`legacy or different template is rejected: ${templateId}`, () => {
    assert.equal(
      membershipWelcomeTemplateIssue({ ...approvedTemplate(), templateId }),
      templateId === spec.referenceTemplateId
        ? "legacy_signup_template_forbidden"
        : "template_id_mismatch",
    );
  });
}

for (const field of [
  "name",
  "channelId",
  "messageType",
  "emphasizeType",
  "imageId",
  "content",
]) {
  for (const mutation of ["different", "missing", "null"]) {
    test(`exact template ${field}: ${mutation}`, () => {
      const template = approvedTemplate();
      if (mutation === "missing") delete template[field];
      else
        template[field] =
          mutation === "null" ? null : `${template[field]} changed`;
      assert.equal(
        membershipWelcomeTemplateIssue(template),
        `template_${field}_mismatch`,
      );
    });
  }
}

for (const [name, buttons] of [
  ["missing", undefined],
  ["null", null],
  ["object", {}],
  ["empty", []],
  ["one button", [spec.buttons[0]]],
  ["three buttons", [...spec.buttons, spec.buttons[0]]],
  ["sparse", new Array(2)],
  ["null entries", [null, null]],
  ["reordered", [...spec.buttons].reverse()],
]) {
  test(`button shape must be exact: ${name}`, () => {
    assert.equal(
      membershipWelcomeTemplateIssue({ ...approvedTemplate(), buttons }),
      "template_buttons_mismatch",
    );
  });
}

for (const index of [0, 1]) {
  for (const field of [
    "buttonType",
    "buttonName",
    "linkMo",
    "linkPc",
    "targetOut",
  ]) {
    for (const mutation of ["different", "missing"]) {
      test(`button ${index} ${field} must match: ${mutation}`, () => {
        const template = approvedTemplate();
        if (mutation === "missing") delete template.buttons[index][field];
        else
          template.buttons[index][field] =
            field === "targetOut" ? true : "synthetic-mismatch";
        assert.equal(
          membershipWelcomeTemplateIssue(template),
          "template_buttons_mismatch",
        );
      });
    }
  }
}

test("v5 signup template cannot masquerade as the completed-signup template", () => {
  const template = approvedTemplate();
  template.templateId = spec.referenceTemplateId;
  template.messageType = "AD";
  template.buttons[0].linkMo = "https://in.archivepilates.com/s/#{링크ID}/";
  assert.equal(
    membershipWelcomeTemplateIssue(template),
    "legacy_signup_template_forbidden",
  );
});

test("additional quick replies are rejected", () => {
  assert.equal(
    membershipWelcomeTemplateIssue({
      ...approvedTemplate(),
      quickReplies: [{ name: "synthetic reply" }],
    }),
    "unexpected_template_quick_replies",
  );
});

for (const [name, quickReplies] of [
  ["object", {}],
  ["boolean", true],
  ["number", 1],
]) {
  test(`malformed quick replies fail closed: ${name}`, () => {
    assert.notEqual(
      membershipWelcomeTemplateIssue({ ...approvedTemplate(), quickReplies }),
      "",
    );
  });
}

for (const phone of [
  PHONE,
  "010-1234-5678",
  "010 1234 5678",
  "+82 10-1234-5678",
  "821012345678",
]) {
  test(`family key normalizes phone formatting: ${phone}`, () => {
    const key = membershipWelcomeKey(STUDIO, phone);
    assert.equal(key, membershipWelcomeKey(STUDIO, PHONE));
    assert.match(key, /^membership_welcome_[a-f0-9]{64}$/);
    assert.ok(!key.includes(PHONE));
  });
}

test("family key separates studios and recipient phones", () => {
  const key = membershipWelcomeKey(STUDIO, PHONE);
  assert.notEqual(key, membershipWelcomeKey("studio-synthetic-2", PHONE));
  assert.notEqual(key, membershipWelcomeKey(STUDIO, "01087654321"));
});

for (const studio of [undefined, null, "", " studio-synthetic-1", 3, {}, []]) {
  test(`invalid studio cannot produce a family key: ${JSON.stringify(studio)}`, () => {
    assert.throws(() => membershipWelcomeKey(studio, PHONE), TypeError);
  });
}

for (const phone of [
  undefined,
  null,
  "",
  "1234",
  "0212345678",
  "not-a-phone",
  {},
  [],
  true,
]) {
  test(`invalid mobile cannot produce a family key: ${JSON.stringify(phone)}`, () => {
    assert.throws(() => membershipWelcomeKey(STUDIO, phone), TypeError);
  });
}

for (const [name, input] of [
  ["omitted", undefined],
  ["null", null],
  ["empty object", {}],
  ["array", []],
  ["number", 1],
  ["string", "synthetic"],
  ["empty selection", { selection: {} }],
  ["null selection", { selection: null }],
  ["sparse selection", { selection: new Array(2) }],
]) {
  test(`missing or malformed plan stays non-sendable: ${name}`, () => {
    assertStaged(input);
  });
}
