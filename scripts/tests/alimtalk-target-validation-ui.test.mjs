import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const source = await read("core/assets/alimtalk-target-validation.js");
const html = await read("core/messages/index.html");
const css = await read("core/assets/alimtalk-target-validation.css");
const sandbox = { Intl, Date };
assert.match(source, /^import \{ sharedNavigationRuntime \} from "\.\/core-navigation\.js";/);
vm.runInNewContext(source.replace(/^import .*;\n/, "const sharedNavigationRuntime = () => null;\n")
  .replace(/^export /gm, "") + "\nglobalThis.api = { validCandidateId, validationView };", sandbox);
const { validCandidateId, validationView } = sandbox.api;
const candidateId = "5330_fixture_candidate";
const response = status => ({
  version: "fixture-v1", checkedAt: "2026-10-16T03:04:05.000Z", liveReadback: false,
  readOnly: true, allowedForExternalActions: false,
  results: [{ candidateId, status, checks: [{ stage: "canonical_identity", status: status === "blocked" ? "blocked" : "passed",
    reasonCode: status === "blocked" ? "source_identity_mismatch" : "ok", detail: "PRIVATE_DETAIL_01012345678" }],
  remainingChecks: ["발송 시점 승인 확인", "기존 큐 선점·동시 실행 차단", "업무별 최종 원본·리포트 검증"],
  source: { phone: "PRIVATE_SOURCE_01012345678" }, payload: "PRIVATE_PAYLOAD" }],
});

