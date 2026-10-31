import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { assertMemberDispatchAllowed, isMemberDispatchDeferred } from "../lib/member-dispatch-window.mjs";
import { createMemberSmsSender, memberSmsReceiptFields } from "../lib/member-sms-solapi.mjs";

const eformSource = await readFile(new URL("../process-eformsign-refund-jobs.mjs", import.meta.url), "utf8");
const smsSource = await readFile(new URL("../process-studiomate-refund-sms-jobs.mjs", import.meta.url), "utf8");
const fields = { memberName: "ozinput_24" };

// Evaluate only selected declarations, never the workers' top-level queue/database code.
function declarations(source, names, bindings = {}) {
  const functions = names.map((name) => {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.notEqual(start, -1, name);
    const rest = source.slice(start);
    const next = rest.slice(1).search(/^(?:async )?function /m);
    return next < 0 ? rest : rest.slice(0, next + 1);
  });
  return vm.runInNewContext(`${functions.join("\n")}\n;({${names.join(",")}})`, bindings);
}

for (const platform of ["darwin", "linux"]) {
  test(`PDF inputs commit via keyboard and Enter on ${platform}`, async () => {
    const calls = [];
    const field = {
      waitFor: async ({ state }) => calls.push(["wait", state]),
      click: async () => calls.push(["click"]),
      press: async (key) => calls.push(["press", key]),
      pressSequentially: async (value, { delay }) => calls.push(["type", value, delay]),
      fill: () => assert.fail("fill drops previous PDF widget values"),
    };
    const { fillFrameField } = declarations(eformSource, ["fillFrameField"], { process: { platform } });
    await fillFrameField({}, { locator: (selector) => { assert.equal(selector, "#amount"); return field; } }, "amount", "292,500원");
    assert.deepEqual(calls, [["wait", "visible"], ["click"], ["press", platform === "darwin" ? "Meta+A" : "Control+A"], ["type", "292,500원", 3], ["press", "Enter"]]);
    field.press = async () => { throw new Error("commit failed"); };
    await assert.rejects(fillFrameField({}, { locator: () => field }, "amount", "1"), /commit failed/);
  });
}

function dateHarness({ complete = false, count = 1, value = "" } = {}) {
  const calls = [];
  const date = {
    inputValue: async () => value,
    click: async () => calls.push(["date-click"]),
    press: async (key) => calls.push(["press", key]),
    pressSequentially: async (text, { delay }) => calls.push(["type", text, delay]),
  };
  const frame = { locator: (selector) => {
    if (selector === "#ozinput_24") return { click: async () => calls.push(["member-focus"]) };
    assert.equal(selector, 'input[id^="dp"]:not([readonly]):not([disabled])');
    calls.push(["date-selector"]);
    return { filter: ({ visible }) => {
      assert.equal(visible, true);
      return { count: async () => count, first: () => date };
    } };
  } };
  const page = { getByText: () => ({ isVisible: async () => complete }) };
  const { commitRefundWritingDateIfNeeded } = declarations(eformSource, ["commitRefundWritingDateIfNeeded"], {
    process: { platform: "darwin" }, EFORMSIGN_REFUND_FIELD_IDS: fields,
  });
  return { calls, run: () => commitRefundWritingDateIfNeeded(page, frame, new Date("2026-10-15T15:01:00Z")) };
}

test("missing writing date uses the next KST day, Enter, and member-name focus only", async () => {
  const h = dateHarness();
  await h.run();
  assert.deepEqual(h.calls, [["date-selector"], ["date-click"], ["press", "Meta+A"], ["type", "2026-10-16", 3], ["press", "Enter"], ["member-focus"]]);
});

test("complete forms do not inspect dates; missing or ambiguous date inputs do not receive writes", async () => {
  const complete = dateHarness({ complete: true });
  await complete.run();
  assert.deepEqual(complete.calls, []);
  const absent = dateHarness({ count: 0 });
  await absent.run();
  assert.deepEqual(absent.calls, [["date-selector"]]);
  const multiple = dateHarness({ count: 2 });
  await assert.rejects(multiple.run(), /하나로/);
  assert.deepEqual(multiple.calls, [["date-selector"]]);
});

test("existing writing date is committed without overwriting it", async () => {
  const h = dateHarness({ value: "2026-10-15" });
  await h.run();
  assert.deepEqual(h.calls, [["date-selector"], ["press", "Enter"], ["member-focus"]]);
});

