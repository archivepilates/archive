import assert from "node:assert/strict";
import test from "node:test";
import {
  HOLDING_TEMPLATE,
  holdingProviderHistory,
  holdingProviderReceipt,
  holdingProviderTemplateIssue,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/holdingNoticeProvider";

type Data = Record<string, any>;
const PHONE = "01000000001";
const CANDIDATE = "fixture-candidate";
const LEGACY_TEMPLATE = "KA01TP261006054728079NtSGrYdtSQH";
const BLOCKED = { complete: false, duplicate: true };
const CLEAR = { complete: true, duplicate: false };
const DUPLICATE = { complete: true, duplicate: true };
const template = (): Data => ({ ...structuredClone(HOLDING_TEMPLATE), status: "APPROVED" });
const receipt = (extra: Data = {}): Data => ({
  messageId: "fixture-message", to: PHONE, groupId: "fixture-group",
  kakaoOptions: { templateId: HOLDING_TEMPLATE.templateId }, ...extra,
});
const historyInput = (extra: Data = {}) => ({
  phone: PHONE, startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-07T03:00:00.000Z",
  coverageVerified: true, knownReceipts: new Map<string, string>(), candidateId: CANDIDATE, ...extra,
});
const historyPage = (rows: Data[] = [], nextKey?: unknown): Data => ({
  messageList: Object.fromEntries(rows.map(row => [row.messageId, row])), nextKey,
});

// This fake consumes literal pages only; it never fetches the supplied URL.
function mockGet(pages: unknown[]) {
  const urls: string[] = [];
  return {
    urls,
    get: async (url: string) => {
      const page = pages[urls.length];
      urls.push(url);
      assert.ok(urls.length <= pages.length, "unexpected provider page request");
      return structuredClone(page);
    },
  };
}

test("provider template exactly matches dynamically imported shadow specification", async () => {
  const { HOLDING_NOTICE_TEMPLATE_ID, HOLDING_NOTICE_TEMPLATE, holdingTemplateIssue } =
    await import("../lib/holding-allowance-notice.mjs");
  const { referenceTemplateId, ...spec } = HOLDING_NOTICE_TEMPLATE;
  assert.equal(typeof referenceTemplateId, "string");
  assert.deepEqual(HOLDING_TEMPLATE, { templateId: HOLDING_NOTICE_TEMPLATE_ID, ...spec });
  assert.equal(holdingProviderTemplateIssue(template()), "");
  assert.equal(holdingTemplateIssue(template()), "");
});

test("every exact template field is required; changed or omitted fields match shadow rejection", async () => {
  const { holdingTemplateIssue } = await import("../lib/holding-allowance-notice.mjs");
  for (const field of ["templateId", "name", "channelId", "messageType", "emphasizeType", "imageId", "content"]) {
    for (const value of [undefined, "fixture-mismatch"]) {
      const changed = { ...template(), [field]: value };
      assert.equal(holdingProviderTemplateIssue(changed), `holding_template_${field}_mismatch`, field);
      assert.notEqual(holdingTemplateIssue(changed), "", field);
    }
  }
  const changed = template();
  changed.content += " ";
  assert.equal(holdingProviderTemplateIssue(changed), "holding_template_content_mismatch");
});

test("template approval is explicit and malformed top-level values fail closed", () => {
  for (const value of [null, undefined, [], "APPROVED", 1, {}, { ...template(), status: "PENDING" },
    { ...template(), status: "approved" }, { ...template(), status: undefined }]) {
    assert.equal(holdingProviderTemplateIssue(value), "holding_template_not_approved");
  }
});

test("button count, type, label, links and target flag must match the exact specification", async () => {
  const { holdingTemplateIssue } = await import("../lib/holding-allowance-notice.mjs");
  const base = template();
  const invalidButtons = [undefined, null, {}, [], [null], [[]], [{}], [base.buttons[0], base.buttons[0]]];
  for (const field of ["buttonType", "buttonName", "linkMo", "linkPc", "targetOut"]) {
    for (const value of [undefined, field === "targetOut" ? true : "fixture-mismatch"]) {
      invalidButtons.push([{ ...base.buttons[0], [field]: value }]);
    }
  }
  for (const buttons of invalidButtons) {
    const changed = { ...base, buttons };
    assert.equal(holdingProviderTemplateIssue(changed), "holding_template_buttons_mismatch");
    assert.notEqual(holdingTemplateIssue(changed), "");
  }
});

test("extra button routes and quick replies are rejected in parity with the shadow specification", async () => {
  const { holdingTemplateIssue } = await import("../lib/holding-allowance-notice.mjs");
  for (const field of ["linkAnd", "linkIos", "chatExtra"]) {
    const changed = template();
    changed.buttons[0][field] = "fixture-extra-route";
    assert.equal(holdingProviderTemplateIssue(changed), "holding_template_buttons_mismatch", field);
    assert.equal(holdingTemplateIssue(changed), "template_buttons_mismatch", field);
  }
  for (const quickReplies of [[{ buttonName: "Fixture extra reply" }], {}, "extra", false]) {
    const changed = { ...template(), quickReplies };
    assert.equal(holdingProviderTemplateIssue(changed), "holding_template_buttons_mismatch");
    assert.equal(holdingTemplateIssue(changed), "template_buttons_mismatch");
  }
  for (const quickReplies of [undefined, null, []]) {
    const unchanged = { ...template(), quickReplies };
    Object.assign(unchanged.buttons[0], { linkAnd: "", linkIos: null, chatExtra: undefined });
    assert.equal(holdingProviderTemplateIssue(unchanged), "");
    assert.equal(holdingTemplateIssue(unchanged), "");
  }
});

test("receipt accepts exactly one array or keyed-object message and proves explicit recipient/template identity", () => {
  for (const messageList of [[receipt()], { "fixture-message": receipt() }]) {
    assert.deepEqual(holdingProviderReceipt({ messageList, failedMessageList: [] }, PHONE), {
      messageId: "fixture-message", groupId: "fixture-group", identityProven: true,
    });
  }
  assert.deepEqual(holdingProviderReceipt({
    messageList: [receipt({ groupId: undefined })], groupInfo: { groupId: "fixture-fallback-group" }, failedMessageList: {},
  }, PHONE), { messageId: "fixture-message", groupId: "fixture-fallback-group", identityProven: true });
});

test("group-only, missing message IDs and malformed response shapes never prove acceptance", () => {
  for (const result of [null, undefined, [], "accepted"]) {
    assert.throws(() => holdingProviderReceipt(result, PHONE), /holding_provider_response_unknown/);
  }
  for (const result of [
    { groupInfo: { groupId: "fixture-group" } }, { groupId: "fixture-group" },
    { messageList: [] }, { messageList: {} }, { messageList: "unknown" },
    { messageList: [null] }, { messageList: [[]] }, { messageList: [receipt(), receipt()] },
    ...[undefined, "", 1].map(messageId => ({ messageList: [receipt({ messageId })] })),
  ]) {
    assert.throws(() => holdingProviderReceipt(result, PHONE), /holding_provider_acceptance_unknown/);
  }
});

test("whitespace-only message ID is malformed, not a usable receipt", () => {
  assert.throws(() => holdingProviderReceipt({ messageList: [receipt({ messageId: "   " })] }, PHONE),
    /holding_provider_acceptance_unknown/);
});

test("provider failure rows block acceptance even alongside an otherwise valid receipt", () => {
  for (const failedMessageList of [[{ reason: "fixture-failure" }], { "fixture-failed": { reason: "fixture-failure" } }]) {
    assert.throws(() => holdingProviderReceipt({ messageList: [receipt()], failedMessageList }, PHONE),
      /holding_provider_acceptance_unknown/);
  }
  for (const failedMessageList of [false, 1, "unknown"]) {
    assert.throws(() => holdingProviderReceipt({ messageList: [receipt()], failedMessageList }, PHONE),
      /holding_provider_failures_unknown/);
  }
});

test("receipt recipient/template mismatches fail closed; absent identity remains explicitly unproven", () => {
  for (const extra of [{ to: "01000000002" }, { kakaoOptions: { templateId: "fixture-other-template" } },
    { kakaoOptions: { templateId: LEGACY_TEMPLATE } }]) {
    assert.throws(() => holdingProviderReceipt({ messageList: [receipt(extra)] }, PHONE), /holding_provider_acceptance_unknown/);
  }
  for (const extra of [{ to: undefined }, { kakaoOptions: undefined }, { to: undefined, kakaoOptions: undefined }]) {
    const result = holdingProviderReceipt({ messageList: [receipt({ ...extra, groupId: undefined })] }, PHONE);
    assert.deepEqual(result, { messageId: "fixture-message", groupId: "", identityProven: false });
  }
});

test("history requires explicitly verified coverage and a valid ordered time window before requesting pages", async () => {
  for (const extra of [
    { coverageVerified: false }, { startAt: "invalid" }, { endAt: "invalid" },
    { startAt: "2026-11-01T00:00:00Z" },
  ]) {
    const mock = mockGet([]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput(extra)), BLOCKED);
    assert.deepEqual(mock.urls, []);
  }
  const mock = mockGet([historyPage()]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({ endAt: historyInput().startAt })), CLEAR);
  assert.equal(mock.urls.length, 1);
});