test("messages alone embeds the isolated module and stylesheet with one exact-ID input", async () => {
  assert.equal((html.match(/alimtalk-target-validation\.js/g) || []).length, 1);
  assert.equal((html.match(/alimtalk-target-validation\.css/g) || []).length, 1);
  const section = html.match(/<section class="alimtalk-target-validation"[^]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, / hidden>/);
  assert.equal((section.match(/<input /g) || []).length, 1);
  assert.equal((section.match(/<button /g) || []).length, 1);
  assert.match(section, /type="submit">검증<\/button>/);
  assert.match(section, /스냅샷 기준.*실시간 조회 아님.*사전검증 통과는 승인·발송 아님/);
  assert.match(section, /role="status" aria-live="polite"/);
  assert.doesNotMatch(section, /class="panel|class="ops-card/);
  for (const directory of await readdir(new URL("core/", root), { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name === "messages") continue;
    const page = await read(`core/${directory.name}/index.html`).catch(error => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    assert.doesNotMatch(page, /alimtalk-target-validation\.(?:js|css)/, directory.name);
  }
});

test("only the existing authenticated runtime and read-only callable are used", () => {
  assert.match(source, /sharedNavigationRuntime\(\)/);
  assert.match(source, /window\.archiveCoreNavigation/);
  assert.match(source, /runtime\.httpsCallable\(runtime\.functionsClient, "getAlimtalkTargetValidation"\)/);
  assert.match(source, /callable\(\{ candidateIds: \[id\] \}\)/);
  assert.doesNotMatch(source, /initializeApp|getAuth|signIn|signOut|onAuthStateChanged|firebasejs|fetch\(|setDoc|updateDoc|localStorage|sessionStorage|console\.|innerHTML/);
  assert.match(source, /node\.textContent = value/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.match(source, /window\.removeEventListener\("pagehide", dispose\)/);
  assert.match(css, /minmax\(0, 1fr\) auto/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /100vw|overflow-x:\s*(?:hidden|clip)|font-size:.*vw/);
});

test("IDs are never normalized, searched or expanded to a batch", () => {
  assert.match(html, /name="candidateId"[^>]*maxlength="160"/);
  for (const value of ["", " ", ` ${candidateId}`, `${candidateId} `, "a/b", "a\\b", "a,b", "a\nb", ".", "..", "a-b:c.d", "a".repeat(161), "가"]) {
    assert.equal(validCandidateId(value), false, JSON.stringify(value));
  }
  for (const value of [candidateId, "a-b_c", "a".repeat(160)]) assert.equal(validCandidateId(value), true);
});

test("all four result statuses retain the preflight boundary and omit sensitive fields", () => {
  for (const status of ["blocked", "preflight_passed", "not_found", "review_required"]) {
    const view = validationView(response(status), candidateId);
    assert.equal(view.status, status);
    assert.match(view.checkedAt, /2026.*10.*16.*12:04:05.*KST/);
    assert.doesNotMatch(JSON.stringify(view), /PRIVATE_|01012345678|"(?:payload|source|detail)":/);
    if (status === "blocked") assert.match(view.checks[0], /원본 식별 · 차단 · 원본 식별 불일치/);
    assert.deepEqual(Array.from(view.remainingChecks), response(status).results[0].remainingChecks);
    if (status === "preflight_passed") assert.match(view.label, /사전검증 통과 · 승인·발송 아님/);
  }
  const data = response("review_required");
  data.results[0].checks[0] = { stage: "<img onerror=alert(1)>", status: "not_checked", reasonCode: "private@example.com", detail: "SECRET" };
  data.results[0].remainingChecks = ["<script>unsafe</script>"];
  const view = validationView(data, candidateId);
  assert.equal(view.checks[0], "확인 필요 · 미확인 · 확인 필요");
  assert.equal(view.remainingChecks[0], "추가 확인 필요");
});

test("backend stages and operator reasons have short Korean labels", () => {
  for (const [stage, expected] of Object.entries({ canonical_identity: "원본 식별", attempt_ledger: "발송 시도 이력",
    eligibility: "대상 조건", source: "원본 연결", duplicate: "중복 확인", specialized_final_guard: "업무별 최종 확인", inspection: "자료 조회" })) {
    const data = response("blocked");
    data.results[0].checks[0].stage = stage;
    assert.ok(validationView(data, candidateId).checks[0].startsWith(`${expected} · 차단 · `));
  }
  for (const [reasonCode, expected] of Object.entries({ staff_excluded: "직원 대상 제외", template_snapshot_unverified: "템플릿 스냅샷 미확인",
    source_identity_mismatch: "원본 식별 불일치", existing_attempt_requires_reconciliation: "기존 발송 시도 대조 필요",
    eligibility_blocked: "대상 조건 불충족", source_blocked: "원본 조건 불충족", duplicate_blocked: "중복 대상",
    existing_runtime_readback_required: "최종 원본 재조회 필요", source_read_failed: "원본 조회 실패" })) {
    const data = response("review_required");
    data.results[0].checks[0] = { stage: "eligibility", status: "not_checked", reasonCode };
    assert.equal(validationView(data, candidateId).checks[0], `대상 조건 · 미확인 · ${expected}`);
  }
});

test("untrusted, mismatched, malformed or live/action-capable responses fail closed", () => {
  const changes = [
    data => { data.readOnly = false; }, data => { delete data.readOnly; },
    data => { data.liveReadback = true; }, data => { data.allowedForExternalActions = true; },
    data => { data.results = []; }, data => { data.results.push(data.results[0]); },
    data => { data.results[0].candidateId = "another"; }, data => { data.checkedAt = "<script>"; },
    data => { data.checkedAt = "2026-99-99T00:00:00Z"; }, data => { data.results[0].status = "approved"; },
    data => { data.results[0].checks[0].status = "unknown"; }, data => { data.results[0].checks = null; },
    data => { data.results[0].remainingChecks = [{}]; },
    data => { data.results[0].status = "preflight_passed"; },
    data => { data.results[0].status = "preflight_passed"; data.results[0].checks = []; },
    data => { data.results[0].status = "preflight_passed"; data.results[0].checks[0].status = "not_checked"; },
  ];
  for (const change of changes) {
    const data = response("blocked"); change(data);
    assert.throws(() => validationView(data, candidateId), /invalid-validation-response/);
  }
  assert.throws(() => validationView(null, candidateId), /invalid-validation-response/);
});

// Optional real-DOM QA uses a local fixture and synthetic runtime, never Firebase or production sessions.
test("controlled browser rendering, submission, access lifecycle and responsive QA", {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH && !process.env.ALIMTALK_UI_BROWSER,
}, async t => {
  const { chromium } = await (process.env.PLAYWRIGHT_MODULE_PATH
    ? import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : import("playwright"));
  const assets = new Map();
  const fixtureHtml = html.replace('<script src="../firebase-config.js"></script>', "")
    .replace('<script type="module" src="../assets/app.js"></script>',
      '<script type="module">import { initCoreNavigationDocument } from "../assets/core-navigation.js"; initCoreNavigationDocument();</script>')
    .replace('<html lang="ko">', '<html lang="ko" data-core-access="manager">')
    .replace(/<div id="coreAccessLoading"[^]*?<\/div>/, "");
  assets.set("/core/messages/", ["text/html", fixtureHtml]);
  assets.set("/fixture-host/", ["text/html", '<!doctype html><html><body><iframe data-testid="validation-frame" data-core-navigation-frame src="/core/messages/" title="메시지 검증"></iframe></body></html>']);
  for (const file of ["styles.css", "interface.css", "alimtalk-catalog.css", "alimtalk-target-validation.css", "alimtalk-target-validation.js", "core-navigation.js", "core-navigation.css"]) {
    assets.set(`/core/assets/${file}`, [file.endsWith(".js") ? "text/javascript" : "text/css", await read(`core/assets/${file}`)]);
  }
  const server = createServer((req, res) => {
    const asset = assets.get(new URL(req.url, "http://fixture").pathname);
    res.writeHead(asset ? 200 : 404, { "Content-Type": asset?.[0] || "text/plain" });
    res.end(asset?.[1] || "fixture-only");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const external = [];
    await context.route("**/*", route => {
      if (route.request().url().startsWith(`${origin}/`)) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await context.addInitScript(({ data }) => {
      window.__validationFixture = { data, calls: [], hold: false, error: false };
      const runtime = {
        authClient: { currentUser: { uid: "fixture-manager" } }, functionsClient: {},
        httpsCallable: (_client, name) => async payload => {
          const fixture = window.__validationFixture;
          fixture.calls.push({ name, payload });
          if (fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
          if (fixture.error) throw new Error("PRIVATE_ERROR_01012345678");
          return { data: fixture.data };
        },
      };
      window.archiveCoreNavigation = { uid: "fixture-manager", session: { role: "manager" }, runtime };
    }, { data: response("blocked") });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const input = page.getByLabel("후보 ID", { exact: true });
    const button = page.getByRole("button", { name: "검증", exact: true });
    const tool = page.getByRole("region", { name: "대상 검증", exact: true });
    const status = tool.getByRole("status");
    const load = async () => {
      await page.goto(`${origin}/core/messages/`);
      await button.waitFor({ state: "visible" });
    };
    const submit = async () => {
      await input.fill(candidateId);
      await button.click();
      await status.filter({ hasText: /^조회 완료/ }).waitFor();
    };
    await t.test("one exact candidate and safe blocked-stage rendering", async () => {
      await load(); await submit();
      assert.deepEqual(await page.evaluate(() => window.__validationFixture.calls), [
        { name: "getAlimtalkTargetValidation", payload: { candidateIds: [candidateId] } },
      ]);
      assert.match(await tool.textContent(), /원본 식별 · 차단 · 원본 식별 불일치/);
      for (const check of response("blocked").results[0].remainingChecks) assert.ok((await tool.textContent()).includes(check));
      assert.match(await tool.textContent(), /검증 시각:.*KST/);
      assert.doesNotMatch(await tool.textContent(), /PRIVATE_|01012345678/);
      await input.fill("another_candidate");
      assert.equal(await tool.getByRole("list").count(), 0);
    });
    await t.test("invalid input makes no callable and Enter submits a valid ID", async () => {
      await load(); await input.fill("wrong/id"); await button.click();
      assert.match(await status.textContent(), /정확한 후보 ID 1개/);
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 0);
      await input.fill(candidateId); await input.press("Enter");
      await status.filter({ hasText: /^조회 완료/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 1);
    });
    await t.test("existing candidate-row button selects exactly one candidate without sending", async () => {
      await load();
      await page.evaluate(id => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = '목록 대상 검증';
        button.dataset.validateAlimtalkCandidate = id;
        document.getElementById('messagesCandidateList').append(button);
      }, candidateId);
      await page.getByTestId('recent-alimtalk-candidates').click();
      await page.getByRole('button', { name: '목록 대상 검증', exact: true }).click();
      await status.filter({ hasText: /^조회 완료/ }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__validationFixture.calls), [
        { name: 'getAlimtalkTargetValidation', payload: { candidateIds: [candidateId] } },
      ]);
    });
    await t.test("preflight, missing, review and not-checked statuses never imply approval", async () => {
      for (const [state, label] of [["preflight_passed", "사전검증 통과 · 승인·발송 아님"], ["not_found", "후보 없음"], ["review_required", "검토 필요"]]) {
        await load();
        const data = response(state);
        if (state !== "preflight_passed") data.results[0].checks[0].status = "not_checked";
        await page.evaluate(data => { window.__validationFixture.data = data; }, data);
        await submit();
        assert.match(await status.textContent(), new RegExp(label));
        assert.match(await tool.textContent(), state === "preflight_passed" ? /통과/ : /미확인/);
        assert.match(await tool.textContent(), /실시간 조회 아님/);
      }
    });
    await t.test("network/permission errors stay generic and previous results are cleared", async () => {
      await load(); await submit();
      await page.evaluate(() => { window.__validationFixture.error = true; });
      await button.click();
      await status.filter({ hasText: /^검증 결과를 확인하지 못했습니다/ }).waitFor();
      assert.equal(await tool.getByRole("list").count(), 0);
      assert.doesNotMatch(await tool.textContent(), /PRIVATE_|01012345678/);
    });
    await t.test("duplicate submits are suppressed and revoked access discards late results", async () => {
      await load();
      await page.evaluate(() => { window.__validationFixture.hold = true; });
      await input.fill(candidateId); await button.click();
      assert.equal(await button.isDisabled(), true);
      await page.evaluate(() => {
        document.querySelector("[data-alimtalk-target-validation] form").requestSubmit();
      });
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 1);
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "instructor"; });
      await tool.waitFor({ state: "hidden" });
      await page.evaluate(() => window.__validationFixture.release());
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; });
      await tool.waitFor({ state: "visible" });
      assert.equal(await input.inputValue(), "");
      assert.equal(await tool.getByRole("list").count(), 0);
      assert.equal(await status.textContent(), "");
    });
    await t.test("missing runtime fails closed", async () => {
      await load();
      await page.evaluate(() => { delete window.archiveCoreNavigation; });
      await input.fill(candidateId); await button.click();
      assert.match(await status.textContent(), /로그인·권한 연결/);
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 0);
    });
    await t.test("real sharedNavigationRuntime uses only the matching parent auth context", async () => {
      await page.goto(`${origin}/fixture-host/`);
      const frame = page.getByTestId("validation-frame").contentFrame();
      const frameInput = frame.getByLabel("후보 ID", { exact: true });
      const frameButton = frame.getByRole("button", { name: "검증", exact: true });
      const frameStatus = frame.getByRole("region", { name: "대상 검증", exact: true }).getByRole("status");
      await frameButton.waitFor({ state: "visible" });
      await frameInput.evaluate(() => { delete window.archiveCoreNavigation; });
      await frameInput.fill(candidateId); await frameButton.click();
      await frameStatus.filter({ hasText: /^조회 완료/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 1, "Parent callable/auth context was reused");
      assert.equal(await frameInput.evaluate(() => window.__validationFixture.calls.length), 0, "No separate child runtime was used");
      await page.evaluate(() => { window.archiveCoreNavigation.runtime.authClient.currentUser = { uid: "different-user" }; });
      await frameButton.click();
      assert.match(await frameStatus.textContent(), /로그인·권한 연결/);
      assert.equal(await page.evaluate(() => window.__validationFixture.calls.length), 1, "Mismatched host identity cannot call");
    });
    await t.test("empty or nonpassed preflight results are never shown as passed", async () => {
      for (const checks of [[], [{ stage: "eligibility", status: "not_checked", reasonCode: "template_snapshot_unverified" }]]) {
        await load();
        const data = response("preflight_passed");
        data.results[0].checks = checks;
        await page.evaluate(data => { window.__validationFixture.data = data; }, data);
        await input.fill(candidateId); await button.click();
        await status.filter({ hasText: /^검증 결과를 확인하지 못했습니다/ }).waitFor();
        assert.equal(await tool.getByRole("list").count(), 0);
        assert.doesNotMatch(await status.textContent(), /통과/);
      }
    });
    await t.test("320/390/768/1440 layouts, focus and long IDs stay inside the page", async () => {
      await load();
      const data = response("blocked");
      data.results[0].checks[0] = { stage: "attempt_ledger", status: "blocked", reasonCode: "existing_attempt_requires_reconciliation" };
      await page.evaluate(data => { window.__validationFixture.data = data; }, data);
      await submit();
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await input.fill("c".repeat(160));
        await button.click();
        await status.filter({ hasText: /^검증 결과를 확인하지 못했습니다/ }).waitFor();
        await input.fill(candidateId); await button.click();
        await status.filter({ hasText: /^조회 완료/ }).waitFor();
        const metrics = await tool.evaluate(node => {
          const controls = [...node.querySelectorAll("input,button")].map(control => {
            const rect = control.getBoundingClientRect();
            return { height: rect.height, left: rect.left, right: rect.right };
          });
          return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls };
        });
        assert.ok(metrics.scrollWidth <= width, `${width}px horizontal overflow`);
        for (const control of metrics.controls) {
          assert.ok(control.height >= 44);
          assert.ok(control.left >= 0 && control.right <= width);
        }
        await input.focus(); await input.press("Tab");
        assert.equal(await button.evaluate(node => node === document.activeElement), true);
        assert.notEqual(await button.evaluate(node => getComputedStyle(node).outlineStyle), "none");
        if (process.env.ALIMTALK_UI_SCREENSHOT_DIR) {
          await page.screenshot({ path: `${process.env.ALIMTALK_UI_SCREENSHOT_DIR}/target-validation-${width}.png`, fullPage: true });
        }
      }
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(server.listening, false);
  assert.equal(browser?.isConnected(), false);
});
