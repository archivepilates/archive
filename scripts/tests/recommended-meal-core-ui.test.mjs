import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { uiIcon } from "../../core/assets/ui-icons.js";

const root = new URL("../../", import.meta.url);
const html = await readFile(new URL("core/recommended-meals/index.html", root), "utf8");
const app = await readFile(new URL("core/assets/app.js", root), "utf8");
const rules = await readFile(new URL("core/rules/index.html", root), "utf8");
const styles = await Promise.all(["styles.css", "interface.css"].map(file => readFile(new URL(`core/assets/${file}`, root), "utf8")));
const mealSource = app.slice(app.indexOf("function mealFlowStatus("), app.indexOf("function setParkingStatus("));
let browser;
let blockedRequests = 0;

before(async () => {
  let playwright;
  try { playwright = await import("playwright"); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    playwright = await import("/Users/archivepilates/dev/archive-in-runtime/node_modules/playwright/index.mjs");
  }
  browser = await playwright.chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); assert.equal(browser?.isConnected(), false, "task browser closed"); });

async function fixture(t, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
  t.after(() => context.close());
  await context.route("**/*", route => { blockedRequests += 1; return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "no browser script errors"));
  // No Firebase/auth scripts, server, credentials, provider requests or real records.
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, ""));
  for (const content of styles) await page.addStyleTag({ content });
  // Match production order: this document's scoped rules follow interface.css.
  await page.addStyleTag({ content: html.match(/<style>([\s\S]*?)<\/style>/)[1] });
  await page.evaluate(() => {
    document.documentElement.dataset.coreAccess = "manager";
    document.getElementById("connectionLabel").textContent = "합성 데이터";
    document.getElementById("connectionDetail").textContent = "로컬 mock · 운영 연결 없음";
  });
  const harness = `
    const qs = id => document.getElementById(id);
    const setText = (id, text) => { if (qs(id)) qs(id).textContent = text; };
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const pill = (label, tone) => '<span class="pill ' + tone + '">' + escapeHtml(label) + '</span>';
    const timestampMs = value => Date.parse(value || '') || 0;
    const formatDate = value => value ? '2026. 10. 29.' : '';
    const formatPhoneNumber = value => value;
    const uiIcon = () => ${JSON.stringify(uiIcon("clipboard-check"))};
    const recommendedMealRecentTime = item => item.updatedAt || item.createdAt;
    let selectedMealRequestId = '', mealQueueFilter = 'active', mealReviewSequence = 0;
    let mealReviewLoading = false, mealActionPending = '', mealDraftDirty = false, mealReviewStale = true, mealPublishNeedsReview = false, mealEditorDay = 0;
    const content = {
      title: '합성 회원의 7일 식단', goal: '규칙적인 식사', summary: '합성 초안', metricsSummary: '',
      principles: ['균형 있게 식사'], hydration: '충분한 수분', exerciseNutrition: '일상 식사', weekendStrategy: '', caution: '운영자 검토',
      days: Array.from({length: 7}, (_, index) => ({ day: index + 1, breakfast: '아침 합성 식사', lunch: '점심 합성 식사', dinner: '저녁 합성 식사', snack: '', timingTip: '' }))
    };
    const bundle = id => ({
      request: {requestId: id, memberName: id === 'meal-synthetic-operator-a' ? '합성 회원 하나' : '합성 회원 둘', memberPhone: '', status: 'submitted', recommendationStatus: 'awaiting_operator_review', updatedAt: '2026-10-29'},
      response: {submittedAt: '2026-10-29', sourceHash: 'a'.repeat(64), answers: {schemaVersion: 'meal-choice-v2', mainMealSource: '집밥·도시락', healthFlags: ['해당 없음'], snackPattern: ['단 간식·음료', '야식'], preferredFoods: ['한식', '두부·콩'], aiProcessingConsent: true, consentVersion: 'synthetic-consent'}},
      inbody: null, report: {publicationStatus: 'draft'},
      draft: {provider: 'safe_fallback', model: 'rule-based-v1', generationError: 'gemini_free_tier_identity_unverified', revision: 'synthetic-revision', reviewReasons: [], publicContent: structuredClone(content)}
    });
    const state = { recommendedMealProgramRequests: [], recommendedMealReview: null };
    window.mealMock = {calls: [], bundles: {'meal-synthetic-operator-a': bundle('meal-synthetic-operator-a'), 'meal-synthetic-operator-b': bundle('meal-synthetic-operator-b')}, hold: {}, fail: {}, pending: [], refreshes: 0};
    state.recommendedMealProgramRequests = Object.values(mealMock.bundles).map(value => structuredClone(value.request));
    async function gate(name, args) {
      if (mealMock.hold[name]) await new Promise(resolve => mealMock.pending.push({name, id: args?.requestId, resolve}));
      if (mealMock.fail[name]) throw new Error('합성 오류: ' + name);
    }
    mealMock.copies = []; mealMock.copyAttempts = []; mealMock.exampleContent = structuredClone(content);
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {
      mealMock.copyAttempts.push(text); await gate('clipboard'); mealMock.copies.push(text);
    }}});
    async function initFirebase() {
      await gate('runtime');
      return { functionsClient: {}, httpsCallable: (_, name) => async args => {
        mealMock.calls.push({name, args: structuredClone(args)});
        await gate(name, args);
        const review = mealMock.bundles[args.requestId];
        if (name === 'getRecommendedMealProgramReview') return {data: structuredClone(review)};
        if (name === 'saveRecommendedMealProgramDraft') {
          if (args.expectedRevision !== (review.draft?.revision || '') || args.expectedResponseHash !== review.response.sourceHash) {
            throw new Error('합성 충돌: 응답 또는 초안 원본 변경');
          }
          review.draft ||= bundle(args.requestId).draft;
          review.draft.publicContent = structuredClone(args.publicContent);
          review.draft.reviewAcknowledged = args.reviewAcknowledged;
          review.draft.revision = 'saved-synthetic-revision';
          review.draft.provider = 'operator_assisted'; review.draft.model = 'codex-chat'; review.draft.generationError = '';
          return {data: mealMock.saveResult || {ok: true, requestId: args.requestId, draft: structuredClone(review.draft)}};
        }
        if (name === 'operatorPublishRecommendedMealPlan') {
          if (!mealMock.publishStatus || mealMock.publishStatus === 'published') review.report.publicationStatus = 'published';
          return {data: {status: mealMock.publishStatus || 'published'}};
        }
        throw new Error('Unexpected callable: ' + name);
      }};
    }
    async function refresh() {
      mealMock.refreshes += 1;
      const button = qs('refreshButton'); button.disabled = true;
      try { await gate('refresh'); renderRecommendedMealQueue(); }
      catch { state.recommendedMealProgramRequests = []; renderRecommendedMealReview(null); renderRecommendedMealQueue(); }
      finally { button.disabled = false; }
    }
    ${mealSource}
    qs('refreshButton').addEventListener('click', refresh);
    qs('recommendedMealQueue').addEventListener('click', handleMealQueueClick);
    qs('mealFilterBar').addEventListener('click', handleMealFilterClick);
    qs('mealGenerateButton').addEventListener('click', handleMealGenerate);
    qs('mealDraftForm').addEventListener('submit', handleMealDraftSubmit);
    qs('mealSendButton').addEventListener('click', handleMealApproveAndSend);
    initMealReviewGuards(); renderRecommendedMealQueue();
    window.mealTest = { loadRecommendedMealReview, renderRecommendedMealReview, fillMealDraftForm, saveMealDraft, handleMealGenerate, handleMealDraftSubmit, handleMealApproveAndSend, handleMealRefresh, mealFlowStatus,
      snapshot: () => ({selectedMealRequestId, mealReviewSequence, mealReviewLoading, mealActionPending, mealDraftDirty, mealReviewStale, mealPublishNeedsReview}) };
  `;
  await page.evaluate(source => { (0, eval)(source); }, harness);
  return {
    page,
    load: id => page.evaluate(id => mealTest.loadRecommendedMealReview(id), id),
    hold: name => page.evaluate(name => { mealMock.hold[name] = true; }, name),
    release: (name, id) => page.evaluate(({name, id}) => {
      const index = mealMock.pending.findIndex(item => item.name === name && (!id || item.id === id));
      if (index < 0) throw new Error('Missing held operation: ' + name);
      mealMock.pending.splice(index, 1)[0].resolve();
    }, {name, id}),
    calls: () => page.evaluate(() => mealMock.calls),
    snapshot: () => page.evaluate(() => mealTest.snapshot()),
    idle: () => page.waitForFunction(() => !mealTest.snapshot().mealActionPending && !mealTest.snapshot().mealReviewLoading)
  };
}