test("malformed history envelopes never count as complete or safe to retry", async () => {
  for (const page of [undefined, null, [], "unknown", {}, { messageList: null }, { messageList: [] }, { messageList: "unknown" }]) {
    const mock = mockGet([page]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), BLOCKED);
    assert.equal(mock.urls.length, 1);
  }
});

test("malformed history row IDs, recipients and template identity fail closed, including unrelated templates", async () => {
  const rows = [
    null, [], {}, receipt({ messageId: "fixture-mismatched-id" }), receipt({ to: undefined }),
    receipt({ to: "01000000002" }), receipt({ kakaoOptions: undefined }),
    receipt({ kakaoOptions: [] }), receipt({ kakaoOptions: {} }),
    receipt({ kakaoOptions: { templateId: 1 } }),
    receipt({ to: "01000000002", kakaoOptions: { templateId: "fixture-unrelated-template" } }),
  ];
  for (const row of rows) {
    const mock = mockGet([{ messageList: { "fixture-message": row } }]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), BLOCKED);
  }
  const mock = mockGet([{ messageList: { "": receipt({ messageId: "" }) } }]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), BLOCKED);
});

test("unknown holding receipts and same-candidate receipts block retry for both current and legacy families", async () => {
  for (const templateId of [HOLDING_TEMPLATE.templateId, LEGACY_TEMPLATE]) {
    for (const owner of [undefined, CANDIDATE]) {
      const mock = mockGet([historyPage([receipt({ kakaoOptions: { templateId } })])]);
      const knownReceipts = owner ? new Map([["fixture-message", owner]]) : new Map<string, string>();
      assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({ knownReceipts })), DUPLICATE);
    }
  }
});