test("agreement flow waits for optional signature OK and requires 8/8 without an intermediate Next", () => {
  const start = eformSource.indexOf("async function sendRefundAgreement(");
  const end = eformSource.indexOf("async function fillFrameField(");
  const flow = eformSource.slice(start, end);
  assert.doesNotMatch(eformSource, /clickNext|waitForTimeout/);
  assert.match(flow, /signatureOk\.waitFor\(\{ state: "visible", timeout: 2000 \}\)/);
  assert.match(flow, /await signatureOk\.count\(\) === 1\) await signatureOk\.click\(\)/);
  const signature = flow.indexOf("await clickFrameControl");
  const date = flow.indexOf("await commitRefundWritingDateIfNeeded");
  const required = flow.indexOf("await page.getByText");
  const firstSend = flow.indexOf('await page.getByRole("button", { name: /^(전송|Send)$/');
  assert.ok(signature < date && date < required && required < firstSend);
  assert.match(flow.slice(required, firstSend), /8\\s\*\\\/\\s\*8/);
  assert.ok(flow.indexOf("await beforeFinalSend()") < flow.indexOf("await finalSendButton.click()"));
});

const job = { jobId: "refund_sms_fixture", caseId: "refund_case_fixture", studioId: "5330", memberName: "테스트회원", memberPhone: "01000000000", smsTitle: "ARCHIVE PILATES 환불 안내", smsMessage: "승인된 이전 견적 292,500원. 실제 지급 전." };
const nativeId = "1001";
const confirmationText = "메시지 보내기1건을 즉시 발송합니다! LMS 총1건\n유형 LMS 총1건\n메시지를 보내시겠습니까? 취소 확인";
const smsFunctions = ["assertRefundSmsRecipient", "textboxWithPlaceholder", "refundSmsConfirmation", "assertRefundSmsResponse"];
const sms = declarations(smsSource, smsFunctions);

test("SMS recipient validation reads the exact readonly value, not dialog innerText", async () => {
  const recipient = { getAttribute: async (name) => name === "placeholder" ? "받는 사람을 선택해주세요." : "", inputValue: async () => job.memberName };
  const dialog = { getByRole: () => ({ count: async () => 1, nth: () => recipient }), innerText: () => assert.fail("recipient is absent from innerText") };
  await sms.assertRefundSmsRecipient(dialog, job.memberName);
  recipient.inputValue = async () => `${job.memberName}님`;
  await assert.rejects(sms.assertRefundSmsRecipient(dialog, job.memberName), /수신자/);
  recipient.inputValue = async () => job.memberName;
  recipient.getAttribute = async (name) => name === "placeholder" ? "받는 사람을 선택해주세요." : null;
  await assert.rejects(sms.assertRefundSmsRecipient(dialog, job.memberName), /수신자/);
});

function confirmationPage(text, count = 1) {
  const dialog = {
    filter: () => dialog, waitFor: async () => {}, count: async () => count,
    innerText: async () => text,
  };
  return { getByRole: () => dialog };
}

test("observed repeated 1건 confirmation is valid; other counts, missing summary, and ambiguity fail", async () => {
  await sms.refundSmsConfirmation(confirmationPage(confirmationText));
  for (const text of [confirmationText.replace("총1건", "총2건"), confirmationText.replace("1건을", "11건을"), "1건 메시지를 보내시겠습니까?", "메시지를 보내시겠습니까?"]) {
    await assert.rejects(sms.refundSmsConfirmation(confirmationPage(text)), /정확히 1건/);
  }
  await assert.rejects(sms.refundSmsConfirmation(confirmationPage(confirmationText, 2)), /정확히 1건/);
});

function receipt() {
  return {
    url: "https://api.studiomate.kr/v2/staff/sms", status: 200,
    requestPayload: { users: [1001], title: job.smsTitle, message: job.smsMessage, is_message: true, filter: {}, send_on: null },
    body: { id: 90001, studio_id: 5330, type: "send", sms_type: "LMS", title: job.smsTitle, message: job.smsMessage, count: -37, is_sent: 1, status: null },
  };
}