test("page preserves runtime IDs, schema is display-only, health sources closed by default", () => {
  for (const id of ['mealDraftForm', 'mealMetricsSummary', 'mealGenerateButton', 'mealSendButton', 'mealSurveySummary', 'mealInbodySummary']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /설문 원본 · 운영자 전용/);
  assert.doesNotMatch(html, /MutationObserver|<script>\s*\(\(\)/);
  assert.doesNotMatch(mealSource, /설문과 최신 InBody를 반영|AI 식단 다시 생성|설문 제출 후 식단을 자동 생성하고 있습니다/);
  assert.doesNotMatch(mealSource, /generateRecommendedMealProgramDraft|setInterval|setTimeout/);
  assert.match(html, />작성 요청 복사<\/button>/);
  assert.ok(app.includes('initMealReviewGuards();'));
});

test("meal operating rules describe manual invocation, canonical guards and no sensitive clipboard data", () => {
  const mealRules = rules.match(/<article class="rule-card" id="meal-plan">([\s\S]*?)<\/article>/)[1];
  for (const marker of ['operator_call_required', '작성 요청 복사', 'expectedResponseHash', 'expectedRevision', 'operator_assisted', 'codex-chat', '자동 무효화하지 않습니다', '클립보드에 넣지 않습니다', '정기 조회·자동 Codex 깨우기를 추가하지 않습니다']) assert.ok(mealRules.includes(marker), marker);
  assert.doesNotMatch(mealRules, /제출 후 검토용 7일 초안을 생성합니다|무료 모델을 사용합니다|기본 초안 모드로 동작합니다/);
});

test("request sent is not published; operator-call requests are ready, not unsubmitted", async t => {
  const f = await fixture(t);
  const statuses = await f.page.evaluate(() => [
    mealTest.mealFlowStatus({status: 'sent'}), mealTest.mealFlowStatus({status: 'sent', recommendationStatus: 'awaiting_survey'}),
    mealTest.mealFlowStatus({recommendationStatus: 'draft_failed'}), mealTest.mealFlowStatus({recommendationStatus: 'published'}),
    mealTest.mealFlowStatus({recommendationStatus: 'operator_call_required'})
  ]);
  assert.deepEqual(statuses.map(item => item.stage), ['awaiting', 'awaiting', 'review', 'sent', 'ready']);
  assert.equal(statuses.at(-1).label, '관리자 호출 대기');
});

test("v2 arrays, safe fallback, free-tier errorcode and original health source remain distinct", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  for (const label of ['주된 식사 마련 방식', '건강상 주의사항', '간식·야식·음주', '선호 음식']) assert.ok(await f.page.locator('#mealSurveySummary').textContent().then(text => text.includes(label)));
  assert.match(await f.page.locator('#mealSurveySummary').textContent(), /단 간식·음료, 야식/);
  assert.match(await f.page.locator('#mealGenerationStatus').textContent(), /기존 기본 초안.*AI 생성 아님.*새 AI API 호출 없음.*무료 등급 미확인.*gemini_free_tier_identity_unverified/);
  assert.match(await f.page.locator('#mealPublicationState').textContent(), /미공개.*발송이 아닙니다/);
  assert.equal(await f.page.locator('details[open]').count(), 0);
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), true);
});

