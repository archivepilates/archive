import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const source = await read("core/assets/member-operation-progress.js");
const html = await read("core/automation/index.html");
const css = await read("core/assets/member-operation-progress.css");
const sandbox = { Intl, Date };
vm.runInNewContext(source.replace(/^import .*;\n/, "const sharedNavigationRuntime = () => null;\n")
  .replace(/^export /gm, "") + "\nglobalThis.api = { validHoldingOperationId, memberOperationProgressView };", sandbox);
const { validHoldingOperationId, memberOperationProgressView: view } = sandbox.api;
const operationId = `holding_operator_notice_${"a".repeat(64)}`;
const otherId = `holding_operator_notice_${"b".repeat(64)}`;
const at = "2026-10-19T09:31:41.000Z";
const stageNames = ["detection", "source_check", "provider_acceptance", "provider_delivery", "memo_queued", "memo_synced"];
const reasons = ["canonical_event_recorded", "source_links_verified", "acceptance_verified", "delivery_complete_4000", "memo_queue_recorded", "memo_synced"];
const labels = ["감지", "원본 확인", "발송 접수", "전달 결과", "메모 접수", "StudioMate 반영"];
function response(status = "in_progress", id = operationId) {
  return {
    version: "member-operation-progress-v1", kind: "holding", operationId: id, checkedAt: at,
    readOnly: true, liveReadback: false, allowedForExternalActions: false, status,
    stages: stageNames.map((stage, index) => ({ stage,
      status: status === "not_found" ? "unknown" : status === "completed" || index < 3 ? "confirmed" : "pending",
      at: status === "not_found" ? null : at, reasonCode: reasons[index],
      privateData: "PRIVATE_STAGE_01012345678",
    })),
    nextAction: status === "completed" ? "none" : "check_delivery_record",
    memberName: "PRIVATE_MEMBER", phone: "01012345678", memoBody: "PRIVATE_MEMO",
  };
}

test("only Automation embeds an unframed, hidden, single exact-ID query section", () => {
  assert.equal((html.match(/member-operation-progress\.js/g) || []).length, 1);
  assert.equal((html.match(/member-operation-progress\.css/g) || []).length, 1);
  const section = html.match(/<section class="member-operation-progress"[^]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, / hidden>/);
  assert.match(section, /홀딩 처리 현황/);
  assert.equal((section.match(/<input /g) || []).length, 1);
  assert.equal((section.match(/<button /g) || []).length, 1);
  assert.match(section, /maxlength="88"/);
  assert.match(section, /type="submit">조회/);
  assert.doesNotMatch(section, /class="panel|class=".*card/);
  assert.doesNotMatch(css, /overflow(?:-x)?\s*:\s*(?:clip|hidden)|font-size:[^;]*(?:vw|clamp)|letter-spacing:\s*-/);
  assert.match(css, /min-height: 44px/);
});

test("exact lowercase SHA-256 operation IDs only, without trim, paths, lists or coercion", () => {
  assert.equal(validHoldingOperationId(operationId), true);
  for (const id of [undefined, null, 1, {}, [], "", operationId + " ", " " + operationId, operationId + "\n",
    `/${operationId}`, `${operationId},${otherId}`, operationId.toUpperCase(), operationId.slice(0, -1), operationId + "a",
    "holding_operator_notice_" + "g".repeat(64), "excel_" + operationId]) assert.equal(validHoldingOperationId(id), false);
});

test("projects six separate stages and snapshot times, never registration time as detection time", () => {
  const data = response();
  data.stages[0].at = "2026-10-19T03:09:00.000Z";
  const result = view(data, operationId);
  assert.equal(result.status, "in_progress");
  assert.equal(result.stages[2].statusLabel, "확인됨");
  assert.equal(result.stages[3].statusLabel, "대기");
  assert.equal(result.stages[5].statusLabel, "대기");
  assert.equal(result.stages[0].reason, "원본 홀딩 등록");
  assert.equal(result.stages[0].at, null);
  assert.match(result.checkedAt, /18:31:41 KST$/);
  assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(result).includes("01012345678"), false);
  assert.equal(view(response("completed"), operationId).label, "모든 기록 확인");
  assert.equal(view(response("not_found"), operationId).label, "기록 없음");
});

