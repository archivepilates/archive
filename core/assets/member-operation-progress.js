import { sharedNavigationRuntime } from "./core-navigation.js";

const STAGES = Object.freeze({
  detection: "감지", source_check: "원본 확인", provider_acceptance: "발송 접수",
  provider_delivery: "전달 결과", memo_queued: "메모 접수", memo_synced: "StudioMate 반영",
});
const STATUSES = Object.freeze({ confirmed: "확인됨", pending: "대기", failed: "실패", unknown: "미확인", review_required: "검토 필요" });
const RESULTS = Object.freeze({ not_found: "기록 없음", in_progress: "진행 중", completed: "모든 기록 확인", review_required: "검토 필요" });
const REASONS = Object.freeze({
  evidence_missing: "기록 미확인", timestamp_missing: "시각 미확인", source_read_failed: "원본 조회 실패",
  source_binding_mismatch: "원본 연결 확인 필요", canonical_event_recorded: "원본 홀딩 등록",
  source_links_verified: "원본 연결 확인", policy_mismatch: "정책 대조 필요",
  message_link_mismatch: "발송 기록 연결 확인 필요", acceptance_marker_unverified: "접수 근거 확인 필요",
  acceptance_verified: "발송 접수 확인", acceptance_unverified: "발송 접수 미확인",
  delivery_complete_4000: "전달 완료 기록 확인", delivery_failed: "전달 실패 기록", delivery_unconfirmed: "전달 결과 미확인",
  memo_link_mismatch: "메모 연결 확인 필요", memo_evidence_unverified: "메모 근거 확인 필요",
  memo_queue_recorded: "메모 큐 등록 확인", memo_synced: "StudioMate 반영 기록 확인",
  memo_sync_failed: "StudioMate 반영 실패", memo_sync_unconfirmed: "StudioMate 반영 미확인",
});
const NEXT_ACTIONS = Object.freeze({
  none: "없음", review_source_records: "원본 기록 검토", review_acceptance: "발송 접수 기록 확인",
  check_delivery_record: "전달 결과 기록 확인", check_memo_queue: "메모 큐 확인", check_memo_sync: "StudioMate 반영 기록 확인",
});
const ownLabel = (labels, code, fallback = "확인 필요") => typeof code === "string" && Object.hasOwn(labels, code) ? labels[code] : fallback;
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const mountedRoots = new WeakMap();

export function validHoldingOperationId(value) {
  return typeof value === "string" && /^holding_operator_notice_[a-f0-9]{64}$/.test(value);
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const date = new Date(value);
  const canonical = value.length === 20 ? value.slice(0, -1) + ".000Z" : value;
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) return null;
  return `${dateFormat.format(date)} KST`;
}

export function memberOperationProgressView(data, operationId) {
  const checkedAt = timestamp(data?.checkedAt);
  const names = Object.keys(STAGES);
  if (!validHoldingOperationId(operationId) || data?.version !== "member-operation-progress-v1" || data.kind !== "holding"
    || data.operationId !== operationId || data.readOnly !== true || data.liveReadback !== false
    || data.allowedForExternalActions !== false || !checkedAt || !Object.hasOwn(RESULTS, data.status)
    || !Array.isArray(data.stages) || data.stages.length !== names.length
    || data.stages.some((row, index) => !row || row.stage !== names[index] || !Object.hasOwn(STATUSES, row.status)
      || (row.at !== null && !timestamp(row.at)) || (row.status === "confirmed" && row.at === null))
    || (data.status === "completed" && data.stages.some(row => row.status !== "confirmed"))
    || (data.status === "not_found" && data.stages.some(row => row.status !== "unknown"))) {
    throw new Error("invalid-operation-progress-response");
  }
  // Project fixed labels and validated times only; payloads, errors and free text never reach the DOM.
  return {
    status: data.status, label: RESULTS[data.status], checkedAt,
    nextAction: ownLabel(NEXT_ACTIONS, data.nextAction, "원본 기록 검토"),
    stages: data.stages.map(row => ({
      label: STAGES[row.stage], status: row.status, statusLabel: STATUSES[row.status],
      reason: ownLabel(REASONS, row.reasonCode),
      at: row.stage === "detection" || row.at === null ? null : timestamp(row.at),
    })),
  };
}