test("SMS acceptance binds native target, request/response content, and positive provider ID, not points count", () => {
  assert.doesNotThrow(() => sms.assertRefundSmsResponse(receipt(), job, nativeId));
  const noSentFlag = receipt();
  delete noSentFlag.body.is_sent;
  assert.doesNotThrow(() => sms.assertRefundSmsResponse(noSentFlag, job, nativeId));
  const changes = [
    (r) => { r.url += "/other"; }, (r) => { r.status = 201; },
    ...[0, -1, "90001", 1.5].map((id) => (r) => { r.body.id = id; }),
    (r) => { r.body.studio_id = 999; }, (r) => { r.body.type = "draft"; },
    (r) => { r.body.is_sent = 0; }, (r) => { r.body.title = "wrong"; },
    (r) => { r.body.message = "wrong"; }, (r) => { r.requestPayload.message = "wrong"; },
    (r) => { r.requestPayload.title = "wrong"; }, (r) => { delete r.requestPayload; },
    ...[[], [1002], [1001, 1002], [1001, 1001]].map((users) => (r) => { r.requestPayload.users = users; }),
  ];
  for (const change of changes) {
    const result = receipt();
    change(result);
    assert.throws(() => sms.assertRefundSmsResponse(result, job, nativeId), /검증하지 못했습니다/);
  }
});

test("refund wrapper uses the canonical SOLAPI sender after source/claim checks without touching SMS UI", async () => {
  const events = [];
  const page = new Proxy({}, { get: () => assert.fail("SMS wrapper must not access the browser") });
  const providerMessageId = `M${"1".repeat(24)}`, providerGroupId = `G${"2".repeat(24)}`;
  let posts = 0, invalidReceipt = false;
  const sendMemberSms = (plan, beforeFinalSend, { assertAllowed }) => {
    assert.equal(plan.key, job.jobId);
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), { ...job, key: job.jobId });
    return createMemberSmsSender({
      senderNumber: "0200000000", now: () => new Date("2026-10-22T03:00:00Z"), assertAllowed,
      request: async (url, method, body) => {
        if (method === "GET" && url === "/senderid/v1/numbers/active") return ["0200000000"];
        if (method === "GET" && url.startsWith("/messages/v4/list?")) return { messageList: {} };
        assert.equal(method, "POST");
        assert.equal(url, "/messages/v4/send-many/detail");
        assert.equal(events.at(-1), "dispatch-window-check");
        assert.ok(events.lastIndexOf("transport-start") < events.lastIndexOf("dispatch-window-check"));
        assert.equal(body.messages.length, 1);
        assert.equal(body.messages[0].to, job.memberPhone);
        assert.equal(body.messages[0].subject, job.smsTitle);
        assert.equal(body.messages[0].text, job.smsMessage);
        assert.equal(body.messages[0].customFields.archiveActionKey, job.jobId);
        assert.equal(body.allowDuplicates, false);
        posts++; events.push("provider-post");
        return { messageList: [{ messageId: invalidReceipt ? "bad" : providerMessageId, statusCode: "2000" }],
          failedMessageList: [], groupInfo: { groupId: providerGroupId } };
      },
    })(plan, beforeFinalSend);
  };
  const { sendRefundSms, markSent } = declarations(smsSource, ["sendRefundSms", "markSent"], {
    sendMemberSms, memberSmsReceiptFields,
    assertMemberDispatchAllowed: () => { assertMemberDispatchAllowed("2026-10-22T03:00:00Z"); events.push("dispatch-window-check"); },
    FieldValue: { serverTimestamp: () => "synthetic-stamp" },
    db: {
      collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
      batch: () => ({
        set: (ref, patch, options) => writes.push({ path: ref.path, patch, options }),
        update: (ref, patch) => writes.push({ path: ref.path, patch }),
        commit: async () => events.push("receipt-persisted"),
      }),
    },
  });
  const writes = [];
  const beforeFinalSend = async () => {
    events.push("source-check-and-intent");
    return () => events.push("transport-start");
  };
  const sent = await sendRefundSms(page, job, nativeId, beforeFinalSend);
  assert.equal(posts, 1);
  const sourceChecked = events.indexOf("source-check-and-intent");
  const transportStarted = events.indexOf("transport-start");
  const finalClockChecked = events.lastIndexOf("dispatch-window-check");
  assert.ok(sourceChecked < events.indexOf("dispatch-window-check", sourceChecked + 1));
  assert.ok(events.indexOf("dispatch-window-check", sourceChecked + 1) < transportStarted);
  assert.ok(transportStarted < finalClockChecked);
  assert.ok(finalClockChecked < events.indexOf("provider-post"));
  assert.equal(sent.studiomateMemberId, nativeId);
  assert.equal(sent.provider, "solapi");
  assert.equal(sent.providerMessageId, providerMessageId);
  assert.equal(sent.providerGroupId, providerGroupId);
  assert.equal(sent.providerReceipt.actionKey, job.jobId);
  assert.equal(Object.hasOwn(sent, "smsId"), false);
  assert.equal(sent.deliveryStatus, "not_verified");
  assert.match(sent.evidence, /SOLAPI accepted; final delivery not verified/);
  await markSent({ path: `studiomateRefundSmsJobs/${job.jobId}` }, job, sent);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, `studiomateRefundSmsJobs/${job.jobId}`);
  assert.equal(writes[0].patch.status, "sent");
  for (const field of ["provider", "providerMessageId", "providerGroupId", "providerReceipt", "deliveryStatus"])
    assert.deepEqual(writes[0].patch[field], sent[field]);
  assert.equal(Object.hasOwn(writes[0].patch, "smsId"), false);
  assert.equal(writes[1].path, `refundCases/${job.caseId}`);
  assert.equal(writes[1].patch["smsNotice.provider"], "solapi");
  assert.equal(writes[1].patch["smsNotice.providerMessageId"], providerMessageId);
  assert.equal(writes[1].patch["smsNotice.deliveryStatus"], "not_verified");
  assert.ok(events.indexOf("provider-post") < events.indexOf("receipt-persisted"));

  for (const id of ["", "0", "excel_1001", "1001x"]) {
    await assert.rejects(sendRefundSms(page, job, id, beforeFinalSend), /StudioMate/);
    assert.equal(posts, 1);
  }
  const changedSource = new Error("synthetic source changed");
  await assert.rejects(sendRefundSms(page, job, nativeId, async () => { throw changedSource; }), error => error === changedSource);
  assert.equal(posts, 1);
  invalidReceipt = true;
  await assert.rejects(sendRefundSms(page, job, nativeId, beforeFinalSend), /member_sms_receipt_unverified/);
  assert.equal(posts, 2);
  assert.equal(writes.length, 2, "invalid receipt must not reach persistence");
});

