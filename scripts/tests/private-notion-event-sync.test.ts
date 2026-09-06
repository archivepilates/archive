import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import {
  PRIVATE_NOTION_LEASE_MS,
  assertPrivateNotionPageOwner,
  privateNotionSourceChanged,
  reconcilePrivateNotionPages,
  runPrivateNotionProjection,
  type PrivateNotionSource,
  type PrivateNotionState,
  type PrivateNotionStore,
  type PrivateNotionRepairCursor,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionSync";
import { privateLessonNotionProjectionVersion, isManagedPrivateNotionBlock, notionSessionTitle, privateNotionArchiveBlock, privateNotionBlockFingerprint } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart";

function notionTextBlock(id: string, content: string, type = "paragraph"): any {
  return { id, object: "block", type, has_children: false, [type]: {
    rich_text: [{ type: "text", text: { content } }], color: "default",
  } };
}

function notionToggle(id: string, label: string): any {
  return { ...notionTextBlock(id, label, "toggle"), has_children: true };
}

function nestedNotionBlock(id: string, label: string, children: any[], type = "toggle"): any {
  const block = notionTextBlock(id, label, type);
  block.has_children = children.length > 0;
  block[type].children = children;
  return block;
}

function replacementSource(): string {
  const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
  const ts = requireFunctions("typescript");
  const source = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
  const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
  const declaration = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "replacePageContent");
  assert.ok(declaration, "Exercise the real replacement function, not a test implementation");
  return declaration.getText(tree);
}

