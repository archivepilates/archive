import { uiIcon } from "./ui-icons.js";

const mountedHosts = new WeakMap();
const statusLabels = Object.freeze({
  pending: "확인 대기", captured: "접수됨", queued: "처리 대기", processing: "처리 중",
  review_required: "검토 필요", manual_review: "검토 필요", rejected: "제외됨",
  failed: "처리 실패", paid: "적립 완료 기록", completed: "완료 기록",
  verification_required: "StudioMate 원본 확인 대기", claimed: "처리 접수", dispatching: "처리 중",
  source_check_required: "StudioMate 원본 확인 필요", source_check_pending: "StudioMate 원본 확인 대기",
  native_verification_required: "StudioMate 원본 확인 필요",
  verified: "적립 확인 기록", review: "검토 필요", held: "보류", duplicate: "기존 기록",
  disabled: "자동 적립 준비 중", unknown: "확인 필요",
});
const reasonLabels = Object.freeze({
  policy_not_confirmed: "정책 확인 대기", disabled: "자동 적립 준비 중",
  duplicate: "기존 기록", member_not_found: "회원 확인 필요",
  referrer_not_found: "추천인 확인 필요", ambiguous_identity: "본인 확인 필요",
  payment_pending: "결제 확인 대기", source_check_required: "원본 확인 필요",
  native_source_verification_required: "원본 확인 필요", native_verification_required: "원본 확인 필요",
  policy_confirmation_required: "정책 확인 대기", policy_mismatch: "정책 대조 필요",
  not_started: "시작 전", already_claimed: "기존 처리 기록", point_write_claimed: "처리 접수",
  point_verified: "적립 확인 기록", point_review: "처리 결과 검토 필요",
  point_dispatching: "처리 중", native_source_required: "원본 확인 필요",
  native_source_stale: "원본 재확인 필요", member_identity_unverified: "회원 확인 필요",
  attribution_identity_mismatch: "추천 관계 확인 필요", self_referral: "본인 추천 제외",
  new_membership_unverified: "신규등록 확인 필요", excluded_member: "대상 제외",
  member_classification_unverified: "회원등급 확인 필요",
  qualifying_purchase_unverified: "구매 확인 필요", excluded_purchase: "구매 대상 제외",
  purchase_time_unverified: "구매 시각 확인 필요",
  fresh_complete_excel_required: "최신 Excel 원본 확인 필요",
});
const sourceCheckStatuses = new Set([
  "verification_required", "source_check_required", "source_check_pending", "native_verification_required",
]);
const label = (labels, value) => Object.hasOwn(labels, value) ? labels[value] : "확인 필요";
const normalizePhone = (value) => value.replace(/[\s-]/g, "");
const fieldNames = ["newMemberName", "newMemberPhone", "referrerName", "referrerPhone"];

function validDashboard(data) {
  return data && typeof data.enabled === "boolean" && typeof data.policyConfirmed === "boolean"
    && typeof data.complete === "boolean" && Array.isArray(data.requests)
    && data.requests.every(row => row && typeof row.id === "string" && row.id.length > 0
      && typeof row.newMemberName === "string" && typeof row.referrerName === "string"
      && typeof row.status === "string");
}

