import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../../archivein/recommendedMealSurvey/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function fixture({ post = "success", submitted = false } = {}) {
  const nodes = new Map();
  const calls = [];
  let activeElement;
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.hidden = true;
      this.textContent = "";
    }
    append(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { activeElement = this; }
    scrollIntoView() {}
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]);
    }
  }
  const fieldSpecs = [
    ["primaryGoal", "radio", "체지방 감량"], ["wakeTime", "time", "07:00"],
    ["sleepTime", "time", "23:00"], ["sleepQuality", "radio", "충분하고 규칙적"],
    ["workType", "select", "주로 앉아서 근무"], ["workIntensity", "radio", "보통"],
    ["mealsPerDay", "select", "3회"], ["breakfastPattern", "select", "거의 매일 먹음"],
    ["lateNightFrequency", "select", "거의 없음"], ["eatingOutFrequency", "select", "주 1회 이하"],
    ["cookingAccess", "select", "직접 조리 가능"], ["allergies", "checkbox", "없음"],
    ["avoidFoods", "textarea", "없음"], ["alcoholFrequency", "select", "마시지 않음"],
    ["smokingStatus", "select", "비흡연"], ["medicalConditions", "textarea", "없음"],
    ["medications", "textarea", "없음"], ["pregnancyStatus", "radio", "해당 없음"],
    ["eatingDisorderHistory", "radio", "없음"], ["consent", "checkbox", "yes"],
  ];
  const fields = fieldSpecs.map(([name, type, value]) => {
    const element = new Element("input");
    Object.assign(element, { name, type, value, checked: true, required: name !== "allergies" });
    Object.defineProperty(element, "validity", { get: () => ({ valid: !element.required || (["radio", "checkbox"].includes(type) ? element.checked : !!element.value) }) });
    const closest = element.closest.bind(element);
    element.closest = tag => ["fieldset", "label"].includes(tag)
      ? { querySelector: () => ({ textContent: name }) } : closest(tag);
    return element;
  });
  const form = new Element("form");
  const button = new Element("button");
  button.disabled = false;
  form.elements = fields;
  form.querySelectorAll = selector => selector.includes('name="allergies"')
    ? fields.filter(field => field.name === "allergies" && (!selector.includes(":checked") || field.checked)) : fields;
  form.querySelector = selector => selector === 'button[type="submit"]' ? button
    : fields.find(field => field.name === "allergies" && (!selector.includes(":checked") || field.checked)) || null;
  nodes.set("mealSurveyForm", form);
  for (const id of ["surveyMeta", "surveyMessage", "surveyMessageText", "mealReportLink", "surveyValidation", "surveyValidationList"]) {
    const element = new Element(); element.id = id; nodes.set(id, element);
  }
  const document = {
    getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag),
  };
  Object.defineProperty(document, "activeElement", { get: () => activeElement });
  const info = { ok: true, status: submitted ? "submitted" : "sent", memberName: "합성 테스트", inbodyStatus: "missing" };
  const context = vm.createContext({
    document, URLSearchParams, HTMLInputElement: Element,
    location: { search: `?id=meal-2026-10-20-0000000000000000&token=${"a".repeat(48)}` },
    window: { scrollTo() {} },
    FormData: class {
      get(name) { const field = fields.find(row => row.name === name); return !field || (["checkbox", "radio"].includes(field.type) && !field.checked) ? null : field.value; }
    },
    fetch: async (_url, options) => {
      if (options?.method !== "POST") return { ok: true, json: async () => info };
      calls.push(JSON.parse(options.body));
      if (post === "network-error") throw new Error("테스트 네트워크 오류");
      if (typeof post === "function") return post();
      return {
        ok: post !== "http-error",
        json: async () => {
          if (post === "invalid-json") throw new Error("invalid JSON");
          if (post === "api-error") return { ok: false, error: "테스트 서버 오류" };
          if (post === "null-json") return null;
          if (post === "empty-json") return {};
          if (post === "missing-status") return { ok: true };
          if (post === "wrong-status") return { ok: true, status: "pending" };
          if (post === "duplicate") return { ok: true, status: "submitted", duplicate: true };
          return { ok: true, status: "submitted" };
        },
      };
    },
  });
  vm.runInContext(script, context);
  return {
    form, button, nodes, fields, calls, document,
    ready: async () => { await new Promise(resolve => setImmediate(resolve)); },
    setPost: value => { post = value; },
    field: name => fields.find(field => field.name === name),
    submit: () => form.listeners.submit[0]({ preventDefault() {} }),
    edit: name => form.listeners.input[0]({ target: fields.find(field => field.name === name) }),
  };
}

