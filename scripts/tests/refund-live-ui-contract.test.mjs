import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { classifyStudioMateSmsSendEvidence } from "../lib/studiomate-refund-sms-contract.mjs";
import { assertMemberDispatchAllowed } from "../lib/member-dispatch-window.mjs";

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

const job = { studioId: "5330", memberName: "테스트회원", memberPhone: "01000000000", smsTitle: "ARCHIVE PILATES 환불 안내", smsMessage: "승인된 이전 견적 292,500원. 실제 지급 전." };
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

test("SMS composer opens confirmation before final source check, then awaits exact POST JSON before accepting", async () => {
  const events = [];
  const result = receipt();
  let respond;
  const response = {
    url: () => result.url, status: () => result.status,
    request: () => ({ method: () => "POST", postDataJSON: () => result.requestPayload }),
    json: async () => { await Promise.resolve(); events.push("json-read"); return result.body; },
  };
  const boxes = [
    { placeholder: "받는 사람을 선택해주세요.", value: job.memberName },
    { placeholder: "제목을 입력해주세요." }, { placeholder: "메시지를 입력해주세요." },
  ].map((box) => ({
    getAttribute: async (name) => name === "placeholder" ? box.placeholder : "",
    inputValue: async () => box.value,
    fill: async (value) => { events.push(box.placeholder); box.value = value; },
  }));
  const dialog = {
    waitFor: async ({ state }) => { events.push(`composer-${state}`); },
    isVisible: async () => false,
    getByRole: (role, options) => {
      if (role === "textbox") return { count: async () => boxes.length, nth: (index) => boxes[index] };
      if (options.name === "SMS 보내기") return { isVisible: async () => false };
      assert.equal(options.name, "보내기");
      return { click: async () => events.push("composer-send") };
    },
  };
  const confirmation = {
    filter: () => confirmation, waitFor: async () => events.push("confirmation-visible"),
    count: async () => 1, innerText: async () => confirmationText,
    getByRole: (role, options) => {
      assert.equal(options.name, "확인");
      return { click: async () => { events.push("confirm"); respond(response); } };
    },
  };
  const page = {
    goto: async () => {},
    getByRole: (role) => {
      if (role === "main") return { innerText: async () => `${job.memberName} ${job.memberPhone}` };
      if (role === "button") return { click: async () => {} };
      return { last: () => dialog, filter: () => confirmation };
    },
    waitForResponse: (predicate) => {
      events.push("response-waiter");
      assert.equal(predicate(response), true);
      assert.equal(predicate({ ...response, url: () => "https://api.studiomate.kr/v2/staff/notification" }), false);
      assert.equal(predicate({ ...response, request: () => ({ method: () => "GET" }) }), false);
      return new Promise((resolve) => { respond = resolve; });
    },
  };
  const { sendRefundSms } = declarations(smsSource, ["sendRefundSms", ...smsFunctions, "digitsOnly"], {
    URL,
    assertMemberDispatchAllowed: () => { assertMemberDispatchAllowed("2026-10-22T03:00:00Z"); events.push("dispatch-window-check"); },
    config: { baseUrl: "https://fixture.invalid", headless: true, waitForLogin: false },
    ensureStudioMateLoggedIn: async () => {}, classifyStudioMateSmsSendEvidence,
  });
  const sent = await sendRefundSms(page, job, nativeId, async () => {
    events.push("source-check-and-intent");
    return () => events.push("transport-start");
  });
  for (const [before, after] of [["composer-send", "confirmation-visible"], ["confirmation-visible", "source-check-and-intent"], ["source-check-and-intent", "response-waiter"], ["response-waiter", "confirm"], ["confirm", "json-read"], ["json-read", "composer-hidden"]]) {
    assert.ok(events.indexOf(before) < events.indexOf(after), `${before} before ${after}`);
  }
  assert.ok(events.indexOf("response-waiter") < events.lastIndexOf("dispatch-window-check"));
  assert.ok(events.lastIndexOf("dispatch-window-check") < events.indexOf("transport-start"));
  assert.ok(events.indexOf("transport-start") < events.indexOf("confirm"));
  assert.equal(sent.smsId, 90001);
  assert.equal(sent.providerMessageId, "90001");
  assert.equal(sent.deliveryStatus, "processing");
  assert.match(sent.evidence, /title\/message=matched/);
});

test("SMS stores provider identity and retains native/approval boundaries without broad POST fallback", () => {
  assert.match(smsSource, /providerMessageId: result\.providerMessageId/);
  assert.match(smsSource, /"smsNotice\.providerMessageId": result\.providerMessageId/);
  assert.match(smsSource, /"smsNotice\.deliveryStatus": result\.deliveryStatus/);
  assert.doesNotMatch(smsSource, /responses\.at\(-1\)|dialogText\.includes/);
  assert.match(smsSource, /fresh\.nativeSource\.studiomateMemberId !== live\.nativeSource\.studiomateMemberId/);
  assert.match(smsSource, /assertMemberDispatchAllowed\(\);\s*await markSending[\s\S]*?return \(\) => \{ finalSendClicked = true; \}/);
  assert.match(smsSource, /assertMemberDispatchAllowed\(\);\s*if \(typeof onClick === "function"\) onClick\(\);\s*await confirmation/);
});