test("legacy answers and consent history are retained without automatic invalidation", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].response.answers = {primaryGoal: '기존 목표', snackPattern: '기존 자유입력', preferredFoods: ['기존 음식'], medicalConditions: '기존 합성 응답', additionalNote: '<img src=x onerror=bad()>'}; });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealConsentState').textContent(), /기존 응답.*동의 기록 미확인.*보존.*자동 무효화 없음/);
  const text = await f.page.locator('#mealSurveySummary').textContent();
  for (const value of ['기존 자유입력', '기존 음식', '기존 합성 응답', '<img src=x onerror=bad()>']) assert.ok(text.includes(value));
  assert.equal(await f.page.locator('#mealSurveySummary img').count(), 0);
  assert.equal(await f.page.locator('#mealSaveButton').isEnabled(), true);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].response.answers.aiProcessingConsent = true; });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealConsentState').textContent(), /과거 AI 처리 동의 기록.*보존.*자동 무효화 없음/);
});

test("operator-assisted drafts are distinct from preserved historical providers", async t => {
  const f = await fixture(t);
  for (const [provider, generationError, expected] of [
    ['operator_assisted', '', /관리자 호출 작성 초안.*Codex 채팅 작성.*새 AI API 호출 없음/],
    ['operator', '', /관리자 직접 작성 초안.*새 AI API 호출 없음/],
    ['gemini', '', /Gemini 생성 초안/],
    ['safe_health_review', '', /AI 생성 없이.*검토 대기.*새 AI API 호출 없음/],
    ['safe_fallback', 'gemini_generation_http_429', /무료 한도/],
    ['safe_fallback', 'gemini_paid_or_unknown_billing_blocked', /무료 사용 조건 미충족/],
    ['safe_fallback', 'gemini_free_tier_billing_unverified', /무료 등급 미확인/],
    ['safe_fallback', 'gemini_generation_unavailable_no_paid_fallback', /과거 AI 생성 보류 기록/],
    ['old_provider', '', /생성 출처 확인 필요/]
  ]) {
    await f.page.evaluate(({provider, generationError}) => Object.assign(mealMock.bundles['meal-synthetic-operator-a'].draft, {provider, generationError}), {provider, generationError});
    await f.load('meal-synthetic-operator-a');
    assert.match(await f.page.locator('#mealGenerationStatus').textContent(), expected);
  }
});

test("new operator consent and direct CORE writing have explicit labels, not legacy AI provenance", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    Object.assign(mealMock.bundles['meal-synthetic-operator-a'].response.answers, {aiProcessingConsent: true, consentVersion: 'meal-preferences-operator-v1-20261029'});
    Object.assign(mealMock.bundles['meal-synthetic-operator-a'].draft, {provider: 'operator', model: 'manual', generationError: ''});
  });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealConsentState').textContent(), /관리자 검토·작성지원 동의 기록/);
  assert.doesNotMatch(await f.page.locator('#mealConsentState').textContent(), /과거 AI/);
  assert.equal(await f.page.locator('#mealDraftProviderLabel').textContent(), '관리자 직접 작성');
  assert.match(await f.page.locator('#mealDraftMeta').textContent(), /manual/);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].response.answers.consentVersion = 'meal-preferences-gemini-v1-20261029'; });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealConsentState').textContent(), /과거 AI 처리 동의 기록.*보존/);
  assert.equal((await f.calls()).length, 2);
});