test("required validation and whitespace block POST without deleting values", async () => {
  const f = fixture(); await f.ready();
  f.field("wakeTime").value = "";
  f.field("avoidFoods").value = "   ";
  await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(f.nodes.get("surveyValidationList").children.length, 2);
  assert.equal(f.document.activeElement.id, "surveyValidation");
  assert.equal(f.field("avoidFoods").value, "   ");
  assert.equal(f.form.hidden, false);
});

test("missing allergy and consent are blocked without weakening validation", async () => {
  const f = fixture(); await f.ready();
  f.field("allergies").checked = false;
  f.field("consent").checked = false;
  await f.submit();
  assert.equal(f.calls.length, 0);
  assert.equal(f.nodes.get("surveyValidationList").children.length, 2);
  assert.equal(f.field("consent").attributes["aria-invalid"], "true");
});

test("correcting a missing field clears its summary and indicator", async () => {
  const f = fixture(); await f.ready();
  f.field("wakeTime").value = "";
  await f.submit();
  f.field("wakeTime").value = "07:30";
  f.edit("wakeTime");
  assert.equal(f.nodes.get("surveyValidation").hidden, true);
  assert.equal(f.field("wakeTime").attributes["aria-invalid"], undefined);
});

test("summary links focus the missing control without altering its value", async () => {
  const f = fixture(); await f.ready();
  f.field("wakeTime").value = "";
  await f.submit();
  const link = f.nodes.get("surveyValidationList").children[0].children[0];
  link.listeners.click[0]({ preventDefault() {} });
  assert.equal(f.document.activeElement, f.field("wakeTime"));
  assert.equal(f.field("wakeTime").value, "");
});

test("successful submission sends original answers once and shows confirmation", async () => {
  const f = fixture(); await f.ready(); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].avoidFoods, "없음");
  assert.equal(f.calls[0].consent, true);
  assert.deepEqual(f.calls[0].allergies, ["없음"]);
  assert.equal(f.form.hidden, true);
  assert.match(f.nodes.get("surveyMessageText").textContent, /제출이 완료/);
});

test("in-flight double click produces exactly one request", async () => {
  let release;
  const f = fixture({ post: () => new Promise(resolve => { release = resolve; }) });
  await f.ready(); const first = f.submit(); await f.submit();
  assert.equal(f.calls.length, 1);
  release({ ok: true, json: async () => ({ ok: true, status: "submitted" }) });
  await first;
  assert.equal(f.form.hidden, true);
});

for (const post of ["api-error", "invalid-json", "http-error", "missing-status", "wrong-status", "null-json", "empty-json", "network-error"]) {
  test(`${post} preserves answers, restores button, and focuses visible error`, async () => {
    const f = fixture({ post }); await f.ready();
    const before = JSON.stringify(f.fields.map(({ name, value, checked }) => ({ name, value, checked })));
    await f.submit();
    assert.equal(f.form.hidden, false);
    assert.equal(f.field("medicalConditions").value, "없음");
    assert.equal(f.button.disabled, false);
    assert.equal(f.nodes.get("surveyMessage").hidden, false);
    assert.equal(f.nodes.get("surveyMessage").attributes.role, "alert");
    assert.equal(f.document.activeElement.id, "surveyMessage");
    assert.doesNotMatch(f.nodes.get("surveyMessageText").textContent, /제출이 완료/);
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.fields.map(({ name, value, checked }) => ({ name, value, checked }))), before);
  });
}

test("manual retry clears previous error and server duplicate confirmation is accepted", async () => {
  const f = fixture({ post: "network-error" }); await f.ready(); await f.submit();
  assert.equal(f.form.hidden, false);
  f.setPost("duplicate");
  await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.form.hidden, true);
  assert.match(f.nodes.get("surveyMessageText").textContent, /제출이 완료/);
});

test("existing submitted survey stays read-only without another POST", async () => {
  const f = fixture({ submitted: true }); await f.ready();
  assert.equal(f.form.hidden, true);
  assert.equal(f.calls.length, 0);
  assert.match(f.nodes.get("surveyMessageText").textContent, /이미 설문 제출이 완료/);
});
