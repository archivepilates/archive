import assert from "node:assert/strict";
import test from "node:test";
import { membershipWelcomeReadbackIssue } from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeReadback";
import {
  isMembershipWelcomeCandidate,
  membershipActivationScopeIssue,
  membershipAutomationEnabled,
  membershipWelcomeClaimIssue,
} from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeQueue";
import { MEMBERSHIP_WELCOME_TEMPLATE } from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy";

type Data = Record<string, unknown>;
const NOW = Date.parse("2026-09-14T04:00:00.000Z");
const iso = (milliseconds: number): string =>
  new Date(milliseconds).toISOString();
const kinds = ["member", "ticket", "payment"] as const;
type Kind = (typeof kinds)[number];

/** Synthetic canonical shapes only; no Firebase initialization or native collector. */
function fixture() {
  const identity = { studioId: "studio-synthetic-1", memberId: "100" };
  const ticketIdentity = { userTicketId: "200", productId: "300" };
  const common = {
    ...identity,
    verified: true,
    complete: true,
    checkedAt: iso(NOW),
  };
  const completion: Data = {
    ...identity,
    ...ticketIdentity,
    checkedAt: iso(NOW - 300_000),
    contractId: "a".repeat(64),
    signedAt: iso(NOW - 600_000),
    memberPhone: "01000000001",
    paidAmount: 100000,
  };
  const nativeReadback: Record<Kind, Data> = {
    member: {
      ...common,
      source: "studiomate_native_member",
      phone: "01000000001",
      phoneMatchCount: 1,
      classification: "member",
      currentRecipientEligible: true,
    },
    ticket: {
      ...common,
      ...ticketIdentity,
      source: "studiomate_native_ticket",
      classification: "regular",
      status: "active",
      refunded: false,
      cancelled: false,
    },
    payment: {
      ...common,
      ...ticketIdentity,
      source: "studiomate_native_payment",
      status: "paid",
      paidAmount: 100000,
      totalAmount: 100000,
      outstandingAmount: 0,
      refundedAmount: 0,
    },
  };
  return {
    source: {
      studioId: identity.studioId,
      contractId: completion.contractId,
      completion,
      nativeReadback: {
        ...nativeReadback,
        providerSignature: {
          ...common,
          ...ticketIdentity,
          source: "studiomate_native_contract",
          contractId: completion.contractId,
          signedAt: completion.signedAt,
        },
      },
    },
    now: new Date(NOW),
    candidate: {
      createdAt: { seconds: (NOW - 120_000) / 1000, nanoseconds: 0 },
    },
  };
}

test("complete current native reads pass without mutating inputs", () => {
  const f = fixture();
  const before = structuredClone(f);
  assert.equal(membershipWelcomeReadbackIssue(f.source, f.now), "");
  assert.equal(
    membershipWelcomeReadbackIssue(f.source, f.now, f.candidate),
    "",
  );
  assert.deepEqual(f, before);
});

for (const field of ["completion", "nativeReadback"] as const) {
  for (const value of [undefined, null, [], "synthetic"]) {
    test(`${field} must be a present native object: ${JSON.stringify(value)}`, () => {
      const f = fixture();
      assert.equal(
        membershipWelcomeReadbackIssue({ ...f.source, [field]: value }, f.now),
        "current_native_readback_required",
      );
    });
  }
}

