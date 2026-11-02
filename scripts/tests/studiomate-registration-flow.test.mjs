import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  assertNewMemberForm,
  assertStudioMateRegistrationAvailable,
  classifyMemberSave,
  observeMemberSave,
} from "../lib/studiomate-registration-flow.mjs";

// All URLs, identities, controls and DOM nodes are synthetic; no browser is opened.
const BASE_URL = "https://studiomate.example.invalid";
const CREATE_URL = `${BASE_URL}/users/create`;
const DETAIL_URL = `${BASE_URL}/users/detail?id=900000001`;
const GUIDE_TITLE = "회원 등록 완료 및 이용권 등록 안내";
const GUIDE_TEXT = "회원 등록이 완료되었습니다. 수강권 등록을 진행하시겠습니까?";
const FORM_IDENTITY = {
  baseUrl: BASE_URL,
  memberName: "Synthetic Member",
  memberPhone: "01000000000",
};

function guide(overrides = {}) {
  return { title: GUIDE_TITLE, text: GUIDE_TEXT, buttons: ["취소", "확인"], ...overrides };
}

function splitSnapshot(overrides = {}) {
  return { url: CREATE_URL, dialogs: [guide()], ...overrides };
}

test("classifyMemberSave recognizes legacy detail without inventing a ticket result", () => {
  for (const dialogs of [undefined, []]) {
    assert.deepEqual(classifyMemberSave({ url: DETAIL_URL, dialogs }, BASE_URL), {
      layout: "legacy_detail", memberId: "900000001",
    });
  }
});

test("classifyMemberSave recognizes the future notice225 split guide before navigation", () => {
  const snapshot = splitSnapshot();
  const before = structuredClone(snapshot);
  assert.deepEqual(classifyMemberSave(snapshot, BASE_URL), {
    layout: "split_registration_ticket_guide", memberId: null,
  });
  assert.deepEqual(snapshot, before);
});

test("classifyMemberSave recognizes the split guide on a persisted detail page", () => {
  assert.deepEqual(classifyMemberSave(splitSnapshot({ url: DETAIL_URL }), BASE_URL), {
    layout: "split_registration_ticket_guide", memberId: "900000001",
  });
});

test("classifyMemberSave normalizes popup whitespace and accepts reversed button order", () => {
  const snapshot = splitSnapshot({ dialogs: [guide({
    title: "  회원 등록 완료 및\n이용권 등록 안내  ",
    text: "\n회원 등록이 완료되었습니다.\n수강권 등록을 진행하시겠습니까?  ",
    buttons: [" 확인\n", "\n취소 "],
  })] });
  assert.equal(classifyMemberSave(snapshot, BASE_URL).layout, "split_registration_ticket_guide");
});

for (const [label, url] of [
  ["other host", "https://other.example.invalid/users/detail?id=900000001"],
  ["HTTP downgrade", "http://studiomate.example.invalid/users/detail?id=900000001"],
  ["other port", `${BASE_URL}:444/users/detail?id=900000001`],
]) {
  test(`classifyMemberSave rejects ${label} even with a known popup`, () => {
    assert.throws(() => classifyMemberSave(splitSnapshot({ url }), BASE_URL), /changed origin/);
    assert.throws(() => classifyMemberSave({ url, dialogs: [] }, BASE_URL), /changed origin/);
  });
}

for (const [label, dialogs] of [
  ["unknown title", [guide({ title: "회원 수정 완료" })]],
  ["partial title", [guide({ title: "회원 등록 완료" })]],
  ["missing success phrase", [guide({ text: "수강권 등록을 진행하시겠습니까?" })]],
  ["missing ticket reference", [guide({ text: "회원 등록이 완료되었습니다." })]],
  ["two dialogs", [guide(), guide()]],
  ["missing confirm", [guide({ buttons: ["취소"] })]],
  ["missing cancel", [guide({ buttons: ["확인"] })]],
  ["no buttons", [guide({ buttons: [] })]],
  ["duplicate confirm", [guide({ buttons: ["취소", "확인", "확인"] })]],
  ["duplicate cancel", [guide({ buttons: ["취소", "취소", "확인"] })]],
  ["nonexact confirm", [guide({ buttons: ["취소", "확인하기"] })]],
]) {
  test(`classifyMemberSave rejects ${label}, including after detail navigation`, () => {
    for (const url of [CREATE_URL, DETAIL_URL]) {
      assert.throws(() => classifyMemberSave({ url, dialogs }, BASE_URL), /Unknown StudioMate registration dialog/);
    }
  });
}

for (const url of [
  `${BASE_URL}/users/edit?id=900000001`,
  `${CREATE_URL}?id=900000001`,
  `${BASE_URL}/users`,
]) {
  test(`classifyMemberSave rejects non-registration URL ${new URL(url).pathname}${new URL(url).search}`, () => {
    assert.throws(() => classifyMemberSave(splitSnapshot({ url }), BASE_URL), /Unknown StudioMate registration dialog/);
    assert.throws(() => classifyMemberSave({ url, dialogs: [] }, BASE_URL), /no persistence signal/);
  });
}