test("out-of-order selection responses cannot replace the current member", async t => {
  const f = await fixture(t); await f.hold('getRecommendedMealProgramReview');
  await f.page.evaluate(() => { void mealTest.loadRecommendedMealReview('meal-synthetic-operator-a'); void mealTest.loadRecommendedMealReview('meal-synthetic-operator-b'); });
  await f.page.waitForFunction(() => mealMock.pending.length === 2);
  assert.equal(await f.page.locator('#mealReviewTitle').textContent(), '검토 자료 조회 중');
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
  await f.release('getRecommendedMealProgramReview', 'meal-synthetic-operator-b');
  await f.idle();
  assert.match(await f.page.locator('#mealReviewTitle').textContent(), /합성 회원 둘/);
  await f.release('getRecommendedMealProgramReview', 'meal-synthetic-operator-a');
  await f.page.waitForFunction(() => mealMock.pending.length === 0);
  assert.match(await f.page.locator('#mealReviewTitle').textContent(), /합성 회원 둘/);
  assert.equal((await f.snapshot()).selectedMealRequestId, 'meal-synthetic-operator-b');
});

test("failed or mismatched selection hides stale details and disables all writes", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.evaluate(() => { mealMock.fail.getRecommendedMealProgramReview = true; });
  await f.load('meal-synthetic-operator-b');
  assert.equal(await f.page.locator('#mealReviewBody').isVisible(), false);
  for (const id of ['mealGenerateButton', 'mealSaveButton', 'mealSendButton']) assert.equal(await f.page.locator('#' + id).isEnabled(), false);
  assert.equal(await f.page.locator('#mealReviewMessage').getAttribute('role'), 'alert');
  await f.page.evaluate(() => { mealMock.fail.getRecommendedMealProgramReview = false; mealMock.bundles['meal-synthetic-operator-b'].request.requestId = 'meal-synthetic-operator-a'; });
  await f.load('meal-synthetic-operator-b');
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /일치하지 않습니다/);
  assert.equal((await f.snapshot()).mealReviewStale, true);
});

test("no-draft submitted state waits for administrator invocation and cannot publish", async t => {
  const f = await fixture(t); await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].draft = null; }); await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /관리자 호출 대기.*새 AI API 호출이나 자동 초안 작성은 실행되지 않습니다/);
  assert.equal(await f.page.locator('#mealDraftForm').isVisible(), false);
  assert.equal(await f.page.locator('#mealGenerateButton').textContent(), '작성 요청 복사');
  await f.page.evaluate(() => mealTest.handleMealApproveAndSend());
  assert.deepEqual((await f.calls()).map(item => item.name), ['getRecommendedMealProgramReview']);
});

test("unsaved edits block selection, refresh, copy and links without losing values", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealTitle').fill('보존할 수정본');
  await f.load('meal-synthetic-operator-b');
  await f.page.locator('#refreshButton').click();
  await f.page.locator('#mealGenerateButton').click();
  await f.page.locator('.text-link').click();
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '보존할 수정본');
  assert.equal((await f.snapshot()).selectedMealRequestId, 'meal-synthetic-operator-a');
  assert.equal((await f.calls()).length, 1);
  assert.equal(await f.page.evaluate(() => mealMock.refreshes), 0);
  assert.equal((await f.snapshot()).mealDraftDirty, true);
  assert.equal(await f.page.evaluate(() => mealMock.copies.length), 0);
});

test("save snapshots current request, blocks double-submit/other actions and retains failed edits", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a'); await f.page.locator('#mealTitle').fill('합성 저장 수정');
  await f.hold('saveRecommendedMealProgramDraft');
  await f.page.evaluate(() => { void mealTest.handleMealDraftSubmit({preventDefault(){}}); void mealTest.handleMealDraftSubmit({preventDefault(){}}); void mealTest.handleMealGenerate(); void mealTest.handleMealApproveAndSend(); void mealTest.loadRecommendedMealReview('meal-synthetic-operator-b'); });
  await f.page.waitForFunction(() => mealMock.pending.length === 1);
  assert.equal(await f.page.locator('#mealTitle').isEnabled(), false);
  let calls = await f.calls();
  assert.equal(calls.filter(item => item.name === 'saveRecommendedMealProgramDraft').length, 1);
  assert.equal(calls.at(-1).args.requestId, 'meal-synthetic-operator-a');
  assert.equal(calls.at(-1).args.publicContent.title, '합성 저장 수정');
  assert.equal(calls.at(-1).args.expectedRevision, 'synthetic-revision');
  assert.equal(calls.at(-1).args.expectedResponseHash, 'a'.repeat(64));
  await f.page.evaluate(() => { mealMock.fail.saveRecommendedMealProgramDraft = true; });
  await f.release('saveRecommendedMealProgramDraft'); await f.idle();
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '합성 저장 수정');
  assert.equal((await f.snapshot()).mealDraftDirty, true);
  assert.equal(await f.page.locator('#mealSaveButton').isEnabled(), true);
  await f.page.evaluate(() => { mealMock.hold.saveRecommendedMealProgramDraft = false; mealMock.fail.saveRecommendedMealProgramDraft = false; });
  await f.page.locator('#mealSaveButton').click(); await f.idle();
  assert.equal((await f.snapshot()).mealDraftDirty, false);
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '합성 저장 수정');
});

test("unconfirmed save result preserves edits and never proceeds to publication", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealTitle').fill('저장 확인 전 수정본');
  await f.page.evaluate(() => { mealMock.saveResult = {ok: true, requestId: 'meal-synthetic-operator-b'}; });
  f.page.once('dialog', dialog => dialog.accept());
  await f.page.locator('#mealSendButton').click(); await f.idle();
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /저장 완료를 확인하지 못했습니다/);
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '저장 확인 전 수정본');
  assert.equal((await f.snapshot()).mealDraftDirty, true);
  assert.equal((await f.calls()).filter(item => item.name === 'operatorPublishRecommendedMealPlan').length, 0);
});