function updatedTime(value) {
  // Only display validated timestamps, never arbitrary response text.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export async function mountStudioMateReferralIntake(runtime, host) {
  if (!host) return;
  if (mountedHosts.has(host)) {
    const dispose = mountedHosts.get(host);
    await dispose.refresh();
    return dispose;
  }
  if (typeof runtime?.httpsCallable !== "function" || !runtime.functionsClient) return;

  const doc = host.ownerDocument;
  host.classList.add("sm-referral-intake");
  host.innerHTML = `
    <details class="sm-referral-details">
      <summary>명지점 추천 포인트 ${uiIcon("chevron-down", "ui-icon sm-referral-chevron")}</summary>
      <form class="sm-referral-form" autocomplete="off">
        <div class="sm-referral-fields">
          <label>신규회원 이름<input name="newMemberName" type="text" required maxlength="60" autocomplete="off" /></label>
          <label>신규회원 전화번호<input name="newMemberPhone" type="tel" required maxlength="24" inputmode="tel" autocomplete="off" /></label>
          <label>추천인 이름<input name="referrerName" type="text" required maxlength="60" autocomplete="off" /></label>
          <label>추천인 전화번호<input name="referrerPhone" type="tel" required maxlength="24" inputmode="tel" autocomplete="off" /></label>
        </div>
        <div class="sm-referral-actions">
          <button class="sm-referral-save" type="submit" disabled>${uiIcon("clipboard-check")}<span>추천정보 저장</span></button>
          <button class="sm-referral-refresh" type="button" aria-label="추천 기록 새로고침" title="추천 기록 새로고침">${uiIcon("refresh-cw")}</button>
        </div>
      </form>
      <p class="sm-referral-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <p class="sm-referral-dashboard-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <ul class="sm-referral-requests" aria-label="추천 접수 기록"></ul>
    </details>`;
  host.hidden = false;
  const form = host.querySelector("form");
  const save = host.querySelector(".sm-referral-save");
  const refresh = host.querySelector(".sm-referral-refresh");
  const status = host.querySelector(".sm-referral-status");
  const dashboardStatus = host.querySelector(".sm-referral-dashboard-status");
  const list = host.querySelector(".sm-referral-requests");
  const fields = fieldNames.map(name => form.elements.namedItem(name));
  const win = doc.defaultView;
  const observeAuth = typeof runtime.auth?.onAuthStateChanged === "function" && Boolean(runtime.authClient);
  const mountedUid = runtime.authClient?.currentUser?.uid;
  let unsubscribeAuth;
  let disposed = false, saving = false, reading = false, uncertain = false;
  let dashboard = null, savedPayload = null;

  const payload = () => Object.fromEntries(fields.map(input => [input.name,
    input.name.endsWith("Phone") ? normalizePhone(input.value) : input.value.trim()]));
  const sameAsSaved = () => savedPayload && fieldNames.every(name => savedPayload[name] === payload()[name]);

  function activeSession() {
    if (observeAuth && (!mountedUid || runtime.authClient.currentUser?.uid !== mountedUid)) dispose();
    return !disposed;
  }

  function updateControls() {
    // Attribution receipts are independent of automatic payout activation and policy state.
    save.disabled = disposed || saving || reading || uncertain || !dashboard || Boolean(sameAsSaved());
    refresh.disabled = disposed || saving || reading;
    fields.forEach(input => { input.readOnly = saving || uncertain; });
    form.setAttribute("aria-busy", String(saving));
    list.setAttribute("aria-busy", String(reading));
  }

  function text(tag, value, className) {
    const node = doc.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function renderRequests() {
    const fragment = doc.createDocumentFragment();
    for (const row of dashboard.requests) {
      const item = doc.createElement("li");
      const masked = value => typeof value === "string" && /^\d{4}$/.test(value) ? `***-${value}` : "끝자리 미확인";
      item.append(text("span", `신규회원 ${row.newMemberName} · ${masked(row.newMemberPhoneLast4)}`),
        text("span", `추천인 ${row.referrerName} · ${masked(row.referrerPhoneLast4)}`),
        text("strong", label(statusLabels, row.status), "sm-referral-request-status"));
      if (row.reason) item.append(text("span", label(reasonLabels, row.reason), "sm-referral-meta"));
      const time = updatedTime(row.updatedAt);
      if (time) item.append(text("span", `${time} KST`, "sm-referral-meta"));
      fragment.append(item);
    }
    list.replaceChildren(fragment);
  }

  async function readDashboard() {
    if (!activeSession() || saving || reading) return;
    reading = true;
    dashboard = null;
    dashboardStatus.textContent = "추천 기록 확인 중";
    updateControls();
    try {
      const response = await runtime.httpsCallable(runtime.functionsClient, "getStudioMateReferralDashboard")({});
      if (!activeSession()) return;
      if (!validDashboard(response?.data)) throw new Error("invalid-referral-dashboard");
      dashboard = response.data;
      renderRequests();
      const state = !dashboard.enabled || !dashboard.policyConfirmed ? "자동 적립 준비 중"
        : !dashboard.complete ? "일부 기록 · 전체 확인 필요"
          : dashboard.requests.length ? "추천 기록 확인됨" : "추천 기록 없음";
      dashboardStatus.textContent = state;
      if (uncertain) status.textContent = "저장 결과 미확인 · 운영 확인 필요";
    } catch {
      if (activeSession()) {
        list.replaceChildren();
        dashboardStatus.textContent = "추천 기록 조회 실패";
      }
    } finally {
      reading = false;
      if (!disposed) updateControls();
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!activeSession() || save.disabled) return;
    const data = payload();
    for (const input of fields) {
      const valid = input.name.endsWith("Phone") ? /^010\d{8}$/.test(data[input.name])
        : data[input.name].length > 0 && data[input.name].length <= 60 && !/[\r\n<>]/.test(data[input.name]);
      input.setCustomValidity(valid ? "" : input.name.endsWith("Phone") ? "전체 전화번호를 확인해 주세요." : "이름을 입력해 주세요.");
    }
    if (data.newMemberPhone === data.referrerPhone) {
      form.elements.namedItem("referrerPhone").setCustomValidity("신규회원과 추천인 전화번호가 같습니다.");
    }
    if (!form.reportValidity()) return;
    saving = true;
    status.textContent = "추천정보 저장 중";
    updateControls();
    try {
      const response = await runtime.httpsCallable(runtime.functionsClient, "operatorCaptureStudioMateReferral")(data);
      if (!activeSession()) return;
      const result = response?.data;
      if (!result || typeof result.requestId !== "string" || !result.requestId.trim()
        || typeof result.status !== "string" || !result.status.trim() || typeof result.duplicate !== "boolean") {
        throw new Error("uncertain-referral-result");
      }
      savedPayload = data;
      const receipt = result.duplicate ? "기존 추천정보 확인됨" : "추천정보 저장됨";
      status.textContent = sourceCheckStatuses.has(result.status) ? `${receipt} · ${label(statusLabels, result.status)}` : receipt;
    } catch {
      if (activeSession()) {
        // A transport error cannot prove non-dispatch. Masked dashboard rows cannot resolve identity safely.
        uncertain = true;
        status.textContent = "저장 결과 미확인 · 목록 확인 필요";
      }
    } finally {
      saving = false;
      if (!disposed) updateControls();
    }
    if (!disposed && !uncertain) await readDashboard();
  }

  function inputChanged() {
    fields.forEach(input => input.setCustomValidity(""));
    if (!uncertain && !saving) status.textContent = "";
    updateControls();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    const unsubscribe = unsubscribeAuth;
    unsubscribeAuth = undefined;
    try { unsubscribe?.(); } catch { /* Continue clearing fields if the auth SDK is already torn down. */ }
    win?.removeEventListener("pagehide", dispose);
    form.removeEventListener("submit", submit);
    form.removeEventListener("input", inputChanged);
    refresh.removeEventListener("click", readDashboard);
    fields.forEach(input => { input.value = ""; });
    savedPayload = null;
    dashboard = null;
    host.replaceChildren();
    host.hidden = true;
    mountedHosts.delete(host);
  }
  dispose.refresh = readDashboard;
  mountedHosts.set(host, dispose);
  form.addEventListener("submit", submit);
  form.addEventListener("input", inputChanged);
  refresh.addEventListener("click", readDashboard);
  win?.addEventListener("pagehide", dispose, { once: true });
  if (observeAuth) {
    try {
      const unsubscribe = runtime.auth.onAuthStateChanged(runtime.authClient, user => {
        if (!user || user.uid !== mountedUid) dispose();
      }, dispose);
      if (typeof unsubscribe === "function") {
        if (disposed) unsubscribe();
        else unsubscribeAuth = unsubscribe;
      }
    } catch { dispose(); }
  }
  updateControls();
  await readDashboard();
  return dispose;
}