function replacementHarness(initial: any[], initialHashes?: Record<string, string>) {
  const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
  const ts = requireFunctions("typescript");
  const compiled = ts.transpileModule(replacementSource(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pageId = "00000000-0000-4000-8000-000000000001";
  const blocks = new Map<string, any>();
  const childIds = new Map<string, string[]>([[pageId, []]]);
  const events: { action: string; id?: string; hashes?: Record<string, string> }[] = [];
  const hooks: { beforeGet?: (id: string) => void; failAfterDeletes?: number; failCheckpoint?: boolean } = {};
  let hashes = initialHashes ? structuredClone(initialHashes) : undefined;
  let sequence = 0;
  let deleted = 0;
  const insert = (input: any, parent = pageId): string => {
    const block = structuredClone(input);
    const nested = block[block.type]?.children || [];
    delete block[block.type].children;
    block.id ||= `generated-${++sequence}`;
    block.has_children = nested.length > 0;
    blocks.set(block.id, block);
    childIds.set(block.id, []);
    childIds.set(parent, [...(childIds.get(parent) || []), block.id]);
    if (blocks.has(parent)) blocks.get(parent).has_children = true;
    for (const child of nested) insert(child, block.id);
    return block.id;
  };
  for (const block of initial) insert(block);
  const children = (id: string): any[] => (childIds.get(id) || []).map((key) => structuredClone(blocks.get(key)));
  const top = () => children(pageId);
  const ownerRef = {
    get: async () => ({ data: () => hashes === undefined ? {} : { managedBlockHashes: structuredClone(hashes) } }),
    set: async (data: any, options: any) => {
      assert.equal(options.merge, true);
      if (hooks.failCheckpoint) { hooks.failCheckpoint = false; throw new Error("checkpoint unavailable"); }
      hashes = structuredClone(data.managedBlockHashes);
      events.push({ action: "checkpoint", hashes: structuredClone(hashes) });
    },
    update: async (data: any) => {
      hashes = structuredClone(data.managedBlockHashes);
      events.push({ action: "finalize", hashes: structuredClone(hashes) });
    },
  };
  // Only this declaration runs in the VM. All external dependencies are in-memory fakes.
  const replace = vm.runInNewContext(`${compiled}\nreplacePageContent;`, {
    privateNotionBlockFingerprint, privateNotionArchiveBlock, isManagedPrivateNotionBlock,
    refs: { syncState: (key: string) => {
      assert.equal(key, "privateNotionPage_00000000000040008000000000000001");
      return ownerRef;
    } },
    notionBlockChildren: async (id: string) => { events.push({ action: "children:get", id }); return children(id); },
    appendPageContent: async (id: string, next: any[]) => {
      events.push({ action: "append", id });
      return next.map((block) => structuredClone(blocks.get(insert(block, id))));
    },
    notionRequest: async (endpoint: string, method: string) => {
      assert.match(endpoint, /^blocks\/[^/]+$/);
      const id = endpoint.split("/")[1];
      assert.ok(blocks.has(id), `Unknown fixture block: ${id}`);
      if (method === "GET") {
        events.push({ action: "get", id });
        hooks.beforeGet?.(id);
        return structuredClone(blocks.get(id));
      }
      assert.equal(method, "DELETE", "No unmocked external action is allowed");
      if (hooks.failAfterDeletes !== undefined && deleted >= hooks.failAfterDeletes) {
        hooks.failAfterDeletes = undefined;
        events.push({ action: "delete:failed", id });
        throw new Error("delete interrupted");
      }
      events.push({ action: "delete", id });
      deleted++;
      blocks.delete(id);
      for (const [parent, ids] of childIds) childIds.set(parent, ids.filter((key) => key !== id));
      return {};
    },
  });
  return {
    events, hooks, top, children, insert,
    block: (id: string) => { assert.ok(blocks.has(id)); return blocks.get(id); },
    hashes: () => structuredClone(hashes),
    replace: (next: any[]) => replace(pageId, next, async () => { events.push({ action: "guard" }); }) as Promise<void>,
  };
}

function generatedNotionBody(): any[] {
  return [
    notionTextBlock("", "오늘 기록", "heading_3"),
    ...["회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"].map((title) =>
      nestedNotionBlock("", title, [notionTextBlock("", `${title} 생성 원문`)])),
  ];
}

function notionBlockText(block: any): string {
  return (block[block.type]?.rich_text || []).map((item: any) => item.text?.content || item.plain_text || "").join("");
}

function harness() {
  let time = 1_800_000_000_000;
  let source: PrivateNotionSource | null = {
    record: { recordId: "test", requestId: "test", postRecord: { changes: "A" }, notionSync: { status: "pending" } } as any,
    request: { requestId: "test", lessonDate: "2026-09-06" } as any,
  };
  const store: PrivateNotionStore = {
    async transact(_id, update) {
      const next = update(source ? structuredClone(source) : null);
      if (source && next.state) source.record.notionSync = structuredClone(next.state);
      return next.result;
    },
  };
  let calls = 0;
  const deps = {
    store,
    now: () => time,
    version: (s: PrivateNotionSource) => JSON.stringify([s.record.postRecord, s.request?.lessonDate]),
    project: async (): Promise<PrivateNotionState> => { calls++; return { status: "synced", instructorPageId: "page" }; },
  };
  return { deps, get source() { return source!; }, get calls() { return calls; }, advance: (ms: number) => { time += ms; }, remove: () => { source = null; } };
}

test("display aliases never project or mutate instructor answers, including nightly recovery", async () => {
  const h = harness();
  h.source.control = { aliasOfRecordId: "canonical" };
  const before = structuredClone(h.source);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "skipped");
  assert.equal(h.calls, 0);
  assert.deepEqual(h.source, before);
});

test("page ownership fails closed for shared and conflicting owners", () => {
  assert.doesNotThrow(() => assertPrivateNotionPageOwner("a", "", ["a"]));
  assert.doesNotThrow(() => assertPrivateNotionPageOwner("a", "a", ["a", "old"]));
  assert.throws(() => assertPrivateNotionPageOwner("old", "a", []), /덮어쓰기/);
  assert.throws(() => assertPrivateNotionPageOwner("a", "", ["a", "b"]), /덮어쓰기/);
});

test("an alias introduced mid-flight cannot checkpoint or acknowledge success", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async (_source, checkpoint) => {
    h.source.control = { aliasOfRecordId: "canonical" };
    await assert.rejects(checkpoint({ instructorPageId: "wrong" }), /lease lost/);
    return { status: "synced" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.instructorPageId, undefined);
});

test("first migration selects only leaf text and never selects untracked toggles or nested content", () => {
  for (const title of ["이전 양식 기록", "강사 메모", "회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"]) {
    for (const has_children of [true, false]) {
      assert.equal(isManagedPrivateNotionBlock({ ...notionToggle("manual", title), has_children }), false);
    }
  }
  for (const type of ["child_page", "child_database", "file", "image", "video", "table"]) assert.equal(isManagedPrivateNotionBlock({ type }), false);
  assert.equal(isManagedPrivateNotionBlock({ type: "paragraph", has_children: true }), false);
  assert.equal(isManagedPrivateNotionBlock({ type: "callout", has_children: false }), true);
  assert.equal(isManagedPrivateNotionBlock(notionTextBlock("legacy", "기존 수업 기록")), true);
});

test("registered blocks require both matching id and content, not a matching generated toggle title", () => {
  for (const title of ["회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"]) {
    const generated = notionToggle("generated", title);
    const children = [notionTextBlock("child", "수업 자료 원문")];
    const hashes = { generated: privateNotionBlockFingerprint(generated, children) };
    assert.equal(isManagedPrivateNotionBlock(generated, hashes, children), true);
    assert.equal(isManagedPrivateNotionBlock({ ...generated, id: "manual-same-title" }, hashes, children), false);
    assert.equal(isManagedPrivateNotionBlock(generated, { generated: "different-hash" }, children), false);
    assert.equal(isManagedPrivateNotionBlock(generated, {}, children), false);
    assert.equal(isManagedPrivateNotionBlock({ ...generated, id: undefined }, hashes, children), false);
  }
});

test("new manual paragraphs stay untracked even when their contents equal a generated paragraph", () => {
  const generated = notionTextBlock("generated", "같은 내용");
  const manual = { ...structuredClone(generated), id: "manual" };
  const hashes = { generated: privateNotionBlockFingerprint(generated) };
  assert.equal(isManagedPrivateNotionBlock(generated, hashes), true);
  assert.equal(isManagedPrivateNotionBlock(manual, hashes), false);
  assert.equal(isManagedPrivateNotionBlock(manual, {}), false);
  assert.equal(isManagedPrivateNotionBlock(manual), true);
});

test("fingerprints ignore response metadata but retain text, links, formatting and long suffix edits", () => {
  const block = notionTextBlock("generated", "긴 기록\n" + "가".repeat(4000) + "끝");
  const original = structuredClone(block);
  const fingerprint = privateNotionBlockFingerprint(block);
  const response = { ...structuredClone(block), created_time: "2026-09-06", last_edited_time: "2026-09-07", archived: false };
  response.paragraph.rich_text[0].plain_text = block.paragraph.rich_text[0].text.content;
  response.paragraph.rich_text[0].href = null;
  assert.equal(privateNotionBlockFingerprint(response), fingerprint);
  for (const change of [
    (b: any) => { b.paragraph.rich_text[0].text.content += "수정"; },
    (b: any) => { b.paragraph.rich_text[0].text.link = { url: "https://example.com/manual" }; },
    (b: any) => { b.paragraph.rich_text[0].annotations = { bold: true }; },
    (b: any) => { b.paragraph.color = "gray"; },
  ]) {
    const edited = structuredClone(block);
    change(edited);
    assert.notEqual(privateNotionBlockFingerprint(edited), fingerprint);
    assert.equal(isManagedPrivateNotionBlock(edited, { generated: fingerprint }), false);
  }
  assert.deepEqual(block, original);
});

test("manual child edits, additions, removals and reordering make a generated toggle ineligible for deletion", () => {
  const toggle = notionToggle("generated", "홈워크");
  const children = [notionTextBlock("a", "첫 번째 원문"), notionTextBlock("b", "두 번째 원문")];
  const original = structuredClone(children);
  const hashes = { generated: privateNotionBlockFingerprint(toggle, children) };
  assert.equal(isManagedPrivateNotionBlock(toggle, hashes, structuredClone(children)), true);
  for (const edited of [
    [notionTextBlock("a", "강사 수동 수정"), children[1]],
    [...children, notionTextBlock("manual", "추가 홈워크")],
    [children[0]],
    [...children].reverse(),
    [],
  ]) assert.equal(isManagedPrivateNotionBlock(toggle, hashes, edited), false);
  assert.deepEqual(children, original);
});

test("raw child arrays and recursive child hashes give the same fingerprint including descendants", () => {
  const toggle = notionToggle("generated", "홈워크");
  const descendant = notionTextBlock("descendant", "하위 원문");
  const child = { ...notionToggle("child", "세부 기록"), children: [descendant] };
  const expected = privateNotionBlockFingerprint(toggle, [child]);
  assert.equal(privateNotionBlockFingerprint(toggle, [privateNotionBlockFingerprint(child, [descendant])]), expected);
  assert.equal(isManagedPrivateNotionBlock(toggle, { generated: expected }, [privateNotionBlockFingerprint(child, [descendant])]), true);
  const edited = { ...child, children: [notionTextBlock("descendant", "수동 수정 원문")] };
  assert.notEqual(privateNotionBlockFingerprint(toggle, [edited]), expected);
  assert.equal(isManagedPrivateNotionBlock(toggle, { generated: expected }, [edited]), false);
});

test("real replacement adds missing legacy leaves to an existing archive and preserves later manual additions", async () => {
  const history = nestedNotionBlock("history", "이전 양식 기록", [notionTextBlock("saved", "기존 기록")]);
  const manual = nestedNotionBlock("manual-homework", "홈워크", [notionTextBlock("manual-child", "수동 홈워크")]);
  const nested = nestedNotionBlock("manual-nested", "수동 문단", [notionTextBlock("nested-child", "하위 원문")], "paragraph");
  const h = replacementHarness([
    history, manual, nested,
    notionTextBlock("already-saved", "기존 기록"),
    notionTextBlock("late-legacy", "아카이브 후\n추가 기록"),
  ]);
  await h.replace(generatedNotionBody());
  assert.deepEqual(h.children("history").map(notionBlockText), ["기존 기록", "아카이브 후\n추가 기록"]);
  assert.ok(h.top().some((block) => block.id === "manual-homework"));
  assert.ok(h.top().some((block) => block.id === "manual-nested"));
  assert.equal(h.top().some((block) => ["already-saved", "late-legacy"].includes(block.id)), false);
  assert.equal(notionBlockText(h.children("manual-homework")[0]), "수동 홈워크");

  h.insert(notionTextBlock("later-manual", "이관 후 새 메모"));
  await h.replace(generatedNotionBody());
  assert.ok(h.top().some((block) => block.id === "later-manual"));
  assert.equal(h.top().filter((block) => notionBlockText(block) === "이전 양식 기록").length, 1);
  assert.deepEqual(h.children("history").map(notionBlockText), ["기존 기록", "아카이브 후\n추가 기록"]);
  assert.equal(h.events.some((event) => event.action === "delete" && ["history", "manual-homework", "manual-nested", "later-manual"].includes(event.id || "")), false);
});

test("real replacement creates a verified archive before deleting first-migration leaf text", async () => {
  const h = replacementHarness([notionTextBlock("legacy", "보존할 원문\n" + "가".repeat(4000))]);
  await h.replace(generatedNotionBody());
  const history = h.top().find((block) => notionBlockText(block) === "이전 양식 기록");
  assert.ok(history);
  assert.equal(notionBlockText(h.children(history.id)[0]), "보존할 원문\n" + "가".repeat(4000));
  const deletion = h.events.findIndex((event) => event.action === "delete" && event.id === "legacy");
  assert.ok(deletion > 0);
  assert.ok(h.events.slice(0, deletion).some((event) => event.action === "children:get" && event.id === history.id));
});

test("repeated replacement keeps one generated toggle per title alongside identical-title manual toggles", async () => {
  const titles = ["회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"];
  const h = replacementHarness(titles.map((title, index) =>
    nestedNotionBlock(`manual-${index}`, title, [notionTextBlock(`manual-child-${index}`, "수동 원문")])), {});
  for (let attempt = 0; attempt < 3; attempt++) await h.replace(generatedNotionBody());
  for (const [index, title] of titles.entries()) {
    assert.ok(h.top().some((block) => block.id === `manual-${index}`));
    const generated = h.top().filter((block) => block.type === "toggle" && notionBlockText(block) === title &&
      isManagedPrivateNotionBlock(block, h.hashes(), h.children(block.id)));
    assert.equal(generated.length, 1, `${title}: one tracked generated block after three replacements`);
    assert.equal(h.top().filter((block) => block.type === "toggle" && notionBlockText(block) === title).length, 2);
  }
  assert.equal(h.top().filter((block) => block.type === "heading_3" && notionBlockText(block) === "오늘 기록").length, 1);
});

test("manually edited generated toggle children survive the real replacement", async () => {
  const h = replacementHarness([], {});
  await h.replace(generatedNotionBody());
  const homework = h.top().find((block) => block.type === "toggle" && notionBlockText(block) === "홈워크")!;
  const child = h.children(homework.id)[0];
  h.block(child.id).paragraph.rich_text[0].text.content = "강사가 수정한 홈워크";
  await h.replace(generatedNotionBody());
  assert.ok(h.top().some((block) => block.id === homework.id));
  assert.equal(notionBlockText(h.children(homework.id)[0]), "강사가 수정한 홈워크");
  assert.equal(h.events.some((event) => event.action === "delete" && event.id === homework.id), false);
});

test("latest GET and recursive fingerprint revalidation preserve edits made after the deletion plan", async () => {
  const h = replacementHarness([], {});
  await h.replace(generatedNotionBody());
  const heading = h.top().find((block) => block.type === "heading_3")!;
  const homework = h.top().find((block) => block.type === "toggle" && notionBlockText(block) === "홈워크")!;
  const child = h.children(homework.id)[0];
  h.hooks.beforeGet = (id) => {
    if (id === heading.id) h.block(id).heading_3.rich_text[0].text.content = "삭제 직전 수동 제목";
    if (id === homework.id) h.block(child.id).paragraph.rich_text[0].text.content = "삭제 직전 수동 홈워크";
  };
  await h.replace(generatedNotionBody());
  assert.equal(notionBlockText(h.block(heading.id)), "삭제 직전 수동 제목");
  assert.equal(notionBlockText(h.children(homework.id)[0]), "삭제 직전 수동 홈워크");
  for (const id of [heading.id, homework.id]) {
    assert.ok(h.top().some((block) => block.id === id));
    assert.ok(h.events.some((event) => event.action === "get" && event.id === id));
    assert.equal(h.events.some((event) => event.action === "delete" && event.id === id), false);
  }
});

test("checkpoint-before-delete tracks appended ids through a partial deletion failure without retry duplicates", async () => {
  const h = replacementHarness([], {});
  await h.replace(generatedNotionBody());
  const originalIds = new Set(h.top().map((block) => block.id));
  h.hooks.failAfterDeletes = 1;
  const start = h.events.length;
  await assert.rejects(h.replace(generatedNotionBody()), /delete interrupted/);
  const partialEvents = h.events.slice(start);
  const checkpoint = partialEvents.findIndex((event) => event.action === "checkpoint");
  const firstDelete = partialEvents.findIndex((event) => event.action === "delete");
  assert.ok(checkpoint >= 0 && firstDelete > checkpoint);
  const appended = h.top().filter((block) => !originalIds.has(block.id));
  assert.equal(appended.length, 5);
  for (const block of appended) {
    assert.ok(partialEvents[checkpoint].hashes?.[block.id]);
    assert.equal(isManagedPrivateNotionBlock(block, h.hashes(), h.children(block.id)), true);
  }
  await h.replace(generatedNotionBody());
  assert.equal(h.top().length, 5);
  assert.equal(h.top().some((block) => originalIds.has(block.id)), false);
  for (const title of ["회원 사전설문 참고", "홈워크", "주의사항", "수업 자료"]) {
    assert.equal(h.top().filter((block) => block.type === "toggle" && notionBlockText(block) === title).length, 1);
  }
  for (const [index, event] of h.events.entries()) {
    if (event.action !== "delete") continue;
    assert.ok(h.events.slice(0, index).some((before) => before.action === "get" && before.id === event.id));
    assert.ok(h.events.slice(0, index).some((before) => before.action === "checkpoint" && before.hashes?.[event.id!]), "Deleted block has a persisted id/hash");
  }
});

test("first-migration retry removes checkpointed legacy originals without duplicating today's record heading", async () => {
  const legacy = [
    notionTextBlock("legacy-intro", "기존 소개"),
    notionTextBlock("legacy-heading", "오늘 기록", "heading_3"),
    notionTextBlock("legacy-answer", "강사 원본 기록"),
  ];
  const h = replacementHarness(legacy);
  h.hooks.failAfterDeletes = 1;
  await assert.rejects(h.replace(generatedNotionBody()), /delete interrupted/);
  await h.replace(generatedNotionBody());
  const history = h.top().find((block) => notionBlockText(block) === "이전 양식 기록");
  assert.ok(history);
  assert.deepEqual(h.children(history.id).map(notionBlockText), legacy.map(notionBlockText));
  assert.equal(h.top().filter((block) => block.type === "heading_3" && notionBlockText(block) === "오늘 기록").length, 1);
  assert.equal(h.top().some((block) => legacy.some((original) => original.id === block.id)), false);
});

test("a failed identity checkpoint never starts deletion", async () => {
  const h = replacementHarness([], {});
  await h.replace(generatedNotionBody());
  const originalIds = h.top().map((block) => block.id);
  h.hooks.failCheckpoint = true;
  await assert.rejects(h.replace(generatedNotionBody()), /checkpoint unavailable/);
  assert.equal(h.events.some((event) => event.action === "delete"), false);
  for (const id of originalIds) assert.ok(h.top().some((block) => block.id === id));
});

test("replacement source contract checkpoints id/hash ownership before deletes and rechecks latest GET content", () => {
  const source = replacementSource();
  assert.match(source, /refs\.syncState\(`privateNotionPage_\$\{pageId\.replaceAll/);
  assert.match(source, /owner\?\.managedBlockHashes/);
  assert.match(source, /Object\.hasOwn\(hashes, block\.id\)/);
  assert.match(source, /hash === hashes\[block\.id\]/);
  assert.match(source, /nextHashes\[block\.id\] = await fingerprint\(block\)/);
  const checkpoint = source.indexOf("await ownerRef.set({ managedBlockHashes: nextHashes }");
  const loop = source.indexOf("for (const child of removable)");
  const get = source.indexOf('await notionRequest(`blocks/${child.id}`, "GET")');
  const recheck = source.indexOf("await fingerprint(latest) !== child.hash");
  const deletion = source.indexOf('await notionRequest(`blocks/${child.id}`, "DELETE")');
  assert.ok(checkpoint >= 0 && checkpoint < loop && loop < get && get < recheck && recheck < deletion);
  assert.match(source, /block\.has_children \? await notionBlockChildren\(block\.id\)/);
  assert.match(source, /childHashes\.push\(await fingerprint\(child\)\)/);
});

test("Notion-only review hides unverified round/cancellation without changing canonical state", () => {
  const r: any = { memberName: "검증", sessionNumber: 99, cancelledAt: 1, notionProjectionControl: { reviewReason: "출석 확인필요" } };
  const q: any = { lessonDate: "2026-09-04", status: "cancelled" };
  assert.equal(notionSessionTitle(r, q), "2026.09.04 · 검증(확인필요)");
  assert.equal(q.status, "cancelled");
  assert.equal(r.sessionNumber, 99);
});

test("history clones only writable fields while preserving rich text and links", () => {
  const rich = { type: "text", text: { content: "기존 기록", link: { url: "https://example.com" } }, plain_text: "기존 기록", href: "https://example.com", annotations: { bold: true } };
  const block: any = privateNotionArchiveBlock({ type: "paragraph", paragraph: { rich_text: [rich], icon: null, color: "gray" } });
  assert.equal(block.paragraph.icon, undefined);
  assert.deepEqual(block.paragraph.rich_text, [{ type: "text", text: rich.text, annotations: rich.annotations }]);
  assert.equal(block.paragraph.color, "gray");
});

test("duplicate and out-of-order deliveries use the newest source once", async () => {
  const h = harness();
  h.source.record.postRecord = { changes: "C" };
  assert.equal(await runPrivateNotionProjection("test", h.deps), "synced");
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
  assert.equal(h.calls, 1);
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
});

test("repeated same-content save acknowledges pending without another Notion call", async () => {
  const h = harness();
  await runPrivateNotionProjection("test", h.deps);
  h.source.record.notionSync!.status = "pending";
  await runPrivateNotionProjection("test", h.deps);
  assert.equal(h.calls, 1);
  assert.equal(h.source.record.notionSync!.status, "synced");
});

test("sync metadata and lease writes do not self-trigger; stale completion wakes once", () => {
  const before = { postRecord: { changes: "A" }, updatedAt: 1, notionSync: { status: "pending" }, notionProjectionLease: { token: "owner" } };
  assert.equal(privateNotionSourceChanged(before, { ...before, updatedAt: 2 }), false);
  assert.equal(privateNotionSourceChanged(before, { ...before, notionSync: { status: "synced" }, notionProjectionLease: { token: "" } }), false);
  assert.equal(privateNotionSourceChanged(before, { ...before, notionProjectionLease: { token: "" } }), true);
  assert.equal(privateNotionSourceChanged(before, undefined), false);
});

test("event and nightly workers cannot write one chart concurrently", async () => {
  const h = harness();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let started!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const active = runPrivateNotionProjection("test", { ...h.deps, project: async () => { started(); await gate; return { status: "synced" }; } });
  await ready;
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "skipped");
  release();
  assert.equal(await active, "synced");
});

for (const succeeds of [true, false]) {
  test(`edit during ${succeeds ? "successful" : "failed"} projection retains latest pending intent`, async () => {
    const h = harness();
    const original = h.deps.version(h.source);
    const status = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
      h.source.record.postRecord = { changes: "B" };
      if (!succeeds) throw new Error("provider down");
      return { status: "synced" };
    } });
    assert.equal(status, "pending");
    assert.notEqual(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
    if (succeeds) assert.equal(h.source.record.notionSync?.sourceVersion, original);
    assert.equal(await runPrivateNotionProjection("test", h.deps), "synced");
  });
}

test("failure does not loop; night recovery retries unchanged source", async () => {
  const h = harness();
  const original = structuredClone(h.source.record.postRecord);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, project: async () => { throw new Error("offline"); } }), "failed");
  assert.deepEqual(h.source.record.postRecord, original);
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
  assert.equal(h.calls, 0);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
});

test("expired lease can recover, old owner cannot overwrite completion", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    h.source.record.postRecord = { changes: "B" };
    await runPrivateNotionProjection("test", h.deps);
    return { status: "failed", error: "stale owner" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.status, "synced");
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
});

test("page checkpoint survives provider failure and is reused in recovery", async () => {
  const h = harness();
  await runPrivateNotionProjection("test", { ...h.deps, project: async (_s, checkpoint) => {
    await checkpoint({ instructorPageId: "created-page", creationTitle: "" });
    throw new Error("body failed");
  } });
  assert.equal(h.source.record.notionSync?.instructorPageId, "created-page");
  await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true, project: async (s) => {
    assert.equal(s.record.notionSync?.instructorPageId, "created-page");
    return { status: "synced" };
  } });
});

test("deletion and missing request never create Notion content", async () => {
  const h = harness();
  h.source.request = undefined;
  await runPrivateNotionProjection("test", h.deps);
  assert.equal(h.source.record.notionSync?.status, "failed");
  assert.equal(h.calls, 0);
  h.remove();
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
});

test("night recovery catches synced-but-stale and absent status documents", async () => {
  const h = harness();
  h.source.record.notionSync = undefined;
  await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true });
  h.source.request!.lessonDate = "2026-09-07";
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
  assert.equal(h.calls, 2);
});

test("Notion title fingerprint follows post submission, cancellation, time, round and actual sends", () => {
  const record: any = { memberName: "테스트", staffName: "테스트", sessionNumber: 1, gptStatus: "published", publicReportUrl: "https://example.com/report", postSubmittedAt: { toMillis: () => 1 } };
  const request: any = { lessonDate: "2026-09-06", status: "active" };
  const version = privateLessonNotionProjectionVersion(record, request);
  assert.equal(version, privateLessonNotionProjectionVersion({ ...record, notionSync: { status: "failed" }, updatedAt: 9 }, request));
  for (const r of [{ ...record, sessionNumber: 2 }, { ...record, postSubmittedAt: null }, { ...record, publicReportApproval: { status: "sent" } }, { ...record, sentRevision: "sent-v1" }]) {
    assert.notEqual(privateLessonNotionProjectionVersion(r, request), version);
  }
  assert.notEqual(privateLessonNotionProjectionVersion(record, { ...request, status: "cancelled" }), version);
  assert.notEqual(privateLessonNotionProjectionVersion(record, { ...request, lessonDate: "2026-09-07" }), version);
});

test("runtime worker is event-only and has no report/send/source mutations", () => {
  const code = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
  const api = code.slice(0, code.indexOf("function pendingNotionProjection"));
  assert.doesNotMatch(api, /await syncPrivateNotionByRecordId|await syncPrivateLessonChartRecordToNotion/);
  const projection = code.slice(code.indexOf("async function syncPrivateLessonChartRecordToNotion"), code.indexOf("export function privateLessonNotionProjectionVersion"));
  assert.doesNotMatch(projection, /resolveReportShortUrl|\.set\(|enqueue|sendAlimtalk|gemini/i);
  const adapter = code.slice(code.indexOf("const privateNotionStore:"), code.indexOf("async function syncPrivateNotionByRecordId"));
  assert.match(adapter, /notionProjectionLease/);
  assert.doesNotMatch(adapter, /updatedAt:|publicReportApproval:|postRecord:/);
  const nightly = code.slice(code.indexOf("export async function syncPendingPrivateLessonNotionProjections"), code.indexOf("const privateNotionStore:"));
  assert.match(nightly, /startAfter\(after\)/);
  assert.match(nightly, /syncState\("privateLessonNotionReconciliation"\)/);
  assert.match(nightly, /lane === "all" \? records/);
  assert.doesNotMatch(nightly, /where\("updatedAt"/);
});

test("night scan persists progress and alternates slow failures with the full-source sweep", async () => {
  let time = 0;
  let cursor: PrivateNotionRepairCursor = { nextLane: 0, cursors: {} };
  const visits: string[] = [];
  const rows = { pending: ["p1", "p2", "p3"], failed: ["f1", "f2", "f3"], all: ["old-1", "old-2", "old-3"] };
  for (let run = 0; run < 3; run++) {
    await reconcilePrivateNotionPages({
      cursor, now: () => time, budgetMs: 150, maxRecords: 30,
      list: async (lane, after) => rows[lane].filter((id) => id > after).slice(0, 5),
      save: async (next) => { cursor = structuredClone(next); },
      process: async (id) => { visits.push(id); time += 160; },
    });
  }
  assert.deepEqual(visits, ["p1", "f1", "old-1"]);
  assert.deepEqual(cursor.cursors, { pending: "p1", failed: "f1", all: "old-1" });
});

test("scan advances before interruption, dedupes lanes and wraps completed cursors", async () => {
  let cursor: PrivateNotionRepairCursor = { nextLane: 0, cursors: {} };
  const rows = { pending: ["1", "2"], failed: ["2"], all: ["1", "2", "3"] };
  const visited: string[] = [];
  const deps = {
    list: async (lane: keyof typeof rows, after: string) => rows[lane].filter((id) => id > after).slice(0, 1),
    save: async (next: PrivateNotionRepairCursor) => { cursor = structuredClone(next); },
  };
  await assert.rejects(reconcilePrivateNotionPages({ ...deps, cursor, process: async () => { throw new Error("worker stopped"); } }));
  assert.equal(cursor.cursors.pending, "1");
  assert.equal(cursor.nextLane, 1);
  await reconcilePrivateNotionPages({ ...deps, cursor, process: async (id) => { visited.push(id); } });
  assert.deepEqual(visited, ["2", "1", "3"]);
  assert.equal(new Set(visited).size, visited.length);
  assert.deepEqual(cursor.cursors, { pending: "", failed: "", all: "" });
});

test("expired owner cannot acknowledge success even without a replacement worker", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    return { status: "synced" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.status, "pending");
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
});

test("A to B interrupted write to A must restore Notion despite matching last acknowledged version", async () => {
  const h = harness();
  let displayed = "";
  const project = async (s: PrivateNotionSource): Promise<PrivateNotionState> => {
    displayed = String(s.record.postRecord?.changes);
    return { status: "synced" };
  };
  await runPrivateNotionProjection("test", { ...h.deps, project });
  h.source.record.postRecord = { changes: "B" };
  await runPrivateNotionProjection("test", { ...h.deps, project: async (s) => {
    await project(s);
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    return { status: "synced" };
  } });
  assert.equal(displayed, "B");
  h.source.record.postRecord = { changes: "A" };
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, project, retryFailures: true }), "synced");
  assert.equal(displayed, "A");
});