function refundSendingTransaction({ current = { status: "processing", dispatchToken: "fixture-claim", unrelated: "keep" },
  dispatchToken = "fixture-claim", now = "2026-10-22T03:00:00Z" } = {}) {
  const ref = { path: `studiomateRefundSmsJobs/${job.jobId}` };
  const casePath = `refundCases/${job.caseId}`;
  const rows = {
    ...(current === null ? {} : { [ref.path]: structuredClone(current) }),
    [casePath]: { smsNotice: { status: "processing", unrelated: "keep" }, unrelated: "keep" },
  };
  const initial = structuredClone(rows), writes = [], events = [];
  let commits = 0;
  const { markSending } = declarations(smsSource, ["markSending"], {
    FieldValue: { serverTimestamp: () => "synthetic-stamp" },
    assertMemberDispatchAllowed: () => { events.push("clock"); assertMemberDispatchAllowed(now); },
    db: {
      collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
      async runTransaction(callback) {
        events.push("transaction");
        await callback({
          get: async target => { events.push("read"); return { data: () => structuredClone(rows[target.path]) }; },
          set: (target, patch, options) => { events.push("set"); writes.push({ path: target.path, patch, options }); },
          update: (target, patch) => { events.push("update"); writes.push({ path: target.path, patch }); },
        });
        for (const { path, patch } of writes) {
          for (const [field, value] of Object.entries(patch)) {
            const parts = field.split("."), key = parts.pop();
            let row = rows[path];
            for (const part of parts) row = row[part];
            row[key] = value;
          }
        }
        commits++; events.push("commit");
      },
    },
  });
  return { rows, initial, writes, events, ref, casePath, commits: () => commits,
    run: () => markSending(ref, { ...job, dispatchToken }) };
}

test("refund markSending atomically marks the matching processing claim and case as sending", async () => {
  const h = refundSendingTransaction();
  await h.run();
  assert.equal(h.commits(), 1);
  assert.deepEqual(h.events, ["transaction", "read", "clock", "set", "update", "commit"]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [
    { path: h.ref.path, patch: { status: "sending", transportProvider: "solapi", sendClickedAt: "synthetic-stamp", updatedAt: "synthetic-stamp" }, options: { merge: true } },
    { path: h.casePath, patch: { "smsNotice.status": "sending", "smsNotice.sendClickedAt": "synthetic-stamp",
      "smsNotice.updatedAt": "synthetic-stamp", updatedAt: "synthetic-stamp" } },
  ]);
  assert.deepEqual(h.rows[h.ref.path], { ...h.initial[h.ref.path],
    status: "sending", transportProvider: "solapi", sendClickedAt: "synthetic-stamp", updatedAt: "synthetic-stamp" });
  assert.deepEqual(h.rows[h.casePath], { unrelated: "keep", updatedAt: "synthetic-stamp",
    smsNotice: { status: "sending", unrelated: "keep", sendClickedAt: "synthetic-stamp", updatedAt: "synthetic-stamp" } });
});