test("unknown or inherited reason/action codes are replaced by fixed labels", () => {
  for (const code of ["PRIVATE_01012345678", "<img src=x onerror=alert(1)>", "constructor", "__proto__", {}, null]) {
    const data = response("review_required");
    data.nextAction = code;
    data.stages.forEach(row => { row.reasonCode = code; });
    const result = view(data, operationId);
    assert.equal(result.nextAction, "원본 기록 검토");
    assert.ok(result.stages.every(row => row.reason === "확인 필요"));
  }
});

test("all allowlisted backend reason and next-action codes map to operator labels", () => {
  const reasonCodes = ["evidence_missing", "timestamp_missing", "source_read_failed", "source_binding_mismatch", ...reasons,
    "policy_mismatch", "message_link_mismatch", "acceptance_marker_unverified", "acceptance_unverified", "delivery_failed",
    "delivery_unconfirmed", "memo_link_mismatch", "memo_evidence_unverified", "memo_sync_failed", "memo_sync_unconfirmed"];
  for (const reasonCode of reasonCodes) {
    const data = response(); data.stages[0].reasonCode = reasonCode;
    assert.notEqual(view(data, operationId).stages[0].reason, "확인 필요", reasonCode);
  }
  for (const nextAction of ["none", "review_acceptance", "check_delivery_record", "check_memo_queue", "check_memo_sync"]) {
    const data = response(); data.nextAction = nextAction;
    assert.notEqual(view(data, operationId).nextAction, "원본 기록 검토");
  }
});

test("malformed, mismatched, writable or contradictory responses fail closed", () => {
  const changes = [
    d => { d.version = "v2"; }, d => { d.kind = "refund"; }, d => { d.operationId = otherId; },
    d => { d.readOnly = false; }, d => { delete d.readOnly; }, d => { d.liveReadback = true; },
    d => { d.allowedForExternalActions = true; }, d => { d.status = "constructor"; }, d => { d.stages = {}; },
    d => { d.stages.pop(); }, d => { d.stages.push(d.stages[0]); }, d => { d.stages[1] = d.stages[0]; },
    d => { d.stages.reverse(); }, d => { d.stages[1].status = "verified"; }, d => { d.stages[1].status = "constructor"; },
    d => { d.stages[0].at = null; }, d => { delete d.stages[1].at; }, d => { d.stages[0] = null; },
    d => { d.status = "completed"; }, d => { d.status = "not_found"; },
  ];
  for (const invalidTime of ["PRIVATE_TIME", "2026-02-30T00:00:00Z", "2026-10-19", "2026-10-19T24:00:00Z",
    "2026-10-19T09:31:41.000Z PRIVATE", "2026-10-19T09:31:41+00:00", null, {}, 123]) {
    changes.push(d => { d.checkedAt = invalidTime; }, d => { d.stages[3].at = invalidTime === null ? {} : invalidTime; });
  }
  for (const change of changes) {
    const data = response(); change(data);
    assert.throws(() => view(data, operationId), /invalid-operation-progress-response/);
  }
  for (const data of [null, {}, [], undefined]) assert.throws(() => view(data, operationId), /invalid-operation-progress-response/);
  const data = response(); data.checkedAt = "2026-10-19T09:31:41Z";
  assert.match(view(data, operationId).checkedAt, /KST$/);
});