for (const url of [
  CREATE_URL,
  `${BASE_URL}/users/detail`,
  `${BASE_URL}/users/detail?id=`,
  `${BASE_URL}/users/detail?id=synthetic`,
  `${BASE_URL}/users/detail?id=-1`,
  `${BASE_URL}/users/detail?id=1.5`,
  `${BASE_URL}/users/detail?id=0`,
  `${BASE_URL}/users/detail?id=0123`,
  `${BASE_URL}/users/detail?id=123&id=456`,
]) {
  test(`classifyMemberSave rejects absent save evidence at ${new URL(url).pathname}${new URL(url).search}`, () => {
    assert.throws(() => classifyMemberSave({ url, dialogs: [] }, BASE_URL), /no persistence signal/);
  });
}

test("split guide cannot rescue a malformed native detail ID", () => {
  for (const suffix of ["", "?id=0", "?id=synthetic", "?id=123&id=456"]) {
    assert.throws(() => classifyMemberSave(splitSnapshot({ url: `${BASE_URL}/users/detail${suffix}` }), BASE_URL),
      /Unknown StudioMate registration dialog/);
  }
});

for (const instant of [
  "2026-11-17T13:59:59.999+09:00",
  "2026-11-17T16:00:00.000+09:00",
  "2026-11-16T14:00:00.000+09:00",
  "2026-11-18T14:00:00.000+09:00",
]) {
  test(`maintenance allows ${instant}`, () => {
    assert.doesNotThrow(() => assertStudioMateRegistrationAvailable(Date.parse(instant)));
  });
}

for (const instant of [
  "2026-11-17T14:00:00.000+09:00",
  "2026-11-17T15:00:00.000+09:00",
  "2026-11-17T15:59:59.999+09:00",
]) {
  test(`maintenance blocks ${instant} with the exact resumption time`, () => {
    assert.throws(() => assertStudioMateRegistrationAvailable(Date.parse(instant)), {
      code: "STUDIOMATE_REGISTRATION_MAINTENANCE",
      nextAllowedAt: "2026-11-17T07:00:00.000Z",
    });
  });
}

for (const [label, value] of [
  ["NaN", NaN], ["Infinity", Infinity], ["negative Infinity", -Infinity],
  ["null", null], ["timestamp string", "2026-11-17T05:00:00.000Z"],
  ["numeric string", "1794891600000"], ["Date object", new Date(0)],
  ["object", {}], ["boolean", false],
]) {
  test(`maintenance rejects invalid clock ${label}`, () => {
    assert.throws(() => assertStudioMateRegistrationAvailable(value), /clock unavailable/);
  });
}

function formPage(overrides = {}) {
  const state = {
    url: CREATE_URL, nameCount: 1, phoneCount: 1, saveCount: 1, enabled: true,
    name: "  Synthetic Member  ", phone: "010-0000-0000", ...overrides,
  };
  const control = (count, value) => ({ count: async () => count, inputValue: async () => value });
  return {
    url: () => state.url,
    locator(selector) {
      if (selector === 'input[placeholder="이름을 입력해주세요"]') return control(state.nameCount, state.name);
      if (selector === 'input[placeholder="휴대폰 번호"]') return control(state.phoneCount, state.phone);
      assert.fail(`Unexpected selector: ${selector}`);
    },
    getByRole(role, options) {
      assert.equal(role, "button");
      assert.deepEqual(options, { name: "회원 등록 완료", exact: true });
      return { count: async () => state.saveCount, isEnabled: async () => state.enabled };
    },
  };
}

test("assertNewMemberForm accepts exactly one enabled form with normalized identity", async () => {
  await assert.doesNotReject(() => assertNewMemberForm(formPage(), FORM_IDENTITY));
});

for (const url of [
  `${BASE_URL}/users/edit?id=900000001`,
  DETAIL_URL,
  `${CREATE_URL}?id=900000001`,
  "https://other.example.invalid/users/create",
]) {
  test(`assertNewMemberForm rejects unsafe URL ${url}`, async () => {
    await assert.rejects(() => assertNewMemberForm(formPage({ url }), FORM_IDENTITY), /Unexpected StudioMate new-member form/);
  });
}

for (const field of ["nameCount", "phoneCount", "saveCount"]) {
  for (const count of [0, 2]) {
    test(`assertNewMemberForm rejects ${field}=${count}`, async () => {
      await assert.rejects(() => assertNewMemberForm(formPage({ [field]: count }), FORM_IDENTITY), /identity or controls changed/);
    });
  }
}

for (const [label, overrides] of [
  ["disabled save", { enabled: false }],
  ["different name", { name: "Synthetic Other Member" }],
  ["missing name", { name: "" }],
  ["different phone", { phone: "010-0000-0001" }],
  ["missing phone", { phone: "" }],
]) {
  test(`assertNewMemberForm rejects ${label}`, async () => {
    await assert.rejects(() => assertNewMemberForm(formPage(overrides), FORM_IDENTITY), /identity or controls changed/);
  });
}

