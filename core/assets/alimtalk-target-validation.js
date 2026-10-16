import { sharedNavigationRuntime } from "./core-navigation.js";

const RESULT_LABELS = Object.freeze({
  blocked: "차단", preflight_passed: "사전검증 통과 · 승인·발송 아님",
  not_found: "후보 없음", review_required: "검토 필요",
});
const CHECK_LABELS = Object.freeze({ passed: "통과", blocked: "차단", not_checked: "미확인" });
const STAGE_LABELS = Object.freeze({
  canonical_identity: "원본 식별", attempt_ledger: "발송 시도 이력", eligibility: "대상 조건",
  source: "원본 연결", duplicate: "중복 확인", specialized_final_guard: "업무별 최종 확인", inspection: "자료 조회",
});
const REASON_LABELS = Object.freeze({
  ok: "이상 없음", source_identity_mismatch: "원본 식별 불일치",
  existing_attempt_requires_reconciliation: "기존 발송 시도 대조 필요",
  staff_excluded: "직원 대상 제외", template_snapshot_unverified: "템플릿 스냅샷 미확인",
  eligibility_blocked: "대상 조건 불충족", source_blocked: "원본 조건 불충족", duplicate_blocked: "중복 대상",
  existing_runtime_readback_required: "최종 원본 재조회 필요", source_read_failed: "원본 조회 실패",
});
const REMAINING_LABELS = new Set([
  "발송 시점 승인 확인", "기존 큐 선점·동시 실행 차단", "업무별 최종 원본·리포트 검증",
]);
const label = (labels, code) => Object.hasOwn(labels, code) ? labels[code] : "확인 필요";

export function validCandidateId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function validationView(data, candidateId) {
  const row = data?.results?.[0];
  const time = typeof data?.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(data.checkedAt)
    ? new Date(data.checkedAt) : null;
  if (data?.readOnly !== true || data?.liveReadback !== false || data?.allowedForExternalActions !== false
    || !Array.isArray(data.results) || data.results.length !== 1 || row?.candidateId !== candidateId
    || !Object.hasOwn(RESULT_LABELS, row?.status) || !time || !Number.isFinite(time.getTime())
    || !Array.isArray(row.checks) || row.checks.length > 100
    || row.checks.some(check => !check || !Object.hasOwn(CHECK_LABELS, check.status))
    || !Array.isArray(row.remainingChecks) || row.remainingChecks.length > 100
    || row.remainingChecks.some(check => typeof check !== "string")
    || (row.status === "preflight_passed" && (!row.checks.length || row.checks.some(check => check.status !== "passed")))) {
    throw new Error("invalid-validation-response");
  }
  // Deliberately project only review codes, never source records, payloads or free-form details.
  return {
    status: row.status, label: RESULT_LABELS[row.status],
    checkedAt: `${new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(time)} KST`,
    checks: row.checks.map(check => `${label(STAGE_LABELS, check.stage)} · ${CHECK_LABELS[check.status]} · ${label(REASON_LABELS, check.reasonCode)}`),
    remainingChecks: row.remainingChecks.map(check => REMAINING_LABELS.has(check) ? check : "추가 확인 필요"),
  };
}

function currentRuntime() {
  const shared = sharedNavigationRuntime();
  if (shared) return shared;
  const host = window.archiveCoreNavigation;
  return host?.session?.role === "manager" && host.uid === host.runtime?.authClient.currentUser?.uid
    ? host.runtime : null;
}