for (const kind of kinds) {
  for (const value of [undefined, null, [], "synthetic"]) {
    test(`${kind} native row cannot be missing or malformed: ${JSON.stringify(value)}`, () => {
      const f = fixture();
      assert.equal(
        membershipWelcomeReadbackIssue(
          {
            ...f.source,
            nativeReadback: { ...f.source.nativeReadback, [kind]: value },
          },
          f.now,
        ),
        "current_native_readback_identity_mismatch",
      );
    });
  }
  const identityCases: Array<[string, unknown]> = [
    ["source", "studiomate_member_excel"],
    ["source", `studiomate_native_${kind === "member" ? "ticket" : "member"}`],
    ["verified", false],
    ["verified", "true"],
    ["complete", false],
    ["complete", undefined],
    ["studioId", "other-studio"],
    ["memberId", "999"],
    ["memberId", 100],
  ];
  if (kind !== "member")
    identityCases.push(
      ["userTicketId", "999"],
      ["productId", "999"],
      ["userTicketId", undefined],
      ["productId", undefined],
    );
  for (const [field, value] of identityCases) {
    test(`${kind} rejects partial/mismatched ${field}: ${JSON.stringify(value)}`, () => {
      const f = fixture();
      f.source.nativeReadback[kind][field] = value;
      assert.equal(
        membershipWelcomeReadbackIssue(f.source, f.now),
        "current_native_readback_identity_mismatch",
      );
    });
  }
  for (const [label, checkedAt, expected] of [
    ["fresh", iso(NOW), ""],
    ["11:59.999 old", iso(NOW - 719_999), ""],
    ["exactly 12 minutes old", iso(NOW - 720_000), ""],
    ["12:00.001 old", iso(NOW - 720_001), "fresh_native_readback_required"],
    [
      "one millisecond in the future",
      iso(NOW + 1),
      "fresh_native_readback_required",
    ],
    ["invalid clock", "not-a-date", "fresh_native_readback_required"],
    ["missing clock", undefined, "fresh_native_readback_required"],
  ] as const) {
    test(`${kind} clock ${label}`, () => {
      const f = fixture();
      f.source.completion.checkedAt = iso(NOW - 900_000);
      f.candidate.createdAt = {
        seconds: (NOW - 900_000) / 1000,
        nanoseconds: 0,
      };
      f.source.nativeReadback[kind].checkedAt = checkedAt;
      assert.equal(
        membershipWelcomeReadbackIssue(f.source, f.now, f.candidate),
        expected,
      );
    });
  }
  for (const anchor of ["completion", "candidate"] as const) {
    for (const offset of [-1, 0, 1]) {
      test(`${kind} read ${offset}ms relative to ${anchor} creation`, () => {
        const f = fixture();
        const anchorAt = NOW - 1_000;
        if (anchor === "completion")
          f.source.completion.checkedAt = iso(anchorAt);
        else
          f.candidate.createdAt = { seconds: anchorAt / 1000, nanoseconds: 0 };
        f.source.nativeReadback[kind].checkedAt = iso(anchorAt + offset);
        assert.equal(
          membershipWelcomeReadbackIssue(f.source, f.now, f.candidate),
          offset < 0 ? "fresh_native_readback_required" : "",
        );
      });
    }
  }
}

for (const checkedAt of [undefined, null, "", "invalid", "Infinity"]) {
  test(`completion clock must be finite: ${JSON.stringify(checkedAt)}`, () => {
    const f = fixture();
    f.source.completion.checkedAt = checkedAt;
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now),
      "native_readback_clock_unverified",
    );
  });
}