test("module has one read-only callable and no auth initialization, writes, repairs or provider APIs", () => {
  assert.match(source, /^import \{ sharedNavigationRuntime \} from "\.\/core-navigation\.js";/);
  assert.deepEqual([...source.matchAll(/httpsCallable\(runtime.functionsClient, "([^"]+)"\)/g)].map(match => match[1]), ["getMemberOperationProgress"]);
  assert.doesNotMatch(source, /initializeApp|getAuth\(|signIn|signOut\(|setDoc\(|updateDoc\(|addDoc\(|fetch\(|innerHTML|localStorage|sessionStorage/);
});

test("real-module fixture: shell, safe rendering, role/session/input/navigation lifecycle and responsive QA", {
  skip: !process.env.MEMBER_OPERATION_UI_BROWSER && !process.env.PLAYWRIGHT_MODULE_PATH,
}, async t => {
  const { chromium } = await (process.env.PLAYWRIGHT_MODULE_PATH
    ? import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : import("playwright"));
  const assets = new Map();
  const fixtureHtml = html.replace(/    <link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\n/g, "")
    .replace('<script src="../firebase-config.js"></script>', "")
    .replace('<script type="module" src="../assets/app.js"></script>',
      `<script type="module">import { initCoreNavigationDocument, finishCoreNavigation } from "../assets/core-navigation.js";
        initCoreNavigationDocument(); window.__finishNavigation = finishCoreNavigation;
        if (window.parent !== window && window.frameElement?.hasAttribute("data-core-navigation-frame"))
          finishCoreNavigation(window.parent.archiveCoreNavigation.runtime, window.parent.archiveCoreNavigation.session);
      </script>`)
    .replace(/<div id="coreAccessLoading"[^]*?<\/div>/, "");
  assets.set("/core/automation/", ["text/html", fixtureHtml]);
  assets.set("/core/messages/", ["text/html", fixtureHtml.replace(/<section class="member-operation-progress"[^]*?<\/section>/, "")]);
  assets.set("/fixture-host/", ["text/html", '<!doctype html><html><body><iframe data-testid="progress-frame" data-core-navigation-frame src="/core/automation/" title="자동화"></iframe></body></html>']);
  for (const file of ["styles.css", "interface.css", "member-operation-progress.css", "member-operation-progress.js", "core-navigation.js", "core-navigation.css"]) {
    assets.set(`/core/assets/${file}`, [file.endsWith(".js") ? "text/javascript" : "text/css", await read(`core/assets/${file}`)]);
  }
  const server = createServer((req, res) => {
    const asset = assets.get(new URL(req.url, "http://fixture").pathname);
    res.writeHead(asset ? 200 : 404, { "Content-Type": asset?.[0] || "text/plain" });
    res.end(asset?.[1] || "fixture-only");
  });
  const screenshots = process.env.MEMBER_OPERATION_UI_SCREENSHOT_DIR || join(tmpdir(), `member-operation-progress-${process.pid}`);
  let browser, context;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const external = [], errors = [];
    await context.route("**/*", route => {
      if (route.request().url().startsWith(`${origin}/`)) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(({ data }) => {
      const state = window.__progressFixture = { data, calls: [], pending: [], hold: false, error: false, listeners: new Set() };
      state.makeRuntime = uid => ({
        authClient: { currentUser: uid ? { uid } : null }, functionsClient: {},
        auth: { onAuthStateChanged: (_client, fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); } },
        httpsCallable: (_client, name) => async payload => {
          state.calls.push({ name, payload });
          const result = structuredClone(state.data);
          if (state.hold) await new Promise(resolve => state.pending.push(resolve));
          if (state.error) throw new Error("PRIVATE_ERROR_01012345678");
          return { data: result };
        },
      });
      state.setUser = uid => {
        window.archiveCoreNavigation.runtime.authClient.currentUser = uid ? { uid } : null;
        for (const fn of [...state.listeners]) fn();
      };
      window.archiveCoreNavigation = { uid: "fixture-manager", session: { role: "manager" }, runtime: state.makeRuntime("fixture-manager"), ready() {}, dispose() {} };
      if (!new URL(location.href).searchParams.has("unresolved")) document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.dataset.coreAccess = "manager";
      }, { once: true });
    }, { data: response() });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(6000);
    const input = page.getByLabel("작업 ID", { exact: true });
    const button = page.getByRole("button", { name: "조회", exact: true });
    const section = page.getByRole("region", { name: "홀딩 처리 현황", exact: true });
    const status = section.getByRole("status");
    const timeline = section.getByRole("list", { name: "홀딩 처리 단계" });
    const load = async (query = "") => {
      await page.goto(`${origin}/core/automation/${query}`);
      await page.getByLabel("작업 ID", { exact: true }).waitFor({ state: query.includes("unresolved") ? "hidden" : "visible" });
    };
    const completed = async () => {
      try { await status.filter({ hasText: /^조회 완료/ }).waitFor(); }
      catch (error) {
        error.message += `\nFixture state: ${JSON.stringify(await page.evaluate(() => ({
          calls: window.__progressFixture.calls, input: document.getElementById("holdingOperationId")?.value,
          status: document.getElementById("holdingProgressStatus")?.textContent,
        })))}`;
        throw error;
      }
    };
    const submit = async (data = response()) => {
      await page.evaluate(data => { window.__progressFixture.data = data; }, data);
      await input.fill(data.operationId); await button.click(); await completed();
    };
    const release = async () => {
      await page.evaluate(async () => {
        window.__progressFixture.pending.splice(0).forEach(resolve => resolve());
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    };

    await t.test("no controls until manager AND existing authenticated runtime are ready; URL auto-query waits", async () => {
      await load(`?unresolved=1&holdingNotice=${operationId}`);
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 0);
      await page.evaluate(() => {
        window.archiveCoreNavigation.runtime.authClient.currentUser = null;
        document.documentElement.dataset.coreAccess = "manager";
      });
      assert.equal(await section.isVisible(), false);
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 0);
      await page.evaluate(() => {
        window.archiveCoreNavigation.runtime.authClient.currentUser = { uid: "fixture-manager" };
        document.documentElement.dataset.coreAccess = "manager";
      });
      await completed();
      assert.equal(await input.inputValue(), operationId);
      assert.deepEqual(await page.evaluate(() => window.__progressFixture.calls), [
        { name: "getMemberOperationProgress", payload: { kind: "holding", operationId } },
      ]);
    });

    await t.test("safe six-stage timeline: accepted is not delivered or synced; no private data or detection time", async () => {
      await load(); await submit();
      const items = timeline.getByRole("listitem");
      assert.equal(await items.count(), 6);
      for (let index = 0; index < labels.length; index++) assert.equal(await items.nth(index).getByRole("strong").textContent(), labels[index]);
      assert.match(await items.nth(2).textContent(), /확인됨/);
      assert.match(await items.nth(3).textContent(), /대기/);
      assert.match(await items.nth(5).textContent(), /대기/);
      assert.doesNotMatch(await items.nth(0).textContent(), /KST/);
      assert.match(await section.textContent(), /기록 확인시각:.*18:31:41 KST/);
      assert.doesNotMatch(await section.textContent(), /PRIVATE_|01012345678|실제 전달시각|실시간 조회 완료/);
    });

    await t.test("invalid IDs and invalid URL IDs never call; Enter submits one exact ID", async () => {
      await load("?holdingNotice=wrong%2Fpath");
      for (const id of ["wrong/id", " " + operationId, operationId.toUpperCase()]) {
        await input.fill(id); await button.click();
        assert.equal(await input.getAttribute("aria-invalid"), "true");
        assert.match(await status.textContent(), /정확한 홀딩 작업 ID/);
      }
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 0);
      await input.fill(operationId); await input.press("Enter"); await completed();
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 1);
    });

    await t.test("not-found, complete, review, failed and unknown remain distinct", async () => {
      for (const state of ["not_found", "completed", "review_required", "in_progress"]) {
        await load();
        const data = response(state);
        if (state === "review_required") { data.stages[3].status = "failed"; data.stages[3].reasonCode = "delivery_failed"; }
        await submit(data);
        assert.equal(await timeline.getByRole("listitem").count(), 6);
        if (state === "not_found") assert.match(await status.textContent(), /기록 없음/);
        if (state === "completed") assert.match(await status.textContent(), /모든 기록 확인/);
        if (state === "review_required") assert.match(await timeline.getByRole("listitem").nth(3).textContent(), /실패/);
      }
    });

    await t.test("untrusted reasons, nextAction, raw errors and response binding never leak", async () => {
      await load();
      const data = response(); data.nextAction = "PRIVATE_ACTION_01012345678";
      data.stages[4].reasonCode = "<img src=x onerror=alert(1)>";
      await submit(data);
      assert.match(await section.textContent(), /다음 확인: 원본 기록 검토/);
      assert.doesNotMatch(await section.textContent(), /PRIVATE_|01012345678|onerror/);
      for (const invalid of [response("completed", otherId), { ...response(), readOnly: false }]) {
        await page.evaluate(data => { window.__progressFixture.data = data; }, invalid);
        await button.click();
        await status.filter({ hasText: /^기록을 확인하지 못했습니다/ }).waitFor();
        assert.equal(await timeline.count(), 0);
      }
      await page.evaluate(() => { window.__progressFixture.error = true; });
      await button.click(); await status.filter({ hasText: /^기록을 확인하지 못했습니다/ }).waitFor();
      assert.doesNotMatch(await section.textContent(), /PRIVATE_|01012345678/);
    });

    await t.test("input changes invalidate held results and newer requests can finish first", async () => {
      await load(); await page.evaluate(() => { window.__progressFixture.hold = true; });
      await input.fill(operationId); await button.click();
      assert.equal(await button.isDisabled(), true);
      await page.evaluate(() => document.querySelector("[data-member-operation-progress] form").requestSubmit());
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 1);
      await input.fill(otherId);
      assert.equal(await button.isDisabled(), false);
      await page.evaluate(data => { window.__progressFixture.hold = false; window.__progressFixture.data = data; }, response("completed", otherId));
      await button.click(); await completed();
      await release();
      assert.match(await status.textContent(), /모든 기록 확인/);
      assert.equal(await input.inputValue(), otherId);
    });

    await t.test("role revocation hides and clears; late response cannot restore; return requires fresh submit", async () => {
      await load(); await submit();
      await page.evaluate(() => { window.__progressFixture.hold = true; }); await button.click();
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "instructor"; });
      await section.waitFor({ state: "hidden" }); await release();
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; });
      await section.waitFor({ state: "visible" });
      assert.equal(await input.inputValue(), "");
      assert.equal(await timeline.count(), 0);
      assert.equal(await status.textContent(), "");
    });

    await t.test("auth changes immediately clear rendered results and discard in-flight data", async () => {
      await load(); await submit();
      await page.evaluate(() => window.__progressFixture.setUser(null));
      await section.waitFor({ state: "hidden" });
      assert.equal(await timeline.count(), 0);
      await load(); await page.evaluate(() => { window.__progressFixture.hold = true; });
      await input.fill(operationId); await button.click();
      await page.evaluate(() => window.__progressFixture.setUser("another-user"));
      await section.waitFor({ state: "hidden" }); await release();
      assert.equal(await timeline.count(), 0);
    });

    await t.test("runtime replacement, even same uid, invalidates a late response", async () => {
      await load(); await page.evaluate(() => { window.__progressFixture.hold = true; });
      await input.fill(operationId); await button.click();
      await page.evaluate(() => {
        window.archiveCoreNavigation.runtime = window.__progressFixture.makeRuntime("fixture-manager");
      });
      await release();
      assert.equal(await timeline.count(), 0);
      assert.equal(await input.inputValue(), "");
    });

    await t.test("navigation clicks, popstate, shell hiding, pagehide and content replacement clear results", async () => {
      await load(); await submit();
      await page.getByRole("link", { name: "Messages 알림톡", exact: true }).evaluate(link => {
        link.addEventListener("click", event => event.preventDefault()); link.click();
      });
      assert.equal(await timeline.count(), 0);
      await submit();
      await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
      assert.equal(await timeline.count(), 0);
      await submit();
      await section.evaluate(node => { node.parentElement.classList.add("core-navigation-container"); node.hidden = true; });
      await section.waitFor({ state: "hidden" });
      await page.evaluate(() => document.querySelector(".main").classList.remove("core-navigation-container"));
      await section.waitFor({ state: "visible" });
      assert.equal(await timeline.count(), 0);
      await submit();
      await section.evaluate(node => { node.replaceWith(node.cloneNode(true)); });
      await section.waitFor({ state: "visible" });
      assert.equal(await timeline.count(), 0);
      await submit();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
      await section.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.__progressFixture.listeners.size), 0);
    });

    await t.test("explicit signout clears results and listener; removed roots discard held responses", async () => {
      await load(); await submit();
      await page.evaluate(() => {
        window.archiveCoreNavigation.runtime.authClient.currentUser = null;
        document.dispatchEvent(new Event("core-instructor-signed-out"));
      });
      await section.waitFor({ state: "hidden" });
      assert.equal(await timeline.count(), 0);
      await load(); await page.evaluate(() => { window.__progressFixture.hold = true; });
      await input.fill(operationId); await button.click();
      await section.evaluate(node => { window.__removedProgress = node; node.remove(); });
      await release();
      assert.equal(await page.evaluate(() => window.__removedProgress.textContent.includes("조회 완료")), false);
      assert.equal(await page.evaluate(() => window.__progressFixture.listeners.size), 0);
    });

    await t.test("iframe reuses matching parent runtime only; parent role and auth revocations clear child results", async () => {
      await page.goto(`${origin}/fixture-host/`);
      const frame = page.getByTestId("progress-frame").contentFrame();
      const frameInput = frame.getByLabel("작업 ID", { exact: true });
      const frameButton = frame.getByRole("button", { name: "조회", exact: true });
      const frameSection = frame.getByRole("region", { name: "홀딩 처리 현황", exact: true });
      await frameButton.waitFor({ state: "visible" });
      await frameInput.evaluate(() => { delete window.archiveCoreNavigation; });
      await frameInput.fill(operationId); await frameButton.click();
      await frameSection.getByRole("status").filter({ hasText: /^조회 완료/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 1);
      assert.equal(await frameInput.evaluate(() => window.__progressFixture.calls.length), 0);
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "instructor"; });
      await frameSection.waitFor({ state: "hidden" });
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; });
      await frameSection.waitFor({ state: "visible" });
      assert.equal(await frameSection.getByRole("list").count(), 0);
      await page.evaluate(() => window.__progressFixture.setUser("mismatched-host"));
      await frameSection.waitFor({ state: "hidden" });
      assert.equal(await frameSection.getByRole("list").count(), 0);
    });

    await t.test("actual finishCoreNavigation shell hides original results, shares runtime and reopens deep-link query", async () => {
      await load(); await submit();
      await page.evaluate(async () => {
        const { runtime, session } = window.archiveCoreNavigation;
        await window.__finishNavigation(runtime, session);
      });
      await page.getByRole("link", { name: "Messages 알림톡", exact: true }).click();
      await page.waitForURL(`${origin}/core/messages/`);
      assert.equal(await timeline.count(), 0);
      await page.getByRole("link", { name: "Automation 관제", exact: true }).evaluate((link, id) => {
        link.href = `../automation/?holdingNotice=${id}`;
      }, operationId);
      await page.getByRole("link", { name: "Automation 관제", exact: true }).click();
      await page.waitForURL(`${origin}/core/automation/?holdingNotice=${operationId}`);
      const navigationFrame = page.getByTestId("active-navigation-frame");
      await page.evaluate(() => { document.querySelector("[data-core-navigation-frame]").dataset.testid = "active-navigation-frame"; });
      const child = navigationFrame.contentFrame();
      const childSection = child.getByRole("region", { name: "홀딩 처리 현황", exact: true });
      await childSection.getByRole("status").filter({ hasText: /^조회 완료/ }).waitFor();
      assert.equal(await child.getByLabel("작업 ID", { exact: true }).inputValue(), operationId);
      assert.equal(await page.evaluate(() => window.__progressFixture.calls.length), 2);
      await page.evaluate(() => window.archiveCoreNavigation.dispose());
      await section.waitFor({ state: "visible" });
      assert.equal(await timeline.count(), 0);
    });

    await t.test("320/390/768/1440 real shell screenshots, no masked overflow, touch, focus and stable typography", async () => {
      await load(); await submit(response("completed"));
      await mkdir(screenshots, { recursive: true });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        // Disable inherited shell overflow clipping so width checks cannot pass by masking overflow.
        await page.evaluate(() => { document.body.style.overflowX = "visible"; document.documentElement.style.overflowX = "visible"; });
        const metrics = await section.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return {
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right,
            font: getComputedStyle(node.querySelector("h2")).fontSize,
            controls: [...node.querySelectorAll("input,button")].map(control => {
              const box = control.getBoundingClientRect(); return { height: box.height, left: box.left, right: box.right };
            }),
            overflowing: [...node.querySelectorAll("p, li, strong, span")].filter(child => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).display !== "inline").map(child => child.tagName),
          };
        });
        assert.ok(metrics.scrollWidth <= width, `${width}px shell overflow: ${JSON.stringify(metrics)}`);
        assert.ok(metrics.left >= 0 && metrics.right <= width);
        assert.equal(metrics.font, "16px");
        assert.deepEqual(metrics.overflowing, []);
        for (const control of metrics.controls) { assert.ok(control.height >= 44); assert.ok(control.left >= 0 && control.right <= width); }
        await input.focus(); await input.press("Tab");
        assert.equal(await button.evaluate(node => node === document.activeElement), true);
        assert.notEqual(await button.evaluate(node => getComputedStyle(node).outlineStyle), "none");
        assert.equal(await input.getAttribute("aria-describedby"), "holdingProgressStatus");
        assert.equal(await timeline.getByRole("listitem").count(), 6);
        await page.screenshot({ path: join(screenshots, `holding-progress-${width}.png`), fullPage: true });
      }
      t.diagnostic(`Screenshots: ${screenshots}`);
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    try { await context?.close(); }
    finally {
      try { await browser?.close(); }
      finally { if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    }
  }
  assert.equal(server.listening, false);
  assert.equal(browser?.isConnected(), false);
});
