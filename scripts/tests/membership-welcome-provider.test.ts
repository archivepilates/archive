import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMembershipProviderHistory,
  type MembershipProviderHistoryInput,
} from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeProvider";
import { MEMBERSHIP_WELCOME_TEMPLATE } from "../../firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomePolicy";

const input = {
  phone: "01012345678",
  startAt: "2026-01-01T00:00:00.000Z",
  now: "2026-09-14T04:00:00.000Z",
  coverageVerified: true,
};
const message = (id: string) => ({
  messageId: id,
  to: input.phone,
  type: "ATA",
  statusCode: "4000",
  kakaoOptions: { templateId: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId },
});
test("provider coverage must be verified before any request", async () => {
  let reads = 0;
  const result = await loadMembershipProviderHistory(
    async () => {
      reads++;
    },
    { ...input, coverageVerified: false },
  );
  assert.equal(reads, 0);
  assert.equal(result.complete, false);
});
test("exhausts nextKey; uses explicit dates/phone and recognizes legacy versions", async () => {
  let reads = 0;
  const result = await loadMembershipProviderHistory(async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("to"), input.phone);
    assert.equal(params.get("startDate"), input.startAt);
    reads++;
    return reads === 1
      ? { messageList: { m1: message("m1") }, nextKey: "m1" }
      : { messageList: {}, nextKey: null };
  }, input);
  assert.equal(reads, 2);
  assert.equal(result.complete, true);
  assert.equal(result.records[0].status, "delivered");
});
for (const [label, response] of [
  ["empty response", {}],
  ["array page", { messageList: [] }],
  [
    "wrong phone",
    { messageList: { m1: { ...message("m1"), to: "01000000000" } } },
  ],
  [
    "unknown welcome template",
    {
      messageList: {
        m1: {
          ...message("m1"),
          kakaoOptions: { templateId: "unknown" },
          text: "웰컴 안내",
        },
      },
    },
  ],
] as const)
  test(label, async () =>
    assert.equal(
      (await loadMembershipProviderHistory(async () => response, input))
        .complete,
      false,
    ),
  );
test("repeated cursor or read failure never becomes empty history", async () => {
  assert.equal(
    (
      await loadMembershipProviderHistory(
        async () => ({ messageList: {}, nextKey: "again" }),
        input,
      )
    ).reason,
    "provider_cursor_repeated",
  );
  assert.equal(
    (
      await loadMembershipProviderHistory(async () => {
        throw Error("offline");
      }, input)
    ).complete,
    false,
  );
});
test("provider failure remains attempted, and cannot be automatically retried", async () => {
  const result = await loadMembershipProviderHistory(
    async () => ({
      messageList: { m1: { ...message("m1"), statusCode: "5000" } },
    }),
    input,
  );
  assert.deepEqual(
    result.records.map((r) => [r.status, r.attempted]),
    [["unknown", true]],
  );
});

const unrelatedId = "synthetic-audited-non-welcome";
const auditedAllowlist = {
  independentlyAudited: true,
  auditId: "synthetic-independent-audit",
  templateIds: [unrelatedId],
};
const page = (row: Record<string, unknown>) => ({
  messageList: { m1: row },
  nextKey: null,
});

for (const text of [
  undefined,
  null,
  "",
  "SYNTHETIC welcome guidance",
  "환영합니다",
  "예약 안내",
  "웰컴 안내",
  123,
  { label: "unrelated" },
]) {
  test(`unknown template is incomplete regardless of message text ${JSON.stringify(text)}`, async () => {
    const result = await loadMembershipProviderHistory(
      async () =>
        page({
          ...message("m1"),
          kakaoOptions: { templateId: "synthetic-unknown" },
          text,
        }),
      input,
    );
    assert.equal(result.complete, false);
    assert.equal(result.reason, "unknown_welcome_template");
  });
}

test("missing text field does not prove an unknown template unrelated", async () => {
  const result = await loadMembershipProviderHistory(
    async () =>
      page({
        ...message("m1"),
        kakaoOptions: { templateId: unrelatedId },
      }),
    input,
  );
  assert.equal(result.complete, false);
  assert.equal(result.reason, "unknown_welcome_template");
});