const invalidCreatedAt: Array<[string, unknown]> = [
  ["missing", undefined],
  ["null", null],
  ["ISO string", iso(NOW)],
  ["Date object", new Date(NOW)],
  ["numeric milliseconds", NOW],
  ["missing nanoseconds", { seconds: NOW / 1000 }],
  ["string seconds", { seconds: String(NOW / 1000), nanoseconds: 0 }],
  ["fractional seconds", { seconds: NOW / 1000 + 0.5, nanoseconds: 0 }],
  ["unsafe seconds", { seconds: Number.MAX_SAFE_INTEGER + 1, nanoseconds: 0 }],
  ["negative nanoseconds", { seconds: NOW / 1000, nanoseconds: -1 }],
  ["overflow nanoseconds", { seconds: NOW / 1000, nanoseconds: 1e9 }],
  ["fractional nanoseconds", { seconds: NOW / 1000, nanoseconds: 0.5 }],
  ["string nanoseconds", { seconds: NOW / 1000, nanoseconds: "0" }],
  ["NaN toMillis", { toMillis: () => NaN }],
  ["infinite toMillis", { toMillis: () => Infinity }],
  ["string toMillis", { toMillis: () => String(NOW) }],
  [
    "throwing toMillis",
    {
      toMillis: () => {
        throw new Error("synthetic_timestamp_failure");
      },
    },
  ],
];
for (const [label, createdAt] of invalidCreatedAt) {
  test(`candidate createdAt rejects ${label}; never falls back to completion`, () => {
    const f = fixture();
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now, { createdAt }),
      "native_readback_clock_unverified",
    );
  });
}
for (const createdAt of [
  { seconds: NOW / 1000, nanoseconds: 0 },
  { toMillis: () => NOW },
]) {
  test(`candidate accepts equality at ${"toMillis" in createdAt ? "Timestamp.toMillis" : "serialized Timestamp"}`, () => {
    const f = fixture();
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now, { createdAt }),
      "",
    );
  });
}
test("candidate nanoseconds cannot be rounded down into an older readback", () => {
  const f = fixture();
  assert.equal(
    membershipWelcomeReadbackIssue(f.source, f.now, {
      createdAt: { seconds: NOW / 1000, nanoseconds: 1_000_000 },
    }),
    "fresh_native_readback_required",
  );
});
test("malformed createdAt.toMillis returns a blocking issue instead of throwing", () => {
  const f = fixture();
  assert.equal(
    membershipWelcomeReadbackIssue(f.source, f.now, {
      createdAt: { toMillis: "not-a-function" },
    }),
    "native_readback_clock_unverified",
  );
});

const eligibilityCases: Array<[Kind, string, unknown, string]> = [
  ...[0, 2, "1", undefined].map((value): [Kind, string, unknown, string] => [
    "member",
    "phoneMatchCount",
    value,
    "current_native_member_ineligible",
  ]),
  ...["01000000002", "invalid", undefined].map(
    (value): [Kind, string, unknown, string] => [
      "member",
      "phone",
      value,
      "current_native_member_ineligible",
    ],
  ),
  ...["staff", "instructor", "trial", undefined].map(
    (value): [Kind, string, unknown, string] => [
      "member",
      "classification",
      value,
      "current_native_member_ineligible",
    ],
  ),
  ...[false, "true", undefined].map(
    (value): [Kind, string, unknown, string] => [
      "member",
      "currentRecipientEligible",
      value,
      "current_native_member_ineligible",
    ],
  ),
  ["ticket", "classification", "trial", "current_native_ticket_ineligible"],
  ["ticket", "classification", undefined, "current_native_ticket_ineligible"],
  ...[true, undefined, "false"].flatMap(
    (value): Array<[Kind, string, unknown, string]> => [
      ["ticket", "refunded", value, "current_native_ticket_ineligible"],
      ["ticket", "cancelled", value, "current_native_ticket_ineligible"],
    ],
  ),
  ...["refunded", "cancelled", "expired", "pending", "ACTIVE", undefined].map(
    (value): [Kind, string, unknown, string] => [
      "ticket",
      "status",
      value,
      "current_native_ticket_ineligible",
    ],
  ),
  ...["refunded", "partial", "pending", "PAID", undefined].map(
    (value): [Kind, string, unknown, string] => [
      "payment",
      "status",
      value,
      "current_native_payment_ineligible",
    ],
  ),
  ...[
    0,
    -1,
    99999,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "100000",
    undefined,
  ].map((value): [Kind, string, unknown, string] => [
    "payment",
    "paidAmount",
    value,
    "current_native_payment_ineligible",
  ]),
  ...["totalAmount", "outstandingAmount", "refundedAmount"].flatMap(
    (field): Array<[Kind, string, unknown, string]> =>
      [1, undefined, field === "totalAmount" ? "100000" : "0"].map((value) => [
        "payment",
        field,
        value,
        "current_native_payment_ineligible",
      ]),
  ),
];
for (const [kind, field, value, expected] of eligibilityCases) {
  test(`${kind} eligibility rejects ${field}=${String(value)}`, () => {
    const f = fixture();
    f.source.nativeReadback[kind][field] = value;
    assert.equal(membershipWelcomeReadbackIssue(f.source, f.now), expected);
  });
}
for (const phone of ["010-0000-0001", "+82 10-0000-0001"]) {
  test(`member phone normalization accepts synthetic ${phone}`, () => {
    const f = fixture();
    f.source.nativeReadback.member.phone = phone;
    assert.equal(membershipWelcomeReadbackIssue(f.source, f.now), "");
  });
}
test("fully paid scheduled regular ticket is eligible", () => {
  const f = fixture();
  f.source.nativeReadback.ticket.status = "scheduled";
  assert.equal(membershipWelcomeReadbackIssue(f.source, f.now), "");
});