test("invalidated review during runtime initialization prevents a stale write", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealTitle').fill('인증 대기 중 보존할 수정본');
  await f.hold('runtime');
  await f.page.locator('#mealSaveButton').click();
  await f.page.waitForFunction(() => mealMock.pending.length === 1);
  await f.page.evaluate(() => mealTest.renderRecommendedMealReview(null));
  await f.release('runtime'); await f.idle();
  assert.equal((await f.calls()).filter(item => item.name === 'saveRecommendedMealProgramDraft').length, 0);
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '인증 대기 중 보존할 수정본');
  assert.equal((await f.snapshot()).mealDraftDirty, true);
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
});

test("copy serializes current request, contains no raw answers and does not execute anything", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].draft = null; mealMock.bundles['meal-synthetic-operator-a'].request.recommendationStatus = 'operator_call_required'; });
  await f.load('meal-synthetic-operator-a');
  await f.hold('clipboard');
  await f.page.locator('#mealGenerateButton').click();
  await f.page.waitForFunction(() => mealMock.pending.length === 1);
  await f.page.evaluate(() => { void mealTest.handleMealGenerate(); void mealTest.loadRecommendedMealReview('meal-synthetic-operator-b'); });
  const calls = await f.calls();
  assert.deepEqual(calls.map(item => item.name), ['getRecommendedMealProgramReview']);
  assert.equal(await f.page.locator('#mealGenerateButton').textContent(), '복사 중');
  await f.release('clipboard'); await f.idle();
  assert.equal((await f.snapshot()).selectedMealRequestId, 'meal-synthetic-operator-a');
  const copies = await f.page.evaluate(() => mealMock.copies);
  assert.equal(copies.length, 1);
  assert.match(copies[0], /^추천식단 requestId: meal-synthetic-operator-a\n/);
  assert.match(copies[0], /이 Codex 채팅.*초안\(DRAFT\)만 작성하고 저장/);
  assert.match(copies[0], /기존 응답은 보존/);
  assert.match(copies[0], /승인·공개·발송은 하지 마세요/);
  assert.doesNotMatch(copies[0], /합성 회원|집밥|도시락|단 간식|야식|한식|두부|synthetic-consent|해당 없음|InBody|memberPhone|accessToken/);
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /복사 완료.*관리자 호출 대기.*자동 실행·공개·발송되지 않습니다/);
  assert.equal(await f.page.evaluate(() => mealMock.bundles['meal-synthetic-operator-a'].draft), null);
  assert.equal(await f.page.locator('#mealGenerateButton').isEnabled(), true);
});

test("copy from an existing draft never replaces it or initializes an API runtime", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  const before = await f.page.evaluate(() => JSON.stringify(mealMock.bundles['meal-synthetic-operator-a']));
  await f.hold('runtime');
  await f.page.locator('#mealGenerateButton').click();
  assert.equal((await f.calls()).length, 1);
  assert.equal(await f.page.evaluate(() => mealMock.pending.length), 0);
  assert.equal(await f.page.evaluate(() => mealMock.copies.length), 1);
  assert.equal(await f.page.evaluate(() => JSON.stringify(mealMock.bundles['meal-synthetic-operator-a'])), before);
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '합성 회원의 7일 식단');
  assert.equal(await f.page.locator('#mealGenerateButton').isEnabled(), true);
  assert.equal(await f.page.locator('#mealReviewMessage').getAttribute('role'), 'status');
});

for (const unavailable of [false, true]) {
  test(`clipboard ${unavailable ? 'unavailable' : 'rejection'} shows ID-only manual fallback, not copied or executed`, async t => {
    const f = await fixture(t); await f.load('meal-synthetic-operator-a');
    await f.page.evaluate(unavailable => {
      if (unavailable) Object.defineProperty(navigator, 'clipboard', {value: undefined});
      else mealMock.fail.clipboard = true;
    }, unavailable);
    await f.page.locator('#mealGenerateButton').click(); await f.idle();
    const fallback = f.page.locator('#mealOperatorRequestText');
    assert.equal(await fallback.isVisible(), true);
    assert.equal(await fallback.getAttribute('readonly'), '');
    assert.match(await fallback.inputValue(), /requestId: meal-synthetic-operator-a/);
    assert.doesNotMatch(await fallback.inputValue(), /합성 회원|집밥|야식|해당 없음|synthetic-consent/);
    assert.match(await f.page.locator('#mealReviewMessage').textContent(), /자동 복사하지 못했습니다.*아직 실행되지 않았습니다/);
    assert.equal(await f.page.evaluate(() => mealMock.copies.length), 0);
    assert.equal((await f.calls()).length, 1);
    await f.load('meal-synthetic-operator-b');
    assert.equal(await fallback.isVisible(), false);
    assert.equal(await fallback.inputValue(), '');
  });
}