test("only exact independently audited non-welcome IDs may be excluded", async () => {
  const result = await loadMembershipProviderHistory(
    async () => ({
      messageList: {
        unrelated: {
          ...message("unrelated"),
          kakaoOptions: { templateId: unrelatedId },
        },
        known: message("known"),
      },
      nextKey: null,
    }),
    { ...input, nonWelcomeTemplateAllowlist: auditedAllowlist },
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.records.map((row) => row.id),
    ["solapi/known"],
  );
});

test("text is not read or used to override an independent template audit", async () => {
  const row = { ...message("m1"), kakaoOptions: { templateId: unrelatedId } };
  Object.defineProperty(row, "text", {
    get: () => {
      throw new Error("Message text must never be used as evidence");
    },
  });
  const result = await loadMembershipProviderHistory(async () => page(row), {
    ...input,
    nonWelcomeTemplateAllowlist: auditedAllowlist,
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.records, []);
});

test("another audited ID does not authorize an unknown template", async () => {
  const result = await loadMembershipProviderHistory(
    async () =>
      page({
        ...message("m1"),
        kakaoOptions: { templateId: "synthetic-other-unknown" },
      }),
    { ...input, nonWelcomeTemplateAllowlist: auditedAllowlist },
  );
  assert.equal(result.complete, false);
  assert.equal(result.reason, "unknown_welcome_template");
});

test("explicit empty audited allowlist still fails closed for unknown IDs", async () => {
  const result = await loadMembershipProviderHistory(
    async () =>
      page({
        ...message("m1"),
        kakaoOptions: { templateId: unrelatedId },
      }),
    {
      ...input,
      nonWelcomeTemplateAllowlist: { ...auditedAllowlist, templateIds: [] },
    },
  );
  assert.equal(result.complete, false);
});

for (const allowlist of [
  null,
  [],
  [unrelatedId],
  {},
  { ...auditedAllowlist, independentlyAudited: false },
  { ...auditedAllowlist, independentlyAudited: "true" },
  { ...auditedAllowlist, auditId: "" },
  { ...auditedAllowlist, auditId: " padded " },
  { ...auditedAllowlist, auditId: 1 },
  { ...auditedAllowlist, templateIds: unrelatedId },
  { ...auditedAllowlist, templateIds: [null] },
  { ...auditedAllowlist, templateIds: [" "] },
  { ...auditedAllowlist, templateIds: [123] },
  { ...auditedAllowlist, templateIds: [unrelatedId, unrelatedId] },
  {
    ...auditedAllowlist,
    templateIds: [MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId],
  },
  {
    ...auditedAllowlist,
    templateIds: [MEMBERSHIP_WELCOME_TEMPLATE.templateId],
  },
])
  test(`invalid/non-independent allowlist does no provider IO: ${JSON.stringify(allowlist)}`, async () => {
    let reads = 0;
    const result = await loadMembershipProviderHistory(
      async () => {
        reads++;
        return page(message("m1"));
      },
      {
        ...input,
        nonWelcomeTemplateAllowlist: allowlist,
      } as unknown as MembershipProviderHistoryInput,
    );
    assert.equal(result.complete, false);
    assert.equal(result.reason, "invalid_non_welcome_template_allowlist");
    assert.equal(reads, 0);
  });

for (const value of [
  undefined,
  null,
  "",
  " ",
  " padded ",
  123,
  false,
  {},
  [],
  [unrelatedId],
  "bad/id",
  "bad\nvalue",
]) {
  for (const field of ["nested", "top-level"])
    test(`bad ${field} template ID metadata fails closed: ${JSON.stringify(value)}`, async () => {
      const row: Record<string, unknown> =
        field === "nested"
          ? {
              ...message("m1"),
              kakaoOptions: { templateId: value },
              templateId: unrelatedId,
            }
          : { ...message("m1"), templateId: value };
      const result = await loadMembershipProviderHistory(
        async () => page(row),
        { ...input, nonWelcomeTemplateAllowlist: auditedAllowlist },
      );
      assert.equal(result.complete, false);
      assert.equal(result.reason, "invalid_provider_template_metadata");
    });
}

for (const options of [null, [], "invalid", 123, true])
  test(`invalid kakaoOptions is not rescued by top-level metadata: ${JSON.stringify(options)}`, async () => {
    const result = await loadMembershipProviderHistory(
      async () =>
        page({
          ...message("m1"),
          kakaoOptions: options,
          templateId: unrelatedId,
        }),
      { ...input, nonWelcomeTemplateAllowlist: auditedAllowlist },
    );
    assert.equal(result.complete, false);
    assert.equal(result.reason, "invalid_provider_template_metadata");
  });

test("missing template metadata cannot be excluded by an allowlist", async () => {
  const row: Record<string, unknown> = message("m1");
  delete row.kakaoOptions;
  const result = await loadMembershipProviderHistory(async () => page(row), {
    ...input,
    nonWelcomeTemplateAllowlist: auditedAllowlist,
  });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "provider_template_missing");
});