function element({ text = "", title = "", buttons = [], children = [], rendered = true, visibility = "visible" } = {}) {
  return {
    innerText: text, visibility,
    getClientRects: () => rendered ? [{}] : [],
    contains(other) { return children.some(child => child === other || child.contains(other)); },
    querySelector(selector) {
      assert.equal(selector, '.el-dialog__title, .el-message-box__title, [data-dialog-title]');
      return title ? { textContent: title } : null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, "button");
      return buttons;
    },
  };
}

function dialogElement(overrides = {}) {
  return element({
    title: GUIDE_TITLE, text: GUIDE_TEXT,
    buttons: [element({ text: "취소" }), element({ text: "확인" })], ...overrides,
  });
}

function observationPage({ url = CREATE_URL, nodes = [], readError, waitError } = {}) {
  const calls = { waits: 0, reads: 0, disposals: 0, observed: undefined };
  const page = {
    async waitForFunction(callback, argument, options) {
      calls.waits++;
      assert.equal(argument, undefined);
      assert.deepEqual(options, { timeout: 30000, polling: 200 });
      if (waitError) throw waitError;
      // Run the real browser callback in an isolated, minimal DOM, without global mutation.
      calls.observed = structuredClone(vm.runInNewContext(`(${callback.toString()})()`, {
        document: { querySelectorAll(selector) {
          assert.equal(selector, '[role="dialog"], .el-dialog, .el-message-box');
          return nodes;
        } },
        location: { href: url },
        getComputedStyle: node => ({ visibility: node.visibility }),
      }));
      if (!calls.observed) throw new Error("Synthetic observation has no save signal");
      return {
        async jsonValue() { calls.reads++; if (readError) throw readError; return calls.observed; },
        async dispose() { calls.disposals++; },
      };
    },
  };
  return { page, calls };
}

test("observeMemberSave reads legacy detail and disposes its handle once", async () => {
  const { page, calls } = observationPage({ url: DETAIL_URL });
  assert.deepEqual(await observeMemberSave(page, BASE_URL), {
    layout: "legacy_detail", memberId: "900000001",
  });
  assert.deepEqual(calls, {
    waits: 1, reads: 1, disposals: 1, observed: { url: DETAIL_URL, dialogs: [] },
  });
});

test("observeMemberSave ignores hidden dialogs/buttons and deduplicates nested roots", async () => {
  const nested = dialogElement();
  const root = dialogElement({ children: [nested], buttons: [
    element({ text: "취소" }), element({ text: "확인" }),
    element({ text: "확인", rendered: false }), element({ text: "취소", visibility: "hidden" }),
  ] });
  const { page, calls } = observationPage({ nodes: [
    root, nested, dialogElement({ rendered: false }), dialogElement({ visibility: "hidden" }),
  ] });
  assert.deepEqual(await observeMemberSave(page, BASE_URL), {
    layout: "split_registration_ticket_guide", memberId: null,
  });
  assert.deepEqual(calls.observed, splitSnapshot());
  assert.equal(calls.disposals, 1);
});

for (const [label, options, pattern] of [
  ["unknown dialog", { nodes: [dialogElement({ title: "Synthetic unknown dialog" })] }, /Unknown StudioMate registration dialog/],
  ["missing title", { nodes: [dialogElement({ title: "" })] }, /Unknown StudioMate registration dialog/],
  ["multiple visible dialogs", { nodes: [dialogElement(), dialogElement()] }, /Unknown StudioMate registration dialog/],
  ["wrong origin", { url: "https://other.example.invalid/users/detail?id=900000001" }, /changed origin/],
  ["invalid detail id", { url: `${BASE_URL}/users/detail?id=synthetic` }, /no persistence signal/],
]) {
  test(`observeMemberSave disposes its handle on ${label}`, async () => {
    const { page, calls } = observationPage(options);
    await assert.rejects(() => observeMemberSave(page, BASE_URL), pattern);
    assert.equal(calls.reads, 1);
    assert.equal(calls.disposals, 1);
  });
}

test("observeMemberSave disposes its handle when jsonValue fails and preserves the error", async () => {
  const error = new Error("Synthetic handle read failure");
  const { page, calls } = observationPage({ url: DETAIL_URL, readError: error });
  await assert.rejects(() => observeMemberSave(page, BASE_URL), caught => caught === error);
  assert.equal(calls.disposals, 1);
});

test("observeMemberSave waits when only hidden dialogs exist without save evidence", async () => {
  const { page, calls } = observationPage({ nodes: [dialogElement({ rendered: false })] });
  await assert.rejects(() => observeMemberSave(page, BASE_URL), /Synthetic observation has no save signal/);
  assert.equal(calls.observed, false);
  assert.equal(calls.reads, 0);
  assert.equal(calls.disposals, 0);
});

test("observeMemberSave propagates wait failure without disposing an uncreated handle", async () => {
  const error = new Error("Synthetic wait timeout");
  const { page, calls } = observationPage({ waitError: error });
  await assert.rejects(() => observeMemberSave(page, BASE_URL), caught => caught === error);
  assert.equal(calls.waits, 1);
  assert.equal(calls.reads, 0);
  assert.equal(calls.disposals, 0);
});