test("copy refuses a legacy ID fallback rather than claiming a canonical request ID", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.evaluate(() => {
    const review = structuredClone(mealMock.bundles['meal-synthetic-operator-a']);
    review.request.id = review.request.requestId; review.request.requestId = '';
    mealTest.renderRecommendedMealReview(review);
  });
  await f.page.evaluate(() => mealTest.handleMealGenerate());
  assert.equal(await f.page.evaluate(() => mealMock.copies.length), 0);
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /정식 요청 ID/);
});

test("draft save includes empty expectedRevision only when no existing draft and preserves response", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].draft = null; });
  await f.load('meal-synthetic-operator-a');
  const response = await f.page.evaluate(() => JSON.stringify(mealMock.bundles['meal-synthetic-operator-a'].response));
  await f.page.evaluate(() => {
    mealTest.fillMealDraftForm({publicContent: mealMock.exampleContent, reviewReasons: []});
    return mealTest.saveMealDraft();
  });
  const calls = await f.calls();
  assert.equal(calls.at(-1).args.expectedRevision, '');
  assert.equal(calls.at(-1).args.expectedResponseHash, 'a'.repeat(64));
  assert.equal(await f.page.evaluate(() => JSON.stringify(mealMock.bundles['meal-synthetic-operator-a'].response)), response);
  assert.equal(calls.some(item => /generate|publish|send/i.test(item.name)), false);
});

for (const missing of ['hash', 'revision']) {
  test(`missing ${missing} fails closed and retains unsaved edits`, async t => {
    const f = await fixture(t);
    await f.page.evaluate(missing => {
      if (missing === 'hash') delete mealMock.bundles['meal-synthetic-operator-a'].response.sourceHash;
      else delete mealMock.bundles['meal-synthetic-operator-a'].draft.revision;
    }, missing);
    await f.load('meal-synthetic-operator-a');
    await f.page.locator('#mealTitle').fill('보존할 합성 수정본');
    await f.page.locator('#mealSaveButton').click(); await f.idle();
    assert.equal((await f.calls()).length, 1);
    assert.equal(await f.page.locator('#mealTitle').inputValue(), '보존할 합성 수정본');
    assert.equal((await f.snapshot()).mealDraftDirty, true);
    assert.match(await f.page.locator('#mealReviewMessage').textContent(), /revision 또는 응답 sourceHash/);
  });
}

test("response or revision changed on the server rejects stale save without publishing or overwriting", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealTitle').fill('충돌 시 보존할 수정본');
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].response.sourceHash = 'b'.repeat(64); mealMock.bundles['meal-synthetic-operator-a'].draft.revision = 'new-server-revision'; });
  f.page.once('dialog', dialog => dialog.accept());
  await f.page.locator('#mealSendButton').click(); await f.idle();
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /원본 변경/);
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '충돌 시 보존할 수정본');
  assert.equal((await f.snapshot()).mealDraftDirty, true);
  assert.equal((await f.calls()).some(item => item.name === 'operatorPublishRecommendedMealPlan'), false);
  assert.equal(await f.page.evaluate(() => mealMock.bundles['meal-synthetic-operator-a'].draft.publicContent.title), '합성 회원의 7일 식단');
});

for (const [field, value] of [['publicationStatus', 'approved'], ['publicationStatus', 'published'], ['publicationStatus', 'sent'], ['approvalStatus', 'approved'], ['approvalStatus', 'sent'], ['candidateId', 'synthetic-candidate'], ['approvedAt', '2026-10-29'], ['publishedAt', '2026-10-29'], ['sentAt', '2026-10-29'], ['sentRevision', 'synthetic-revision'], ['approvedSnapshot', {}]]) {
  test(`${field}=${value} report stays read-only with no copy, save or publish requests`, async t => {
    const f = await fixture(t);
    await f.page.evaluate(({field, value}) => { mealMock.bundles['meal-synthetic-operator-a'].report[field] = value; }, {field, value});
    await f.load('meal-synthetic-operator-a');
    for (const id of ['mealTitle', 'mealGenerateButton', 'mealSaveButton', 'mealSendButton']) assert.equal(await f.page.locator('#' + id).isEnabled(), false);
    await f.page.evaluate(() => { void mealTest.handleMealGenerate(); void mealTest.handleMealDraftSubmit({preventDefault(){}}); void mealTest.handleMealApproveAndSend(); });
    assert.equal((await f.calls()).length, 1);
    assert.equal(await f.page.evaluate(() => mealMock.copies.length), 0);
  });
}

test("editor day tabs preserve all seven days and support keyboard navigation", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  assert.equal(await f.page.locator('[role="tab"]').count(), 7);
  assert.equal(await f.page.locator('[role="tabpanel"]:visible').count(), 1);
  const firstBreakfast = f.page.locator('[data-meal-day="0"] [data-meal-day-field="breakfast"]');
  await firstBreakfast.fill('1일차 수정 내용');
  await f.page.locator('#mealDayTab6').click();
  await f.page.locator('[data-meal-day="6"] [data-meal-day-field="dinner"]').fill('7일차 수정 내용');
  await f.page.locator('#mealDayTab6').press('Home');
  assert.equal(await f.page.locator('#mealDayTab0').getAttribute('aria-selected'), 'true');
  assert.equal(await firstBreakfast.inputValue(), '1일차 수정 내용');
  await f.page.locator('#mealDayTab0').press('ArrowLeft');
  assert.equal(await f.page.locator('#mealDayTab6').getAttribute('aria-selected'), 'true');
  await f.page.locator('#mealSaveButton').click(); await f.idle();
  const saved = (await f.calls()).find(item => item.name === 'saveRecommendedMealProgramDraft').args.publicContent.days;
  assert.equal(saved.length, 7);
  assert.equal(saved[0].breakfast, '1일차 수정 내용');
  assert.equal(saved[6].dinner, '7일차 수정 내용');
});