function renderResult(result, view) {
  const doc = result.ownerDocument;
  const text = (tag, value, className) => {
    const node = doc.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  result.replaceChildren(text("strong", view.label), text("p", `검증 시각: ${view.checkedAt}`, "atv-checked-at"));
  if (view.checks.length) {
    const list = doc.createElement("ul");
    list.setAttribute("aria-label", "단계별 검증 결과");
    list.append(...view.checks.map(check => text("li", check)));
    result.append(list);
  }
  result.append(text("p", view.remainingChecks.length
    ? `남은 확인: ${view.remainingChecks.join(" · ")}` : "남은 확인: 없음 · 승인·발송 권한 없음"));
  result.dataset.status = view.status;
  result.hidden = false;
}

export function mountTargetValidation(root, getRuntime = currentRuntime) {
  if (!root || root.dataset.validationMounted) return;
  root.dataset.validationMounted = "true";
  const doc = root.ownerDocument;
  const form = root.querySelector("form");
  const input = form.elements.candidateId;
  const button = form.querySelector("button");
  const status = root.querySelector('[role="status"]');
  const result = root.querySelector("[data-validation-result]");
  let generation = 0;
  let busy = false;
  let disposed = false;
  const manager = () => !disposed && doc.documentElement.dataset.coreAccess === "manager";
  function clearResult() {
    generation += 1;
    status.textContent = "";
    result.replaceChildren();
    result.hidden = true;
    delete result.dataset.status;
  }
  function setBusy(value) {
    busy = value;
    button.disabled = value;
    input.disabled = value;
    form.setAttribute("aria-busy", String(value));
  }
  function accessChanged() {
    clearResult();
    setBusy(false);
    root.hidden = !manager();
    input.value = "";
    input.removeAttribute("aria-invalid");
  }
  function inputChanged() {
    clearResult();
    input.removeAttribute("aria-invalid");
  }
  function selectCandidate(event) {
    const trigger = event.target.closest?.("[data-validate-alimtalk-candidate]");
    if (!trigger || !manager() || busy) return;
    const candidateId = trigger.dataset.validateAlimtalkCandidate;
    if (!validCandidateId(candidateId)) return;
    input.value = candidateId;
    root.scrollIntoView({ block: "nearest" });
    form.requestSubmit();
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !manager()) return;
    clearResult();
    const id = input.value;
    if (!validCandidateId(id)) {
      input.setAttribute("aria-invalid", "true");
      status.textContent = "공백이나 경로 없이 정확한 후보 ID 1개를 입력하세요.";
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const runtime = getRuntime();
    const uid = runtime?.authClient.currentUser?.uid;
    if (!uid) {
      status.textContent = "로그인·권한 연결을 확인한 뒤 다시 검증하세요.";
      return;
    }
    const ticket = generation;
    const stillCurrent = () => ticket === generation && manager()
      && input.value === id && runtime.authClient.currentUser?.uid === uid;
    setBusy(true);
    status.textContent = "검증 중";
    try {
      const callable = runtime.httpsCallable(runtime.functionsClient, "getAlimtalkTargetValidation");
      const response = await callable({ candidateIds: [id] });
      if (!stillCurrent()) return;
      const view = validationView(response?.data, id);
      renderResult(result, view);
      status.textContent = `조회 완료 · ${view.label}`;
    } catch {
      if (stillCurrent()) status.textContent = "검증 결과를 확인하지 못했습니다. 권한·연결을 확인한 뒤 다시 시도하세요.";
    } finally {
      if (ticket === generation) {
        if (!stillCurrent()) clearResult();
        setBusy(false);
      }
    }
  }
  const observer = new MutationObserver(accessChanged);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-core-access"] });
  form.addEventListener("submit", submit);
  input.addEventListener("input", inputChanged);
  doc.addEventListener("click", selectCandidate);
  doc.addEventListener("core-instructor-signed-out", accessChanged);
  function dispose() {
    disposed = true;
    accessChanged();
    observer.disconnect();
    form.removeEventListener("submit", submit);
    input.removeEventListener("input", inputChanged);
    doc.removeEventListener("click", selectCandidate);
    doc.removeEventListener("core-instructor-signed-out", accessChanged);
    window.removeEventListener("pagehide", dispose);
    delete root.dataset.validationMounted;
  }
  window.addEventListener("pagehide", dispose);
  root.hidden = !manager();
  return dispose;
}

if (typeof document !== "undefined") {
  mountTargetValidation(document.querySelector("[data-alimtalk-target-validation]"));
}
