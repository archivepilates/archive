import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../../archivein/recommendedMealSurvey/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const expected = [
  {
    "name": "primaryGoal",
    "values": [
      "식사 습관 개선",
      "체지방 감량",
      "근육·체력 유지",
      "현재 체중 유지"
    ],
    "max": 1
  },
  {
    "name": "mealsPerDay",
    "values": [
      "1~2회",
      "3회",
      "4회 이상",
      "불규칙"
    ],
    "max": 1
  },
  {
    "name": "breakfastPattern",
    "values": [
      "일반 식사",
      "간단히 먹음",
      "거의 거름"
    ],
    "max": 1
  },
  {
    "name": "mainMealSource",
    "values": [
      "집밥·도시락",
      "구내식당·급식",
      "식당·배달",
      "편의점·간편식"
    ],
    "max": 1
  },
  {
    "name": "cookingAccess",
    "values": [
      "20분 이내 조리 가능",
      "10분 이내 간단 조리",
      "전자레인지·조립만 가능",
      "조리 어려움"
    ],
    "max": 1
  },
  {
    "name": "mealBudget",
    "values": [
      "하루 1만원 이하",
      "하루 1만~2만원",
      "하루 2만원 이상",
      "큰 제한 없음"
    ],
    "max": 1
  },
  {
    "name": "mealBreakWindow",
    "values": [
      "대체로 일정",
      "저녁 21시 이후",
      "교대·야간근무",
      "매일 다름"
    ],
    "max": 1
  },
  {
    "name": "workIntensity",
    "values": [
      "주로 앉아서 생활",
      "서 있거나 가끔 이동",
      "활동·이동이 많음"
    ],
    "max": 1
  },
  {
    "name": "exerciseSchedule",
    "values": [
      "주로 오전",
      "주로 오후",
      "주로 저녁",
      "일정하지 않음·운동 안 함"
    ],
    "max": 1
  },
  {
    "name": "snackPattern",
    "values": [
      "거의 없음",
      "단 간식·음료",
      "야식",
      "음주·술자리"
    ],
    "max": 3,
    "none": "거의 없음"
  },
  {
    "name": "allergies",
    "values": [
      "없음",
      "우유·유제품",
      "달걀",
      "견과류",
      "밀·글루텐",
      "해산물",
      "기타·잘 모름"
    ],
    "max": 7,
    "none": "없음"
  },
  {
    "name": "preferredFoods",
    "values": [
      "특별한 선호 없음",
      "한식",
      "면류",
      "빵·샌드위치",
      "고기·생선",
      "두부·콩"
    ],
    "max": 3,
    "none": "특별한 선호 없음"
  },
  {
    "name": "healthFlags",
    "values": [
      "해당 없음",
      "질환·약물로 식사 제한",
      "임신·수유",
      "섭식 관련 치료 경험",
      "만 18세 미만",
      "전문가 상담이 먼저 필요"
    ],
    "max": 5,
    "none": "해당 없음"
  }
];

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]));
}