test("refund markSending rejects missing or changed claims, statuses and prior-send markers before updates", async () => {
  const current = { status: "processing", dispatchToken: "fixture-claim", unrelated: "keep" };
  for (const options of [
    { dispatchToken: "" }, { current: null }, { current: { ...current, dispatchToken: "changed" } },
    ...["pending", "retry", "sending", "sent", "failed"].map(status => ({ current: { ...current, status } })),
    ...[{ sendClickedAt: "prior" }, { externalEffectStarted: true }, { providerMessageId: `M${"1".repeat(24)}` }]
      .map(patch => ({ current: { ...current, ...patch } })),
  ]) {
    const h = refundSendingTransaction(options);
    await assert.rejects(h.run(), /member_sms_refund_claim_changed/);
    assert.deepEqual(h.writes, []);
    assert.equal(h.commits(), 0);
    assert.deepEqual(h.rows, h.initial);
    assert.deepEqual(h.events, ["transaction", "read"]);
  }
});

test("refund markSending clock failure prevents both queue and case updates", async () => {
  const h = refundSendingTransaction({ now: "2026-10-22T14:00:00Z" });
  await assert.rejects(h.run(), isMemberDispatchDeferred);
  assert.deepEqual(h.events, ["transaction", "read", "clock"]);
  assert.deepEqual(h.writes, []);
  assert.equal(h.commits(), 0);
  assert.deepEqual(h.rows, h.initial);
});

test("refund post-mark quiet crossing retains explicit zero-POST proof", async () => {
  const h = refundSendingTransaction(), requests = [];
  let clock = "2026-10-22T03:00:00Z", marked = false;
  const { sendRefundSms } = declarations(smsSource, ["sendRefundSms"], {
    memberSmsReceiptFields,
    assertMemberDispatchAllowed: () => assertMemberDispatchAllowed(clock),
    sendMemberSms: (plan, beforeFinalSend, { assertAllowed }) => createMemberSmsSender({
      senderNumber: "0200000000", assertAllowed,
      request: async (url, method) => {
        requests.push({ url, method });
        assert.equal(method, "GET", "post-mark quiet crossing must not POST");
        if (url === "/senderid/v1/numbers/active") return ["0200000000"];
        assert.ok(url.startsWith("/messages/v4/list?"));
        return { messageList: {} };
      },
    })(plan, beforeFinalSend),
  });
  await assert.rejects(sendRefundSms(new Proxy({}, { get: () => assert.fail("No SMS UI") }), job, nativeId, async () => {
    await h.run();
    return () => { marked = true; clock = "2026-10-22T14:00:00Z"; };
  }), error => isMemberDispatchDeferred(error) && error.providerPostCount === 0);
  assert.equal(marked, true);
  assert.equal(h.commits(), 1);
  assert.equal(h.rows[h.ref.path].status, "sending");
  assert.equal(requests.length, 2);
});

test("SMS stores provider identity and retains native/approval boundaries without broad POST fallback", () => {
  assert.match(smsSource, /providerMessageId: result\.providerMessageId/);
  assert.match(smsSource, /"smsNotice\.providerMessageId": result\.providerMessageId/);
  assert.match(smsSource, /"smsNotice\.deliveryStatus": result\.deliveryStatus/);
  assert.doesNotMatch(smsSource, /responses\.at\(-1\)|dialogText\.includes/);
  assert.match(smsSource, /fresh\.nativeSource\.studiomateMemberId !== live\.nativeSource\.studiomateMemberId/);
  assert.match(smsSource, /assertMemberDispatchAllowed\(\);\s*await markSending[\s\S]*?return \(\) => \{ finalSendClicked = true; \}/);
  assert.match(smsSource, /const plan = \{ \.\.\.job, key: job\.jobId \}/);
  assert.match(smsSource, /sendMemberSms\(plan, beforeFinalSend, \{ assertAllowed: \(\) => assertMemberDispatchAllowed\(\) \}\)/);
  assert.match(smsSource, /\.\.\.memberSmsReceiptFields\(receipt, plan\)/);
  const wrapper = declarations(smsSource, ["sendRefundSms"], {}).sendRefundSms.toString();
  assert.doesNotMatch(wrapper, /page\.|confirmation|assertRefundSmsResponse|classifyStudioMateSmsSendEvidence/);
});