for (const value of [undefined, null, [], "synthetic"]) {
  test(`current provider signature is required: ${JSON.stringify(value)}`, () => {
    const f = fixture();
    f.source.nativeReadback.providerSignature = value;
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now),
      "current_native_readback_identity_mismatch",
    );
  });
}
for (const [field, value] of [
  ["contractId", "b".repeat(64)],
  ["userTicketId", "999"],
  ["memberId", "999"],
  ["verified", false],
] as const) {
  test(`provider signature rejects mismatched ${field}`, () => {
    const f = fixture();
    f.source.nativeReadback.providerSignature[field] = value;
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now),
      "current_native_readback_identity_mismatch",
    );
  });
}
test("provider signature must be refreshed after the candidate", () => {
  const f = fixture();
  f.source.nativeReadback.providerSignature.checkedAt = iso(NOW - 120_001);
  assert.equal(
    membershipWelcomeReadbackIssue(f.source, f.now, f.candidate),
    "fresh_native_readback_required",
  );
});
test("provider signedAt must exactly match the accepted completion", () => {
  const f = fixture();
  f.source.nativeReadback.providerSignature.signedAt = iso(NOW - 599_999);
  assert.equal(
    membershipWelcomeReadbackIssue(f.source, f.now),
    "current_native_signature_mismatch",
  );
});

for (const source of [undefined, null, [], "synthetic", 1]) {
  test(`malformed source fails closed: ${JSON.stringify(source)}`, () => {
    assert.equal(
      membershipWelcomeReadbackIssue(source as unknown as Data, new Date(NOW)),
      "native_readback_clock_unverified",
    );
  });
}
for (const now of [
  new Date(NaN),
  undefined,
  iso(NOW),
  NOW,
  { getTime: () => NOW },
]) {
  test(`current clock must be a finite Date: ${String(now)}`, () => {
    const f = fixture();
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, now as Date),
      "native_readback_clock_unverified",
    );
  });
}
const noncanonicalClocks: Array<[string, unknown]> = [
  ["date only", "2026-09-14"],
  ["no milliseconds", "2026-09-14T04:00:00Z"],
  ["short milliseconds", "2026-09-14T04:00:00.00Z"],
  ["extra precision", "2026-09-14T04:00:00.0000Z"],
  ["UTC numeric offset", "2026-09-14T04:00:00.000+00:00"],
  ["local numeric offset", "2026-09-14T13:00:00.000+09:00"],
  ["missing zone", "2026-09-14T04:00:00.000"],
  ["lowercase zone", "2026-09-14T04:00:00.000z"],
  ["surrounding whitespace", " 2026-09-14T04:00:00.000Z "],
  ["day rollover", "2026-02-30T04:00:00.000Z"],
  ["hour rollover", "2026-09-13T24:00:00.000Z"],
  ["Date object", new Date(NOW)],
  ["numeric milliseconds", NOW],
];
for (const [label, checkedAt] of noncanonicalClocks) {
  for (const field of ["completion", ...kinds] as const) {
    test(`${field} clock rejects noncanonical ${label}`, () => {
      const f = fixture();
      const row =
        field === "completion"
          ? f.source.completion
          : f.source.nativeReadback[field];
      row.checkedAt = checkedAt;
      assert.equal(
        membershipWelcomeReadbackIssue(f.source, f.now),
        field === "completion"
          ? "native_readback_clock_unverified"
          : "fresh_native_readback_required",
      );
    });
  }
}
test("calendar rollover is rejected even when Date.parse would make it fresh", () => {
  const f = fixture();
  f.source.completion.checkedAt = "2026-03-02T03:55:00.000Z";
  for (const kind of kinds)
    f.source.nativeReadback[kind].checkedAt = "2026-02-30T04:00:00.000Z";
  assert.equal(
    membershipWelcomeReadbackIssue(
      f.source,
      new Date("2026-03-02T04:00:00.000Z"),
    ),
    "fresh_native_readback_required",
  );
});
for (const phone of [undefined, "", "invalid", "123", 1000000001]) {
  test(`matching invalid completion/member phones are not identity proof: ${String(phone)}`, () => {
    const f = fixture();
    f.source.completion.memberPhone = phone;
    f.source.nativeReadback.member.phone = phone;
    assert.equal(
      membershipWelcomeReadbackIssue(f.source, f.now),
      "current_native_member_ineligible",
    );
  });
}