function navigationHost(win) {
  try {
    return win.parent !== win && win.frameElement?.hasAttribute("data-core-navigation-frame")
      ? win.parent.archiveCoreNavigation : win.archiveCoreNavigation;
  } catch { return null; }
}

function currentRuntime() {
  const host = navigationHost(window);
  if (host?.session?.role !== "manager" || host.session.mustChangePassword === true
    || !host.uid || host.uid !== host.runtime?.authClient?.currentUser?.uid) return null;
  return sharedNavigationRuntime() || host.runtime;
}

function renderResult(result, view) {
  const doc = result.ownerDocument;
  const text = (tag, value, className) => {
    const node = doc.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const timeline = doc.createElement("ol");
  timeline.className = "mop-timeline";
  timeline.setAttribute("aria-label", "홀딩 처리 단계");
  for (const stage of view.stages) {
    const item = doc.createElement("li");
    item.dataset.status = stage.status;
    item.append(text("strong", stage.label), text("span", stage.statusLabel, "mop-stage-status"), text("span", stage.reason, "mop-stage-detail"));
    if (stage.at) item.append(text("span", `기록 확인시각: ${stage.at}`, "mop-stage-detail"));
    timeline.append(item);
  }
  result.replaceChildren(text("strong", view.label), text("p", `기록 확인시각: ${view.checkedAt}`, "mop-checked-at"), timeline,
    text("p", `다음 확인: ${view.nextAction}`));
  result.dataset.status = view.status;
  result.hidden = false;
}

export function mountMemberOperationProgress(root, getRuntime = currentRuntime) {
  if (!root) return;
  if (mountedRoots.has(root)) return mountedRoots.get(root);
  mountedRoots.set(root, dispose);
  root.dataset.operationProgressMounted = "true";
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const form = root.querySelector("form");
  const input = form.elements.operationId;
  const button = form.querySelector("button");
  const status = root.querySelector('[role="status"]');
  const result = root.querySelector("[data-operation-progress-result]");
  let generation = 0, busy = false, disposed = false, active = null, unsubscribe;
  let prefill = new URL(win.location.href).searchParams.get("holdingNotice");
  if (!validHoldingOperationId(prefill)) prefill = null;

  function session() {
    if (disposed || !root.isConnected || doc.documentElement.dataset.coreAccess !== "manager"
      || root.closest(".core-navigation-container")) return null;
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.inert) return null;
    }
    try {
      if (win.parent !== win && win.frameElement?.hasAttribute("data-core-navigation-frame")
        && win.parent.document.documentElement.dataset.coreAccess !== "manager") return null;
    } catch { return null; }
    const runtime = getRuntime();
    const user = runtime?.authClient?.currentUser;
    if (!user?.uid || typeof runtime.httpsCallable !== "function") return null;
    const host = navigationHost(win);
    if (host && (host.session?.role !== "manager" || host.session.mustChangePassword === true
      || host.uid !== user.uid || host.runtime !== runtime)) return null;
    return { runtime, user, uid: user.uid, role: doc.documentElement.dataset.coreAccess, hostSession: host?.session };
  }
  const sameSession = (a, b) => Boolean(a && b && a.runtime === b.runtime && a.user === b.user
    && a.uid === b.uid && a.role === b.role && a.hostSession === b.hostSession);
  function setBusy(value) {
    busy = value;
    button.disabled = value;
    form.setAttribute("aria-busy", String(value));
  }
  function clear() {
    generation++;
    result.replaceChildren();
    result.hidden = true;
    delete result.dataset.status;
    status.textContent = "";
    input.removeAttribute("aria-invalid");
    setBusy(false);
  }
  function reconcile() {
    if (disposed) return;
    if (!root.isConnected) { dispose(); return; }
    const next = session();
    if (sameSession(active, next) || (!active && !next)) return;
    const previousRuntime = active?.runtime;
    clear();
    input.value = "";
    active = next;
    root.hidden = !active;
    if (previousRuntime !== active?.runtime) {
      unsubscribe?.(); unsubscribe = undefined;
      const runtime = active?.runtime;
      if (runtime?.auth?.onAuthStateChanged) unsubscribe = runtime.auth.onAuthStateChanged(runtime.authClient, reconcile);
    }
    if (active && prefill) {
      input.value = prefill;
      prefill = null;
      form.requestSubmit();
    }
  }
  function inputChanged() { prefill = null; clear(); }
  async function submit(event) {
    event.preventDefault();
    reconcile();
    if (busy || !active) return;
    clear();
    const id = input.value;
    if (!validHoldingOperationId(id)) {
      input.setAttribute("aria-invalid", "true");
      status.textContent = "공백이나 경로 없이 정확한 홀딩 작업 ID 1개를 입력하세요.";
      input.focus();
      return;
    }
    const requestSession = session();
    if (!sameSession(active, requestSession)) { reconcile(); return; }
    const ticket = generation;
    const stillCurrent = () => ticket === generation && input.value === id && sameSession(requestSession, session());
    setBusy(true);
    status.textContent = "조회 중";
    try {
      const runtime = requestSession.runtime;
      const callable = runtime.httpsCallable(runtime.functionsClient, "getMemberOperationProgress");
      const response = await callable({ kind: "holding", operationId: id });
      if (!stillCurrent()) return;
      const view = memberOperationProgressView(response?.data, id);
      renderResult(result, view);
      status.textContent = `조회 완료 · ${view.label}`;
    } catch {
      if (stillCurrent()) status.textContent = "기록을 확인하지 못했습니다. 권한·연결을 확인한 뒤 다시 조회하세요.";
    } finally {
      if (ticket === generation) {
        if (!stillCurrent()) { clear(); reconcile(); }
        else setBusy(false);
      }
    }
  }
  function signedOut() {
    prefill = null;
    clear(); input.value = ""; active = null; root.hidden = true;
    unsubscribe?.(); unsubscribe = undefined;
  }
  function navigation() { prefill = null; clear(); input.value = ""; reconcile(); }
  function navClick(event) {
    const link = event.target.closest?.("a[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const target = new URL(link.href, win.location.href);
    if (target.pathname !== win.location.pathname || target.search !== win.location.search) navigation();
  }
  const observer = new win.MutationObserver(reconcile);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["data-core-access", "hidden", "inert", "class"] });
  let parentDoc;
  try { if (win.parent !== win && win.frameElement?.hasAttribute("data-core-navigation-frame")) parentDoc = win.parent.document; } catch { /* Cross-origin hosts cannot share a session. */ }
  if (parentDoc) observer.observe(parentDoc.documentElement, { attributes: true, attributeFilter: ["data-core-access"], childList: true, subtree: true });
  form.addEventListener("submit", submit);
  input.addEventListener("input", inputChanged);
  input.addEventListener("change", inputChanged);
  doc.addEventListener("click", navClick);
  doc.addEventListener("core-instructor-signed-out", signedOut);
  parentDoc?.addEventListener("click", navClick);
  parentDoc?.addEventListener("core-instructor-signed-out", signedOut);
  if (parentDoc) win.parent.addEventListener("popstate", navigation);
  win.addEventListener("popstate", navigation);
  win.addEventListener("pagehide", dispose);
  function dispose() {
    if (disposed) return;
    disposed = true;
    signedOut();
    observer.disconnect();
    form.removeEventListener("submit", submit);
    input.removeEventListener("input", inputChanged);
    input.removeEventListener("change", inputChanged);
    doc.removeEventListener("click", navClick);
    doc.removeEventListener("core-instructor-signed-out", signedOut);
    parentDoc?.removeEventListener("click", navClick);
    parentDoc?.removeEventListener("core-instructor-signed-out", signedOut);
    if (parentDoc) win.parent.removeEventListener("popstate", navigation);
    win.removeEventListener("popstate", navigation);
    win.removeEventListener("pagehide", dispose);
    delete root.dataset.operationProgressMounted;
    mountedRoots.delete(root);
  }
  root.hidden = true;
  reconcile();
  return dispose;
}

if (typeof document !== "undefined") {
  let root, dispose;
  const mount = () => {
    const next = document.querySelector("[data-member-operation-progress]");
    if (root === next) return;
    dispose?.(); root = next;
    dispose = mountMemberOperationProgress(root);
  };
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener("pagehide", () => { observer.disconnect(); dispose?.(); }, { once: true });
  mount();
}