test("required input on a hidden day is revealed and focused before any save or publish", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealDayTab4').click();
  await f.page.locator('[data-meal-day="4"] [data-meal-day-field="lunch"]').fill('');
  await f.page.locator('#mealDayTab0').click();
  await f.page.locator('#mealSaveButton').click();
  assert.equal(await f.page.locator('#mealDayTab4').getAttribute('aria-selected'), 'true');
  assert.equal(await f.page.locator('[data-meal-day="4"] [data-meal-day-field="lunch"]').evaluate(element => element === document.activeElement), true);
  assert.equal((await f.calls()).length, 1);
  await f.page.locator('#mealDayTab0').click();
  await f.page.evaluate(() => mealTest.handleMealApproveAndSend());
  assert.equal(await f.page.locator('#mealDayTab4').getAttribute('aria-selected'), 'true');
  assert.equal((await f.calls()).length, 1);
});

test("read-only reports still allow day inspection and progress never implies publication early", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].report.approvalStatus = 'approved'; });
  await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealDayTab6').click();
  assert.equal(await f.page.locator('[data-meal-day="6"]').isVisible(), true);
  assert.equal(await f.page.locator('[data-meal-day="6"] textarea').first().isEnabled(), false);
  assert.equal(await f.page.locator('[data-meal-stage="2"]').getAttribute('aria-current'), 'step');
  assert.equal(await f.page.locator('[data-meal-stage="3"]').getAttribute('aria-current'), null);
  assert.equal((await f.calls()).length, 1);
});

test("survey-request send record is not submission, draft, publication or delivery", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { Object.assign(mealMock.bundles['meal-synthetic-operator-a'], {response: null, draft: null}); Object.assign(mealMock.bundles['meal-synthetic-operator-a'].request, {status: 'sent', recommendationStatus: ''}); });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealReviewStatus').textContent(), /설문 미제출/);
  assert.match(await f.page.locator('#mealReviewMeta').textContent(), /발송 기록.*도달 별도 확인/);
  assert.equal(await f.page.locator('#mealGenerateButton').isEnabled(), false);
  assert.match(await f.page.locator('#mealPublicationState').textContent(), /미공개/);
});

test("published legacy report without an editable draft is still correctly locked", async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].report.publicationStatus = 'published'; mealMock.bundles['meal-synthetic-operator-a'].draft = null; });
  await f.load('meal-synthetic-operator-a');
  assert.match(await f.page.locator('#mealReviewMessage').textContent(), /공개되어 수정이 잠겼습니다/);
  assert.equal(await f.page.locator('#mealGenerateButton').isEnabled(), false);
  assert.equal(await f.page.locator('#mealSentCount').textContent(), '1');
});

test("refresh reloads selected details, but never an old response after refresh failure", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].draft.publicContent.title = '서버에서 바뀐 합성 초안'; });
  await f.page.locator('#refreshButton').click(); await f.idle();
  assert.equal(await f.page.locator('#mealTitle').inputValue(), '서버에서 바뀐 합성 초안');
  assert.equal(await f.page.evaluate(() => mealMock.refreshes), 1);
  await f.page.evaluate(() => { mealMock.fail.refresh = true; });
  await f.page.locator('#refreshButton').click(); await f.idle();
  assert.equal(await f.page.locator('#mealReviewBody').isVisible(), false);
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
});

test("publish validates first, supports cancel, locks current request, and stays locked after readback", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.locator('#mealTitle').fill('');
  await f.page.evaluate(() => mealTest.handleMealApproveAndSend());
  assert.equal((await f.calls()).length, 1);
  await f.page.locator('#mealTitle').fill('공개 합성 초안');
  f.page.once('dialog', dialog => dialog.dismiss());
  await f.page.locator('#mealSendButton').click();
  assert.equal((await f.calls()).length, 1);
  await f.hold('operatorPublishRecommendedMealPlan');
  f.page.once('dialog', dialog => dialog.accept());
  await f.page.locator('#mealSendButton').click();
  await f.page.waitForFunction(() => mealMock.pending.length === 1);
  await f.page.evaluate(() => { void mealTest.handleMealApproveAndSend(); void mealTest.loadRecommendedMealReview('meal-synthetic-operator-b'); });
  assert.equal((await f.calls()).filter(item => item.name === 'operatorPublishRecommendedMealPlan').length, 1);
  await f.release('operatorPublishRecommendedMealPlan'); await f.idle();
  assert.equal((await f.snapshot()).selectedMealRequestId, 'meal-synthetic-operator-a');
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
  assert.equal(await f.page.locator('#mealGenerateButton').isEnabled(), false);
  assert.equal(await f.page.locator('#mealTitle').isEnabled(), false);
  assert.match(await f.page.locator('#mealPublicationState').textContent(), /공개됨.*발송·도달 여부는 별도/);
  assert.equal((await f.calls()).filter(item => /send|alimtalk/i.test(item.name)).length, 0);
});