for (const nested of [
  unrelatedId,
  MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId,
])
  test(`conflicting template locations cannot discard welcome history: ${nested}`, async () => {
    const result = await loadMembershipProviderHistory(
      async () =>
        page({
          ...message("m1"),
          kakaoOptions: { templateId: nested },
          templateId:
            nested === unrelatedId
              ? MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId
              : unrelatedId,
        }),
      { ...input, nonWelcomeTemplateAllowlist: auditedAllowlist },
    );
    assert.equal(result.complete, false);
    assert.equal(result.reason, "conflicting_provider_template_metadata");
  });

test("valid top-level legacy metadata and matching dual metadata remain supported", async () => {
  const topLevel: Record<string, unknown> = {
    ...message("top"),
    templateId: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId,
  };
  delete topLevel.kakaoOptions;
  const result = await loadMembershipProviderHistory(
    async () => ({
      messageList: {
        top: topLevel,
        both: {
          ...message("both"),
          templateId: MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId,
        },
      },
      nextKey: null,
    }),
    input,
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.records.map((row) => row.id),
    ["solapi/top", "solapi/both"],
  );
});

test("later unknown template retains previously collected welcome blockers", async () => {
  let reads = 0;
  const result = await loadMembershipProviderHistory(
    async () =>
      ++reads === 1
        ? { messageList: { known: message("known") }, nextKey: "next" }
        : page({ ...message("m1"), kakaoOptions: { templateId: unrelatedId } }),
    input,
  );
  assert.equal(result.complete, false);
  assert.equal(result.reason, "unknown_welcome_template");
  assert.deepEqual(
    result.records.map((row) => row.id),
    ["solapi/known"],
  );
});

for (const value of [
  undefined,
  null,
  0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  "invalid",
  "2026-09-14",
  "2026-09-14T04:00:00",
  "2026-02-30T04:00:00Z",
  "2026-13-01T04:00:00Z",
  "2026-09-14T24:00:00Z",
  "2026-09-14T04:00:00+99:00",
  "2026-09-14T04:00:00-00:00",
]) {
  for (const field of ["now", "startAt"])
    test(`invalid ${field} instant does no provider IO: ${String(value)}`, async () => {
      let reads = 0;
      const result = await loadMembershipProviderHistory(
        async () => {
          reads++;
          return { messageList: {} };
        },
        {
          ...input,
          [field]: value,
        } as unknown as MembershipProviderHistoryInput,
      );
      assert.equal(result.complete, false);
      assert.equal(result.reason, "provider_coverage_not_verified");
      assert.equal(reads, 0);
    });
}

test("inverted date range is rejected before IO", async () => {
  let reads = 0;
  const result = await loadMembershipProviderHistory(
    async () => {
      reads++;
    },
    { ...input, startAt: "2026-09-15T00:00:00Z" },
  );
  assert.equal(result.complete, false);
  assert.equal(reads, 0);
});

test("valid leap dates, UTC offsets and fractional seconds are finite explicit instants", async () => {
  const result = await loadMembershipProviderHistory(
    async (url) => {
      const params = new URL(url).searchParams;
      assert.equal(params.get("startDate"), "2024-02-29T09:00:00+09:00");
      assert.equal(params.get("endDate"), "2026-09-14T04:00:00.1Z");
      return { messageList: {}, nextKey: null };
    },
    {
      ...input,
      startAt: "2024-02-29T09:00:00+09:00",
      now: "2026-09-14T04:00:00.1Z",
    },
  );
  assert.equal(result.complete, true);
});

test("truthy coverage flag is not an independent attestation", async () => {
  let reads = 0;
  const result = await loadMembershipProviderHistory(
    async () => {
      reads++;
    },
    {
      ...input,
      coverageVerified: "true",
    } as unknown as MembershipProviderHistoryInput,
  );
  assert.equal(result.complete, false);
  assert.equal(reads, 0);
});