test("known receipts owned by a different candidate are not duplicates of this candidate", async () => {
  for (const templateId of [HOLDING_TEMPLATE.templateId, LEGACY_TEMPLATE]) {
    const mock = mockGet([historyPage([receipt({ kakaoOptions: { templateId } })])]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({
      knownReceipts: new Map([["fixture-message", "fixture-other-candidate"]]),
    })), CLEAR);
  }
});

test("valid unrelated template receipts do not create a holding duplicate", async () => {
  const mock = mockGet([historyPage([receipt({ kakaoOptions: { templateId: "fixture-unrelated-template" } })])]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), CLEAR);
});

test("history exhausts pagination, encodes cursors and preserves the recipient/time scope on every page", async () => {
  const cursor = "fixture cursor/+?=&";
  const mock = mockGet([
    historyPage([receipt()], cursor),
    historyPage([receipt({ messageId: "fixture-other-message" })], "fixture-next"),
    historyPage(),
  ]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({ knownReceipts: new Map([
    ["fixture-message", "fixture-other-candidate"], ["fixture-other-message", "fixture-other-candidate"],
  ]) })), CLEAR);
  assert.equal(mock.urls.length, 3);
  for (const [index, url] of mock.urls.entries()) {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://api.solapi.com/messages/v4/list");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      to: PHONE, type: "ATA", startDate: historyInput().startAt, endDate: historyInput().endAt,
      dateType: "CREATED", limit: "500", ...(index ? { startKey: index === 1 ? cursor : "fixture-next" } : {}),
    });
  }
});

test("a duplicate on one page remains a duplicate while all remaining pages are exhausted", async () => {
  const mock = mockGet([historyPage([receipt()], "fixture-next"), historyPage()]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), DUPLICATE);
  assert.equal(mock.urls.length, 2);
});

test("duplicate cursors and cursor cycles fail closed without an unbounded request loop", async () => {
  for (const cursors of [["fixture-a", "fixture-a"], ["fixture-a", "fixture-b", "fixture-a"]]) {
    const mock = mockGet(cursors.map(cursor => historyPage([], cursor)));
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), BLOCKED);
    assert.equal(mock.urls.length, cursors.length);
  }
});

test("repeated message IDs across pages fail closed even when known to another candidate", async () => {
  const mock = mockGet([historyPage([receipt()], "fixture-next"), historyPage([receipt()])]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({
    knownReceipts: new Map([["fixture-message", "fixture-other-candidate"]]),
  })), BLOCKED);
  assert.equal(mock.urls.length, 2);
});

test("non-string pagination keys fail closed; null, absent and empty keys end coverage", async () => {
  for (const nextKey of [false, 1, {}, []]) {
    const mock = mockGet([historyPage([], nextKey)]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), BLOCKED);
  }
  for (const nextKey of [undefined, null, ""]) {
    const mock = mockGet([historyPage([], nextKey)]);
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), CLEAR);
    assert.equal(mock.urls.length, 1);
  }
});

test("twentieth terminal page is complete, but an unexhausted twentieth page is not", async () => {
  for (const terminal of [true, false]) {
    const mock = mockGet(Array.from({ length: 20 }, (_, index) =>
      historyPage([], terminal && index === 19 ? undefined : `fixture-cursor-${index}`)));
    assert.deepEqual(await holdingProviderHistory(mock.get, historyInput()), terminal ? CLEAR : BLOCKED);
    assert.equal(mock.urls.length, 20);
  }
});

test("malformed later pages cannot be hidden by a valid first page or a known-other receipt", async () => {
  const mock = mockGet([historyPage([receipt()], "fixture-next"), { messageList: [] }]);
  assert.deepEqual(await holdingProviderHistory(mock.get, historyInput({
    knownReceipts: new Map([["fixture-message", "fixture-other-candidate"]]),
  })), BLOCKED);
  assert.equal(mock.urls.length, 2);
});

test("a provider read error propagates rather than returning complete history or retry clearance", async () => {
  let calls = 0;
  await assert.rejects(holdingProviderHistory(async () => {
    calls++;
    if (calls === 1) return historyPage([], "fixture-next");
    throw new Error("fixture-provider-read-failed");
  }, historyInput()), /fixture-provider-read-failed/);
  assert.equal(calls, 2);
});