// Only the fixed HTML subset used by this page is parsed; no browser or real fetch is used.
function fixture({ configured = true, post = "success", info = {}, getError = false, search } = {}) {
  const nodes = new Map();
  const calls = [];
  const gets = [];
  let activeElement;
  class Element {
    constructor(tag = "div", attrs = {}) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = attrs;
      this.listeners = {};
      this.hidden = "hidden" in attrs;
      this.disabled = "disabled" in attrs;
      this.checked = "checked" in attrs;
      this.required = "required" in attrs;
      this.name = attrs.name || "";
      this.type = attrs.type || "";
      this.value = attrs.value || "";
      this.id = attrs.id || "";
      this.textContent = "";
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith("data-")) this.dataset[key.slice(5)] = value;
      }
    }
    append(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    replaceChildren() { this.children = []; }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { if (!this.disabled) activeElement = this; }
    scrollIntoView() {}
    matches(selector) {
      const [, tag, attr, value] = selector.match(/^(\w+)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/) || [];
      return this.tag === tag && (!attr || (attr in this.attributes && (value === undefined || this.attributes[attr] === value)));
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const form = new Element("form", { id: "mealSurveyForm", hidden: "" });
  const groups = [...html.matchAll(/<fieldset\s+([^>]+)>([\s\S]*?)<\/fieldset>/g)].map(([, attrs, contents]) => {
    const group = new Element("fieldset", attributes(attrs));
    const legend = new Element("legend");
    legend.textContent = contents.match(/<legend>(.*?)<\/legend>/)[1];
    group.append(legend);
    for (const [, attrs] of contents.matchAll(/<input\s+([^>]+)>/g)) group.append(new Element("input", attributes(attrs)));
    form.append(group);
    return group;
  });
  const consentAttrs = html.match(/<input\s+([^>]*name="consent"[^>]*)>/)[1];
  const consent = new Element("input", attributes(consentAttrs));
  const button = new Element("button", { type: "submit", disabled: "" });
  form.append(consent);
  form.append(button);
  form.elements = [...form.querySelectorAll("input"), button];
  nodes.set("mealSurveyForm", form);
  for (const [, attrs] of html.matchAll(/<(?:div|section|span|a|p|ul)\s+([^>]*\bid="[^"]+"[^>]*)>/g)) {
    const parsed = attributes(attrs);
    nodes.set(parsed.id, new Element("div", parsed));
  }
  const document = { getElementById: id => nodes.get(id), createElement: tag => new Element(tag) };
  const context = vm.createContext({
    document, URLSearchParams, HTMLInputElement: Element,
    location: { search: search ?? `?id=meal-2026-10-28-0000000000000000&token=${"a".repeat(48)}` },
    fetch: async (url, options) => {
      if (options?.method !== "POST") {
        gets.push(url);
        if (getError) throw new Error("synthetic GET failure");
        return { ok: true, json: async () => ({ ok: true, status: "sent", memberName: "합성 테스트", inbodyStatus: "missing",
          surveySchemaVersion: "meal-choice-v2", consentVersion: "synthetic-consent-v1", ...info }) };
      }
      calls.push({ url, ...options, payload: JSON.parse(options.body) });
      if (post === "network-error") throw new Error("synthetic POST failure");
      if (typeof post === "function") return post();
      return {
        ok: post !== "http-error",
        json: async () => {
          if (post === "invalid-json") throw new Error("invalid JSON");
          if (post === "api-error") return { ok: false, error: "합성 서버 오류" };
          if (post === "null-json") return null;
          if (post === "empty-json") return {};
          if (post === "missing-status") return { ok: true };
          if (post === "wrong-status") return { ok: true, status: "pending" };
          return { ok: true, status: "submitted", duplicate: post === "duplicate", reportReady: post === "report-ready" };
        }
      };
    }
  });
  // Consent configuration is replaced only inside this isolated VM, never in the production HTML.
  const source = script.replace('const AI_CONSENT = { providerLabel: "ChatGPT/Codex", consentVersion: "meal-preferences-operator-v1-20261029" };',
    configured
      ? 'const AI_CONSENT = { providerLabel: "합성 AI 제공자", consentVersion: "synthetic-consent-v1" };'
      : 'const AI_CONSENT = { providerLabel: "ChatGPT/Codex", consentVersion: "" };');
  vm.runInContext(source, context);
  const inputs = name => form.querySelectorAll(`input[name="${name}"]`);
  return {
    form, groups, consent, button, nodes, calls, gets,
    get activeElement() { return activeElement; },
    ready: () => new Promise(resolve => setImmediate(resolve)),
    submit: () => form.listeners.submit[0]({ preventDefault() {} }),
    change(input) { for (const listener of form.listeners.change) listener({ target: input }); },
    inputs,
    select(name, value) {
      const items = inputs(name);
      const input = items.find(item => item.value === value);
      assert.ok(input, `${name}: ${value}`);
      if (input.type === "radio") items.forEach(item => { item.checked = false; });
      input.checked = true;
      this.change(input);
      return input;
    },
    fill() {
      for (const group of groups) this.select(group.dataset.choice, group.querySelector("input").value);
      consent.checked = true;
      this.change(consent);
    },
    snapshot() { return JSON.stringify(form.querySelectorAll("input").map(({ name, value, checked }) => ({ name, value, checked }))); },
    setPost(value) { post = value; }
  };
}

test("exactly 13 contract groups, native choices only, no preselected answers", () => {
  const f = fixture();
  assert.equal(f.groups.length, 13);
  for (const [index, spec] of expected.entries()) {
    const group = f.groups[index];
    assert.equal(group.dataset.choice, spec.name);
    assert.deepEqual(f.inputs(spec.name).map(input => input.value), spec.values);
    assert.equal(Number(group.dataset.max || 1), spec.max);
    assert.equal(group.dataset.none, spec.none);
    for (const input of f.inputs(spec.name)) {
      assert.equal(input.type, spec.none ? "checkbox" : "radio");
      assert.equal(input.checked, false);
      if (!spec.none) assert.equal(input.required, true);
    }
  }
  assert.doesNotMatch(html, /<(?:textarea|select)\b|type="(?:text|time|number|email|hidden)"/i);
  assert.equal(f.consent.required, true);
  assert.equal(f.consent.checked, false);
  assert.match(html, /min-height: 44px/);
});

test("missing consent contract still fails closed, even with all answers", async () => {
  const f = fixture({ configured: false }); await f.ready(); f.fill(); await f.submit();
  assert.equal(f.form.hidden, true);
  assert.equal(f.consent.disabled, true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.calls.length, 0);
  assert.match(f.nodes.get("surveyMessageText").textContent, /새로고침/);
  assert.match(script, /providerLabel: "ChatGPT\/Codex", consentVersion: "meal-preferences-operator-v1-20261029"/);
  assert.doesNotMatch(html, /openai-meal-v1|testMode|fixture=/);
});

test("operator-assisted consent excludes sensitive drafting input and promises no automatic API call or publication", async () => {
  const f = fixture(); await f.ready();
  const notice = f.nodes.get("aiProcessingNotice").textContent;
  for (const text of ["합성 AI 제공자", "정해진 음식·생활 습관 선택값만", "Gemini/OpenAI API를 자동 호출하지 않습니다", "관리자가 필요할 때", "별도 공개 여부", "제출 즉시 생성되거나 공개되지 않습니다"]) assert.ok(notice.includes(text));
  assert.match(html, /알레르기·건강상 주의사항 선택값과 InBody 기록, 이름·전화번호·회원 ID 등 식별정보는 초안 작성 입력에 포함하지 않습니다/);
  assert.match(html, /ARCHIVE PILATES 내부 검토에만 사용/);
  assert.match(html, /건강 상세정보나 자유입력 답변은 수집하지 않습니다/);
  assert.match(html, /동의 여부는 자율적으로 결정/);
  assert.match(html, /자발적으로 명시 동의/);
  assert.doesNotMatch(html, /무료 등급|Google 제품 개선|정보 저장·Gemini 처리/);
});

for (const info of [
  { surveySchemaVersion: undefined }, { surveySchemaVersion: null }, { surveySchemaVersion: 3 },
  { surveySchemaVersion: "meal-choice-v3" }, { surveySchemaVersion: ["meal-choice-v2"] },
  { consentVersion: undefined }, { consentVersion: null }, { consentVersion: true },
  { consentVersion: "meal-preferences-gemini-v0" }, { consentVersion: ["synthetic-consent-v1"] },
  { consentVersion: "meal-preferences-gemini-v1-20261029" }
]) {
  test(`GET contract mismatch fails closed: ${JSON.stringify(info)}`, async () => {
    const f = fixture({ info }); await f.ready(); f.fill(); await f.submit();
    assert.equal(f.form.hidden, true);
    assert.equal(f.button.disabled, true);
    assert.equal(f.consent.disabled, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.activeElement.id, "surveyMessage");
    assert.match(f.nodes.get("surveyMessageText").textContent, /새로고침/);
  });
}

for (const reportReady of ["true", "false", 1, null, undefined]) {
  test(`only a literal true can expose a submitted report: ${String(reportReady)}`, async () => {
    const f = fixture({ info: { status: "submitted", reportReady, surveySchemaVersion: undefined, consentVersion: undefined } });
    await f.ready(); await f.submit();
    assert.equal(f.form.hidden, true);
    assert.equal(f.button.disabled, true);
    assert.equal(f.nodes.get("mealReportLink").hidden, true);
    assert.match(f.nodes.get("surveyMessageText").textContent, /이미 설문 제출이 완료/);
    assert.equal(f.calls.length, 0);
  });
}

test("empty form reports 13 required groups plus consent and posts nothing", async () => {
  const f = fixture(); await f.ready(); await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(f.nodes.get("surveyValidationList").children.length, 14);
  assert.equal(f.activeElement.id, "surveyValidation");
  const link = f.nodes.get("surveyValidationList").children[0].children[0];
  link.listeners.click[0]({ preventDefault() {} });
  assert.equal(f.activeElement, f.inputs("primaryGoal")[0]);
  assert.equal(f.activeElement.checked, false);
});

test("summary retains remaining errors and clears only corrected groups", async () => {
  const f = fixture(); await f.ready(); await f.submit();
  f.select("primaryGoal", "식사 습관 개선");
  assert.equal(f.nodes.get("surveyValidationList").children.length, 13);
  assert.equal(f.inputs("primaryGoal")[0].attributes["aria-invalid"], undefined);
  f.fill();
  assert.equal(f.nodes.get("surveyValidation").hidden, true);
});

for (const spec of expected.filter(spec => spec.none)) {
  test(`${spec.name}: required array and exclusive none work in both directions`, async () => {
    const f = fixture(); await f.ready(); f.fill();
    f.inputs(spec.name).forEach(input => { input.checked = false; });
    await f.submit();
    assert.equal(f.calls.length, 0);
    assert.equal(f.nodes.get("surveyValidationList").children.length, 1);
    f.select(spec.name, spec.none);
    const other = f.select(spec.name, spec.values[1]);
    assert.equal(f.inputs(spec.name)[0].checked, false);
    f.select(spec.name, spec.none);
    assert.equal(other.checked, false);
    assert.equal(f.nodes.get("surveyValidation").hidden, true);
  });

  test(`${spec.name}: malformed none-plus-answer cannot be submitted`, async () => {
    const f = fixture(); await f.ready(); f.fill();
    f.inputs(spec.name)[1].checked = true;
    await f.submit();
    assert.equal(f.calls.length, 0);
    assert.equal(f.inputs(spec.name)[0].attributes["aria-invalid"], "true");
  });
}

test("three preferred foods lock extra options, preserve none, and unlock on deselection", async () => {
  const f = fixture(); await f.ready();
  for (const value of ["한식", "면류", "빵·샌드위치"]) f.select("preferredFoods", value);
  const items = f.inputs("preferredFoods");
  assert.equal(items[4].disabled, true);
  assert.equal(items[0].disabled, false);
  const fourth = f.select("preferredFoods", "고기·생선");
  assert.equal(fourth.checked, false);
  items[1].checked = false; f.change(items[1]);
  assert.equal(items[4].disabled, false);
});

test("over-limit preferred foods and impossible multi-radio state are rejected without deleting values", async () => {
  const f = fixture(); await f.ready(); f.fill();
  f.inputs("preferredFoods").forEach((input, index) => { input.checked = index >= 1 && index <= 4; });
  f.inputs("primaryGoal")[1].checked = true;
  const before = f.snapshot(); await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(f.nodes.get("surveyValidationList").children.length, 2);
  assert.equal(f.snapshot(), before);
});

test("all four arrays accept their allowed non-none boundary without loss", async () => {
  const f = fixture(); await f.ready(); f.fill();
  for (const spec of expected.filter(spec => spec.none)) {
    for (const value of spec.values.slice(1, spec.max + 1)) f.select(spec.name, value);
  }
  await f.submit();
  assert.equal(f.calls.length, 1);
  for (const spec of expected.filter(spec => spec.none)) {
    assert.deepEqual(f.calls[0].payload[spec.name], spec.values.slice(1, spec.max + 1));
  }
});

test("deselecting a required array does not clear its outstanding error", async () => {
  const f = fixture(); await f.ready(); await f.submit();
  const input = f.inputs("snackPattern")[0];
  input.checked = false; f.change(input);
  assert.equal(f.nodes.get("surveyValidationList").children.length, 14);
  assert.equal(input.attributes["aria-invalid"], "true");
});

test("consent booleans are never implicit or inferred from completed answers", async () => {
  const f = fixture(); await f.ready(); f.fill(); f.consent.checked = false; await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(f.consent.attributes["aria-invalid"], "true");
});

test("authenticated GET and exact v2 POST payload, completion banner and permanent resubmit lock", async () => {
  const f = fixture(); await f.ready(); f.fill(); const before = f.snapshot(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.match(f.gets[0], /^\.\.\/api\/recommendedMealSurvey\?id=meal-.*&token=a{48}$/);
  const { payload, url, headers } = f.calls[0];
  assert.equal(url, "../api/recommendedMealSurvey");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(payload).sort(), ["requestId", "accessToken", "schemaVersion", "consentVersion", "consent", "aiProcessingConsent", ...expected.map(spec => spec.name)].sort());
  assert.equal(payload.schemaVersion, "meal-choice-v2");
  assert.equal(payload.consentVersion, "synthetic-consent-v1");
  assert.equal(payload.consent, true);
  assert.equal(payload.aiProcessingConsent, true);
  for (const spec of expected) assert.deepEqual(payload[spec.name], spec.none ? [spec.values[0]] : spec.values[0]);
  assert.equal(f.form.hidden, true);
  assert.equal(f.button.disabled, true);
  assert.match(f.nodes.get("surveyMessageText").textContent, /설문 제출이 완료/);
  assert.equal(f.activeElement.id, "surveyMessage");
  assert.equal(f.snapshot(), before);
  await f.submit(); assert.equal(f.calls.length, 1);
});

test("in-flight duplicate submit is blocked and controls stay frozen until confirmation", async () => {
  let release;
  const f = fixture({ post: () => new Promise(resolve => { release = resolve; }) });
  await f.ready(); f.fill(); const first = f.submit(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.ok(f.form.elements.every(input => input.disabled));
  release({ ok: true, json: async () => ({ ok: true, status: "submitted" }) });
  await first;
  assert.equal(f.button.disabled, true);
});

for (const post of ["api-error", "invalid-json", "http-error", "missing-status", "wrong-status", "null-json", "empty-json", "network-error"]) {
  test(`${post}: answers retained, visible focused error and retry enabled`, async () => {
    const f = fixture({ post }); await f.ready(); f.fill(); const before = f.snapshot(); await f.submit();
    assert.equal(f.form.hidden, false);
    assert.equal(f.button.disabled, false);
    assert.equal(f.nodes.get("surveyMessage").hidden, false);
    assert.equal(f.nodes.get("surveyMessage").attributes.role, "alert");
    assert.equal(f.activeElement.id, "surveyMessage");
    assert.doesNotMatch(f.nodes.get("surveyMessageText").textContent, /제출이 완료/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.snapshot(), before);
    assert.ok(f.form.querySelectorAll("input").every(input => !input.disabled));
  });
}

test("manual retry accepts duplicate confirmation without resetting original answers", async () => {
  const f = fixture({ post: "network-error" }); await f.ready(); f.fill(); await f.submit();
  f.setPost("duplicate"); await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.form.hidden, true);
  assert.equal(f.button.disabled, true);
  assert.match(f.nodes.get("surveyMessageText").textContent, /이미 설문 제출이 완료/);
});

for (const reportReady of [false, true]) {
  test(`existing submitted response immutable; reportReady=${reportReady}`, async () => {
    const f = fixture({ configured: false, info: { status: "submitted", reportReady } }); await f.ready();
    assert.equal(f.form.hidden, true);
    assert.equal(f.button.disabled, true);
    assert.equal(f.nodes.get("mealReportLink").hidden, !reportReady);
    assert.match(f.nodes.get("surveyMessageText").textContent, /이미 설문 제출이 완료/);
    await f.submit(); assert.equal(f.calls.length, 0);
    if (reportReady) assert.match(f.nodes.get("mealReportLink").href, /^\.\.\/recommendedMealPlan\/\?id=meal-.*&token=a{48}$/);
  });
}

test("new confirmation can expose an authenticated ready report", async () => {
  const f = fixture({ post: "report-ready" }); await f.ready(); f.fill(); await f.submit();
  assert.equal(f.nodes.get("mealReportLink").hidden, false);
  assert.match(f.nodes.get("mealReportLink").href, /token=a{48}$/);
});

test("invalid link and failed authentication GET never permit POST", async () => {
  for (const options of [{ search: "?id=invalid&token=invalid" }, { getError: true }]) {
    const f = fixture(options); await f.ready(); await f.submit();
    assert.equal(f.form.hidden, true);
    assert.equal(f.button.disabled, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.nodes.get("surveyMessage").attributes.role, "alert");
    if (options.search) assert.equal(f.gets.length, 0);
  }
});

test("GET member display is escaped rather than rendered as supplied HTML", async () => {
  const f = fixture({ info: { memberName: '<img src=x onerror="bad()">' } }); await f.ready();
  assert.ok(f.nodes.get("surveyMeta").innerHTML.includes("&lt;img"));
  assert.ok(!f.nodes.get("surveyMeta").innerHTML.includes("<img"));
});