const enabledConfig = {
  enabled: true,
  mode: "live",
  sourcePromoted: true,
  nativeE2eVerified: true,
};
test("automation requires all four explicit live gates", () => {
  assert.equal(membershipAutomationEnabled(enabledConfig), true);
  assert.equal(membershipAutomationEnabled(undefined), false);
  assert.equal(membershipAutomationEnabled({}), false);
  for (const field of ["enabled", "sourcePromoted", "nativeE2eVerified"]) {
    for (const value of [undefined, false, "true", 1]) {
      assert.equal(
        membershipAutomationEnabled({ ...enabledConfig, [field]: value }),
        false,
        `${field}=${String(value)}`,
      );
    }
  }
  for (const mode of [undefined, "shadow", "dry_run", "LIVE", true]) {
    assert.equal(
      membershipAutomationEnabled({ ...enabledConfig, mode }),
      false,
    );
  }
});

test("activation scope allows production or one explicitly listed canary member", () => {
  assert.equal(
    membershipActivationScopeIssue({ activationScope: "production" }, "100"),
    "",
  );
  assert.equal(
    membershipActivationScopeIssue(
      { activationScope: "canary", canaryMemberIds: ["100"] },
      "100",
    ),
    "",
  );
  for (const config of [
    undefined,
    {},
    { activationScope: "canary" },
    { activationScope: "canary", canaryMemberIds: [] },
    { activationScope: "canary", canaryMemberIds: ["101"] },
    { activationScope: "canary", canaryMemberIds: [100] },
    { activationScope: "production_prepared" },
  ]) {
    assert.equal(
      membershipActivationScopeIssue(config, "100"),
      "membership_activation_scope_blocked",
    );
  }
});

