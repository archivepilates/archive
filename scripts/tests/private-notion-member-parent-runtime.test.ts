import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { ensurePrivateNotionMemberPage, privateNotionMemberIdentity } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionMemberPage";
import { stableHash } from "../../firebase/kangsain-functions/functions/src/utils/hash";

const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
const ts = requireFunctions("typescript");
const source = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
const declaration = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "ensureInstructorMemberPage");
assert.ok(declaration, "Exercise the production adapter, not a test replacement");
const compiled = ts.transpileModule(declaration.getText(tree), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const root = "1".repeat(32), pageId = "2".repeat(32);

function fixture() {
  const docs = new Map<string, any>(), calls: string[] = [];
  let existing = false, beforeReturn: (() => void) | undefined;
  let onCreate: (() => Promise<void>) | undefined;
  let beforeProviderAttempt: (() => void) | undefined;
  const ref = (key: string) => ({ key });
  const snap = (r: any) => ({ data: () => docs.has(r.key) ? structuredClone(docs.get(r.key)) : undefined });
  let queue = Promise.resolve();
  const db = {
    getAll: async (...refs: any[]) => refs.map(snap),
    runTransaction: (fn: any) => {
      const result = queue.then(async () => {
        const writes = new Map<string, any>();
        const value = await fn({ getAll: async (...refs: any[]) => refs.map(snap),
          set: (r: any, value: any) => writes.set(r.key, structuredClone(value)) });
        for (const [key, value] of writes) docs.set(key, value);
        return value;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const seed = (memberId: string, recordId: string) => {
    const record: any = { recordId, requestId: recordId, studioId: "5330", memberId, memberName: "Test Member",
      staffId: "200", staffName: "Test Instructor", bookingId: recordId, memberPhone: "01000000000", postSubmittedAt: "submitted" };
    const request = { ...record, postStatus: "submitted" };
    docs.set(`record/${recordId}`, record); docs.set(`request/${recordId}`, request);
    docs.set(`member/${memberId}`, { memberId, studioId: "5330", name: "Test Member", phone: "01000000000" });
    docs.set("staff/200", { staffId: "200", studioId: "5330", active: true, role: "instructor", name: "Test Instructor" });
    return { record, request };
  };
  const ensure = vm.runInNewContext(`${compiled}\nensureInstructorMemberPage`, {
    db, ensurePrivateNotionMemberPage, privateNotionMemberIdentity, stableHash,
    NOTION_INSTRUCTOR_CHART_PAGE_IDS: { "Test Instructor": root },
    refs: { privateLessonChartRecord: (id: string) => ref(`record/${id}`),
      privateLessonChartRequest: (id: string) => ref(`request/${id}`),
      memberProfile: (id: string) => ref(`member/${id}`), staff: (id: string) => ref(`staff/${id}`), syncState: (id: string) => ref(`sync/${id}`) },
    nowTimestamp: () => "test-only-timestamp", notionTitle: (title: string) => ({ title }),
    errorMessage: (error: any) => String(error.message),
    findInstructorMemberPageId: async () => { beforeReturn?.(); return existing ? pageId : ""; },
    notionRequest: async (endpoint: string, method: string, body?: any, beforeDispatch?: () => Promise<void>) => {
      if (method === "POST") {
        beforeProviderAttempt?.();
        await beforeDispatch?.();
        calls.push(`${method} ${endpoint}`);
        assert.equal(endpoint, "pages"); assert.equal(body.parent.page_id, root);
        assert.ok(!JSON.stringify(body).includes("01000000000"), "Folder creation must not send a phone");
        await onCreate?.(); return { id: pageId };
      }
      calls.push(`${method} ${endpoint}`);
      assert.equal(method, "GET"); assert.equal(endpoint, `pages/${pageId}`);
      return { id: pageId, parent: { page_id: root }, archived: false, in_trash: false };
    },
  });
  return { docs, calls, seed, ensure, setExisting: () => { existing = true; },
    beforeLookupReturns: (hook: () => void) => { beforeReturn = hook; },
    onCreate: (hook: () => Promise<void>) => { onCreate = hook; },
    beforeProviderAttempt: (hook: () => void) => { beforeProviderAttempt = hook; } };
}

test("production adapter shares one member folder across separate lesson records", async () => {
  const f = fixture(), first = f.seed("100", "record-a"), second = f.seed("100", "record-b");
  assert.equal(await f.ensure(first.record, first.request), pageId);
  assert.equal(await f.ensure(second.record, second.request), pageId);
  assert.equal(f.calls.filter(c => c === "POST pages").length, 1);
});

test("production title claim blocks concurrent namesakes before a second create", async () => {
  const f = fixture(), first = f.seed("100", "record-a"), other = f.seed("101", "record-b");
  let release!: () => void, signal!: () => void;
  const started = new Promise<void>(r => { signal = r; }), gate = new Promise<void>(r => { release = r; });
  f.onCreate(async () => { signal(); await gate; });
  const created = f.ensure(first.record, first.request); await started;
  try { await assert.rejects(f.ensure(other.record, other.request)); }
  finally { release(); }
  assert.equal(await created, pageId);
  assert.equal(f.calls.filter(c => c === "POST pages").length, 1);
});

test("unbound same-name page stays review-only and is never adopted or duplicated", async () => {
  const f = fixture(), seeded = f.seed("100", "record-a"); f.setExisting();
  await assert.rejects(f.ensure(seeded.record, seeded.request));
  assert.equal(f.calls.length, 0);
});

test("identity is refreshed after the Notion lookup immediately before creation", async () => {
  const f = fixture(), seeded = f.seed("100", "record-a");
  f.beforeLookupReturns(() => { f.docs.get("member/100").phone = "01099999999"; });
  await assert.rejects(f.ensure(seeded.record, seeded.request));
  assert.equal(f.calls.length, 0);
});

test("positively rejected title claim permits a different verified namesake", async () => {
  const f = fixture(), first = f.seed("100", "record-a"), other = f.seed("101", "record-b");
  f.onCreate(async () => { throw new Error("Notion API pages failed 403: fake explicit rejection"); });
  await assert.rejects(f.ensure(first.record, first.request));
  f.onCreate(async () => {});
  assert.equal(await f.ensure(other.record, other.request), pageId);
  assert.equal(f.calls.filter(c => c === "POST pages").length, 2);
});

test("transport-wait cancellation blocks POST and releases an unaccepted title", async () => {
  const f = fixture(), first = f.seed("100", "record-a"), other = f.seed("101", "record-b");
  f.beforeProviderAttempt(() => { f.docs.get("request/record-a").status = "cancelled"; });
  await assert.rejects(f.ensure(first.record, first.request));
  assert.equal(f.calls.length, 0);
  f.beforeProviderAttempt(() => {});
  assert.equal(await f.ensure(other.record, other.request), pageId);
  assert.equal(f.calls.filter(c => c === "POST pages").length, 1);
});

const transportDeclaration = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "notionRequest");
assert.ok(transportDeclaration);
const transportCompiled = ts.transpileModule(transportDeclaration.getText(tree), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const rejectedFirstAttempt of [false, true]) {
  test(`production transport revalidates after ${rejectedFirstAttempt ? "429 retry" : "throttle"} wait`, async () => {
    let invalid = false, fetches = 0, checks = 0;
    const send = vm.runInNewContext(`${transportCompiled}\nnotionRequest`, {
      notionNextRequestAt: rejectedFirstAttempt ? 0 : 1200,
      Date: { now: () => 1000 }, AbortSignal,
      setTimeout: (callback: () => void) => { invalid = true; callback(); },
      notionToken: { value: () => "FAKE_OFFLINE_TOKEN" }, NOTION_API_VERSION: "2022-06-28",
      fetch: async () => { fetches++; return { ok: false, status: 429,
        headers: { get: () => "1" }, text: async () => "{}" }; },
    });
    await assert.rejects(send("pages", "POST", {}, async () => { checks++; if (invalid) throw Error("fake cancelled source"); }));
    assert.equal(fetches, rejectedFirstAttempt ? 1 : 0);
    assert.equal(checks, rejectedFirstAttempt ? 2 : 1);
  });
}