test("ambiguous publication cannot be replayed before fresh readback", async t => {
  const f = await fixture(t); await f.load('meal-synthetic-operator-a');
  await f.page.evaluate(() => { mealMock.fail.operatorPublishRecommendedMealPlan = true; });
  f.page.once('dialog', dialog => dialog.accept());
  await f.page.locator('#mealSendButton').click(); await f.idle();
  assert.equal((await f.snapshot()).mealPublishNeedsReview, true);
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
  await f.page.evaluate(() => mealTest.handleMealApproveAndSend());
  assert.equal((await f.calls()).filter(item => item.name === 'operatorPublishRecommendedMealPlan').length, 1);
  await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-a'].report.publicationStatus = 'published'; });
  await f.page.locator('#refreshButton').click(); await f.idle();
  assert.equal(await f.page.locator('#mealSendButton').isEnabled(), false);
});

for (const width of [320, 390, 768, 1440]) {
  test(`${width}px mock QA: no overflow, native disclosures, focus and touch targets`, async t => {
    const f = await fixture(t, width); await f.load('meal-synthetic-operator-a');
    await f.page.evaluate(() => {
      document.documentElement.style.setProperty('overflow', 'visible', 'important');
      document.body.style.setProperty('overflow', 'visible', 'important');
    });
    await f.page.getByText('설문 원본 · 운영자 전용', {exact: true}).click();
    assert.equal(await f.page.locator('.meal-sensitive-card').getAttribute('open'), '');
    await f.page.getByText('설문 원본 · 운영자 전용', {exact: true}).press('Enter');
    assert.equal(await f.page.locator('.meal-sensitive-card').getAttribute('open'), null);
    const measurements = await f.page.evaluate(() => {
      const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
      const overflow = [...document.querySelectorAll('main *')].filter(visible).filter(element => {
        const rect = element.getBoundingClientRect(); return rect.right > innerWidth + 1 || rect.left < -1;
      }).map(element => element.id || element.className);
      const targets = [...document.querySelectorAll('main button, main summary')].filter(visible).map(element => [element.id || element.textContent, element.getBoundingClientRect().height]);
      return {width: document.documentElement.scrollWidth, viewport: innerWidth, overflow, targets};
    });
    assert.ok(measurements.width <= measurements.viewport + 1, JSON.stringify(measurements));
    assert.deepEqual(measurements.overflow, []);
    assert.deepEqual(measurements.targets.filter(([, height]) => height < 44), []);
    await f.page.locator('#mealTitle').focus();
    assert.equal(await f.page.locator('#mealTitle').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await f.page.locator('[data-meal-filter="review"]').click();
    assert.equal(await f.page.locator('[data-meal-filter="review"]').getAttribute('aria-pressed'), 'true');
    await f.page.locator('[data-meal-filter="active"]').click();
    await f.page.evaluate(() => scrollTo(0, 0));
    await mkdir('/tmp/archive-meal-operator-call-ui-20261029', {recursive: true});
    await f.page.screenshot({path: `/tmp/archive-meal-operator-call-ui-20261029/${width}.png`, fullPage: true});
    await f.page.screenshot({path: `/tmp/archive-meal-operator-call-ui-20261029/${width}-viewport.png`});
    await f.page.locator('.meal-sensitive-card summary').click();
    await f.page.locator('#mealInbodyHeading').click();
    await f.page.evaluate(() => { mealMock.bundles['meal-synthetic-operator-b'].draft = null; mealMock.bundles['meal-synthetic-operator-b'].request.recommendationStatus = 'operator_call_required'; });
    await f.load('meal-synthetic-operator-b');
    assert.equal(await f.page.locator('details[open]').count(), 0);
    assert.equal(await f.page.locator('#mealReviewStatus').textContent(), '관리자 호출 대기');
    assert.equal(await f.page.locator('#mealGenerateButton').textContent(), '작성 요청 복사');
    await f.page.evaluate(() => { mealMock.fail.clipboard = true; });
    await f.page.locator('#mealGenerateButton').click(); await f.idle();
    assert.equal(await f.page.locator('#mealOperatorRequestText').isVisible(), true);
    const pendingOverflow = await f.page.evaluate(() => [...document.querySelectorAll('main *')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    }).map(element => element.id || element.className));
    assert.deepEqual(pendingOverflow, [], 'pending/copy failure state fits viewport');
    await f.page.locator('#mealGenerateButton').scrollIntoViewIfNeeded();
    await f.page.screenshot({path: `/tmp/archive-meal-operator-call-ui-20261029/${width}-operator-pending.png`});
    await f.page.evaluate(() => Object.assign(mealMock.bundles['meal-synthetic-operator-a'].draft, {provider: 'operator_assisted', model: 'codex-chat', generationError: ''}));
    await f.load('meal-synthetic-operator-a');
    assert.match(await f.page.locator('#mealGenerationStatus').textContent(), /관리자 호출 작성 초안/);
    assert.match(await f.page.locator('#mealDraftMeta').textContent(), /codex-chat/);
  });
}

test("all mock browser tests made zero external requests", () => { assert.equal(blockedRequests, 0); });