const welcomeCandidate = (): Data => ({
  type: "membership_welcome",
  templateCode: MEMBERSHIP_WELCOME_TEMPLATE.templateId,
  attempts: 0,
  maxAttempts: 1,
  payload: { sourceContractId: "a".repeat(64) },
});
test("either membership type or exact template routes through the strict membership gate", () => {
  assert.equal(isMembershipWelcomeCandidate(welcomeCandidate()), true);
  assert.equal(
    isMembershipWelcomeCandidate({ type: "membership_welcome" }),
    true,
  );
  assert.equal(
    isMembershipWelcomeCandidate({
      templateCode: MEMBERSHIP_WELCOME_TEMPLATE.templateId,
    }),
    true,
  );
  assert.equal(
    isMembershipWelcomeCandidate({
      type: "onsite_welcome",
      templateCode: MEMBERSHIP_WELCOME_TEMPLATE.templateId,
    }),
    true,
  );
  assert.equal(
    isMembershipWelcomeCandidate({
      type: "new_member",
      templateCode: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId,
    }),
    false,
  );
  assert.equal(isMembershipWelcomeCandidate({}), false);
});
test("claim accepts only the exact unattempted one-shot membership candidate", () => {
  assert.equal(membershipWelcomeClaimIssue(welcomeCandidate()), "");
});
for (const field of ["type", "templateCode", "attempts", "maxAttempts"]) {
  test(`claim rejects absent ${field} before any default coercion`, () => {
    const candidate = welcomeCandidate();
    delete candidate[field];
    assert.equal(
      membershipWelcomeClaimIssue(candidate),
      "membership_attempt_state_not_verified",
    );
  });
}
for (const attempts of [
  undefined,
  null,
  "0",
  false,
  -1,
  0.5,
  1,
  NaN,
  Infinity,
]) {
  test(`claim rejects nonzero or ambiguous attempts ${String(attempts)}`, () => {
    assert.equal(
      membershipWelcomeClaimIssue({ ...welcomeCandidate(), attempts }),
      "membership_attempt_state_not_verified",
    );
  });
}
for (const patch of [
  { type: "onsite_welcome" },
  { templateCode: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId },
  { templateCode: "synthetic-unapproved" },
  { maxAttempts: 2 },
  { maxAttempts: "1" },
]) {
  test(`claim rejects wrong family/template/retry setting ${JSON.stringify(patch)}`, () => {
    assert.equal(
      membershipWelcomeClaimIssue({ ...welcomeCandidate(), ...patch }),
      "membership_attempt_state_not_verified",
    );
  });
}
const outboundFields = [
  "providerAttemptedAt",
  "solapiMessageId",
  "messageId",
  "sentAt",
  "outboundStartedAt",
  "sendingStartedAt",
  "acceptedAt",
  "sendStartedAt",
];
for (const field of outboundFields) {
  for (const attempts of [0, undefined]) {
    test(`claim rejects ${field} with ${attempts === 0 ? "zero" : "missing"} attempts`, () => {
      assert.equal(
        membershipWelcomeClaimIssue({
          ...welcomeCandidate(),
          attempts,
          [field]: "synthetic-marker",
        }),
        "membership_attempt_state_not_verified",
      );
    });
  }
}
for (const field of [
  "testOverride",
  "testRecipientOverride",
  "testMode",
  "recipientOverride",
]) {
  for (const location of ["candidate", "payload"]) {
    test(`claim rejects even false ${field} in ${location}`, () => {
      const candidate = welcomeCandidate();
      if (location === "candidate") candidate[field] = false;
      else
        candidate.payload = {
          sourceContractId: "a".repeat(64),
          [field]: false,
        };
      assert.equal(
        membershipWelcomeClaimIssue(candidate),
        "membership_attempt_state_not_verified",
      );
    });
  }
}

// Strict regression expectations, not TODOs: report guard gaps without blessing them.
test("invalid current clock cannot bypass the native freshness gate", () => {
  const f = fixture();
  assert.notEqual(
    membershipWelcomeReadbackIssue(f.source, new Date(NaN), f.candidate),
    "",
  );
});
for (const patch of [
  { attempted: true },
  { alimtalkSendId: "synthetic-send" },
  { groupId: "synthetic-group" },
  { provider: {} },
  { response: { status: "accepted" } },
  { lastAttemptAt: iso(NOW - 1000) },
  {
    payload: {
      sourceContractId: "a".repeat(64),
      messageId: "synthetic-message",
    },
  },
]) {
  test(`claim must preserve conservative legacy outbound evidence: ${JSON.stringify(patch)}`, () => {
    assert.equal(
      membershipWelcomeClaimIssue({ ...welcomeCandidate(), ...patch }),
      "membership_attempt_state_not_verified",
    );
  });
}
