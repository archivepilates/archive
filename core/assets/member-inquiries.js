import { initCoreNavigationDocument, finishCoreNavigation, sharedNavigationRuntime } from "./core-navigation.js";
import { uiIcon } from "./ui-icons.js";
initCoreNavigationDocument();
const $ = id => document.getElementById(id);
const labels = { received: "새 접수", in_review: "직원 검토 중", awaiting_approval: "관리자 승인 대기", approved: "승인 · 수동 처리 대기", needs_information: "추가 확인 필요", rejected: "반려", completed: "처리 완료 기록" };
const actions = { received: "회원 접수", claim: "담당 확인", assign: "담당자 지정", review: "처리안 검토 요청", approve: "관리자 승인", reject: "관리자 반려", needs_information: "추가 확인 요청", record_execution: "작업·확인 기록", record_notification: "수동 연락 결과 기록", complete: "최종 완료 기록" };
const reviewFields = ["policy-fit", "resolution-kind", "plan", "member-reply", "internal-note"];
const draftFields = [...reviewFields, "assignee", "assignment-reason", "decision-reason", "execution-note", "execution-evidence", "notification-outcome", "notification-channel", "notification-note", "notification-evidence", "completion-note", "completion-evidence"];
let runtime, access, current, rows = [], cursor, generation = 0, schema, pending = false, guidance = null, loadedForm = {}, initialReview = {}, preview = null, contextRequest = 0, contextLoading = false;
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, "0")).join("");
function message(value) { $("global-message").textContent = value; }
function node(tag, value) { const element = document.createElement(tag); element.textContent = value ?? ""; return element; }
function localTime(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST" : "확인 불가"; }
function formSnapshot() { return Object.fromEntries(draftFields.map(id => [id, $(id).value])); }
function dirtyFields() { return current ? draftFields.filter(id => $(id).value !== loadedForm[id]) : []; }
function confirmDiscard() { return !dirtyFields().length || window.confirm("저장하지 않은 입력이 있습니다. 입력을 버리고 다시 조회할까요?"); }
function canEdit() { return Boolean(current && access && current.status !== "completed" && (access.manager || current.assignedStaffId === access.staffId && !current.assignmentIssue)); }
function approvedScope() { return canEdit() && current.status === "approved" && Boolean(current.reviewHash); }
function matchingRecord(record) { return Boolean(current?.reviewHash && record?.reviewHash === current.reviewHash); }
function clearPrivate() {
  generation++; contextRequest++; contextLoading = false; access = current = null; cursor = null; rows = []; preview = null; loadedForm = initialReview = {};
  $("workspace").hidden = true; $("request-detail").hidden = true; $("logout").hidden = true;
  for (const id of ["request-list", "member-request", "event-list", "member-context", "guidance-rules"]) $(id).replaceChildren();
  for (const id of ["preview-plan", "preview-reply", "action-message", "coverage", "work-counts", "assignment-warning", "execution-state", "notification-state", "completion-state", "review-hash"]) $(id).textContent = "";
  draftFields.forEach(id => $(id).value = ""); $("guidance-preview").hidden = true;
}
async function call(data) {
  if (!runtime?.authClient.currentUser) throw new Error("로그인이 필요합니다.");
  let result;
  try { result = await runtime.httpsCallable(runtime.functionsClient, "memberInquiryStaff")(data); }
  catch (error) {
    if (["functions/permission-denied", "functions/unauthenticated", "auth/user-token-expired", "auth/id-token-revoked"].includes(error.code)) clearPrivate();
    throw error;
  }
  if (result.data?.ok !== true) throw new Error("문의 결과를 확인하지 못했습니다.");
  return result.data;
}
function elapsedHours(row) { const at = Date.parse(row.createdAt); return Number.isFinite(at) ? Math.max(0, (Date.now() - at) / 3600000) : null; }
function ageLabel(row) { const hours = elapsedHours(row); return hours === null ? "접수시각 확인 필요" : `접수 후 ${hours < 1 ? Math.floor(hours * 60) + "분" : Math.floor(hours) + "시간"} 경과`; }
function delayThreshold() { const value = access?.responseDelayHours; return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function workMatches(row, filter) {
  if (filter === "all") return true;
  if (filter === "awaiting_approval") return row.status === "awaiting_approval";
  if (["completed", "rejected"].includes(row.status)) return false;
  if (filter === "unassigned") return !row.assignedStaffId;
  if (filter === "reassignment") return Boolean(row.assignmentIssue);
  if (filter === "delayed") return row.contactRecorded !== true && delayThreshold() !== null && elapsedHours(row) !== null && elapsedHours(row) >= delayThreshold();
  return false;
}
function assignmentLabel(row) { return row.assignmentIssue === "not_current_staff" ? "재직 담당자 재배정 필요" : row.assignmentIssue ? "담당자 상태 확인 필요" : ""; }
function renderList() {
  const threshold = delayThreshold(), select = $("work-filter");
  let delayed = select.querySelector('option[value="delayed"]');
  if (threshold !== null && !delayed) { delayed = node("option", "지연"); delayed.value = "delayed"; select.append(delayed); }
  if (threshold === null && delayed) { if (select.value === "delayed") select.value = "all"; delayed.remove(); }
  const workNames = { all: "전체", unassigned: "미배정", awaiting_approval: "승인 대기", reassignment: "재배정 확인", delayed: `지연 (${threshold}시간 이상)` };
  Array.from(select.options).forEach(option => { option.textContent = `${workNames[option.value]} ${rows.filter(row => workMatches(row, option.value)).length}건`; });
  const filter = $("status-filter").value, visible = rows.filter(row => (filter === "all" || row.status === filter) && workMatches(row, select.value));
  const direction = $("order-filter").value === "newest" ? -1 : 1;
  visible.sort((a, b) => direction * ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) || a.id.localeCompare(b.id));
  $("work-counts").textContent = `현재 불러온 ${rows.length}건 기준 · 조건 일치 ${visible.length}건 · 미배정·재배정·지연은 완료·반려 제외${threshold === null ? " · 지연 기준 미설정" : ` · 지연 기준: 접수 후 ${threshold}시간 · 수동 연락·연락 불필요 기록이 있는 문의는 지연 제외 (전달 확인 아님)`}`;
  $("request-list").replaceChildren();
  if (!visible.length) $("request-list").append(node("p", rows.length ? "선택한 상태의 문의가 없습니다. 다른 상태 또는 이전 접수도 확인해 주세요." : "조회한 범위에 문의가 없습니다."));
  visible.forEach(row => {
    const button = node("button", ""); button.type = "button"; button.className = "queue-item" + (current?.id === row.id ? " selected" : "");
    button.setAttribute("aria-pressed", String(current?.id === row.id));
    button.append(node("strong", schema.categories[row.category]?.title || "문의"), node("span", `${row.memberName} · ${row.maskedPhone}`), node("small", `${labels[row.status] || row.status} / ${row.assignedStaffName || "미배정"}`), node("small", `${localTime(row.createdAt)} · ${ageLabel(row)}`));
    if (row.assignmentIssue) { const warning = node("small", assignmentLabel(row)); warning.className = "attention"; button.append(warning); }
    button.addEventListener("click", () => open(row.id)); $("request-list").append(button);
  });
  $("load-more").hidden = !cursor;
}
async function list(more = false) {
  const ticket = generation; message("접수 목록을 조회하고 있습니다.");
  try {
    const result = await call({ action: "list", ...(more && cursor ? { cursor } : {}) });
    if (ticket !== generation) return;
    rows = more ? [...rows, ...result.rows.filter(row => !rows.some(old => old.id === row.id))] : result.rows;
    cursor = result.nextCursor; $("coverage").textContent = (result.coverage?.note || "접수 목록 조회") + ` · 현재 ${rows.length}건 불러옴${cursor ? " · 이전 접수 더 있음" : ""}`;
    renderList(); message(""); return true;
  } catch (error) { if (ticket === generation) message(error.message || "접수 목록을 조회하지 못했습니다."); return false; }
}
function applicableRules(row) {
  return (guidance?.rules || []).filter(rule => rule.category === row.category && Object.entries(rule.when || {}).every(([question, expected]) => {
    const answer = row.answers?.[question]; return Array.isArray(answer) ? answer.includes(expected) : answer === expected;
  }));
}
function renderGuidance(row) {
  preview = null; $("guidance-preview").hidden = true; $("preview-plan").textContent = $("preview-reply").textContent = "";
  $("guidance-version").textContent = guidance ? `규정 자료 버전 ${guidance.version || "확인 필요"}` : "규정 자료를 불러오지 못했습니다. 원문 확인이 필요합니다.";
  const rules = applicableRules(row); $("guidance-rules").replaceChildren();
  rules.forEach(rule => {
    const item = node("li", ""); item.append(node("strong", rule.title), node("p", rule.text));
    const source = guidance.sources?.[rule.sourceId];
    if (source) {
      try {
        const url = new URL(source.url);
        if (/^https:\/\/app\.notion\.com\/p\/[a-f0-9]{32}$/.test(source.url)) { const link = node("a", `${source.title} · 원문 수정 ${source.lastEditedAt || "확인 필요"}`); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; item.append(link); }
      } catch { /* Missing source URLs remain unlinked. */ }
    }
    $("guidance-rules").append(item);
  });
  if (!rules.length) $("guidance-rules").append(node("li", "선택 내용에 맞는 확정 규정을 확인하지 못했습니다. 담당자 확인이 필요합니다."));
}
function buildPreview() {
  if (!current || pending) return;
  const rules = applicableRules(current), texts = rules.map(rule => `${rule.title}: ${rule.text}`);
  const subject = schema.categories[current.category]?.title || "문의";
  preview = {
    plan: [`${subject} 검토`, ...texts, "회원 본인과 현재 원본·잔여 조건을 확인하고, 실제 처리 범위를 정해 관리자 승인을 요청합니다. 규정이 불명확하거나 예외인 경우 관리자에게 확인합니다."].join("\n"),
    reply: [`문의하신 ${subject} 관련 안내드립니다.`, ...rules.map(rule => rule.text), "접수하신 내용은 담당자가 현재 조건을 확인한 후 안내드릴게요. 이 안내만으로 예약·수강권 변경이 완료되지는 않습니다."].join("\n\n"),
  };
  if (!texts.length) { preview.plan = `${subject}: 적용 규정과 가능 여부를 관리자에게 확인합니다.`; preview.reply = "문의하신 내용의 적용 조건은 담당자 확인 후 안내드릴게요. 접수만으로 변경이나 승인이 완료되지는 않습니다."; }
  $("preview-plan").textContent = preview.plan; $("preview-reply").textContent = preview.reply; $("guidance-preview").hidden = false; applyEditScope();
}
function applyPreview() {
  if (!preview || !canEdit() || pending) return;
  if (preview.plan.length > $("plan").maxLength || preview.reply.length > $("member-reply").maxLength) { $("action-message").textContent = "초안이 입력 한도를 넘습니다. 필요한 규정만 확인해 직접 작성해 주세요."; return; }
  if ((current.review || $("plan").value.trim() || $("member-reply").value.trim() || dirtyFields().length) && !window.confirm("저장된 처리안 또는 작성 중인 내용이 있습니다. 처리안·답변안 입력란을 이 초안으로 바꿀까요? 아직 저장되지는 않습니다.")) return;
  $("plan").value = preview.plan; $("member-reply").value = preview.reply;
  $("action-message").textContent = "초안을 입력란에만 적용했습니다. 규정 판단과 내용을 확인한 뒤 검토를 요청해 주세요. 저장·승인·발송은 실행하지 않았습니다.";
  applyEditScope(); $("plan").focus();
}
function contextCount(value) { return typeof value === "number" && Number.isFinite(value) ? String(value) : "확인 불가"; }
function renderContext(context) {
  const target = $("member-context"); target.replaceChildren();
  const states = { unique_stored_match: "저장자료 1건 일치 · 본인 확인 전", not_found: "일치 저장자료 없음", ambiguous: "저장자료 중복·모호 · 확인 필요", incomplete: "저장자료 불충분 · 확인 필요" };
  target.append(node("p", states[context.status] || "저장자료 상태 확인 필요"), node("p", `출처: ${context.source || "확인 불가"} · 조회시각: ${localTime(context.observedAt)}`), node("p", context.note || "실제 처리 전에 현재 원본을 확인해 주세요."));
  if (context.status !== "unique_stored_match") return;
  const profile = context.profile;
  if (profile) {
    const summary = node("dl", "");
    for (const [key, value] of [["저장 회원", `${profile.name || "확인 불가"} / ${profile.maskedPhone || "확인 불가"}`], ["회원 ID", profile.memberId || "확인 불가"], ["등급", profile.memberGrade || "확인 불가"], ["동기화 시각", localTime(profile.syncedAt)]]) summary.append(node("dt", key), node("dd", value));
    target.append(summary);
  }
  for (const [key, title] of [["tickets", "수강권"], ["holds", "홀딩"], ["bookings", "예약"]]) {
    const entries = context[key]; target.append(node("h4", `${title} · 반환된 저장자료 ${Array.isArray(entries) ? entries.length + "건" : "확인 불가"}`));
    if (!Array.isArray(entries) || !entries.length) { target.append(node("p", "표시할 저장자료가 없습니다. 실제 미보유·미예약을 뜻하지 않습니다.")); continue; }
    const items = node("ul", "");
    entries.forEach(entry => {
      const text = key === "bookings" ? `${entry.lectureDate || "날짜 미확인"} ${entry.startTime || "시간 미확인"} / ${entry.title || "수업명 미확인"} / ${entry.staffName || "강사 미확인"} / ${entry.status || "상태 미확인"}` : `${entry.name || "수강권명 미확인"} / 잔여 ${contextCount(entry.remainingCount)} / 예약 가능 ${contextCount(entry.usableCount)} / ${entry.status || "상태 미확인"} / 시작 ${localTime(entry.availableFrom)} / 만료 ${localTime(entry.expiresAt)}`;
      items.append(node("li", text));
    }); target.append(items);
  }
  const coverage = context.coverage || {};
  const parts = Object.entries(coverage).filter(([key, value]) => key.endsWith("Limited") && value === true).map(([key]) => key === "profilesLimited" ? "회원 검색 범위 제한" : key === "bookingsLimited" ? "예약 검색 범위 제한" : "조회 범위 제한");
  target.append(node("p", ["반환된 일부 저장자료 기준이며 전체 보유·예약 건수가 아닙니다.", ...parts].join(" · ")));
}
async function loadContext() {
  if (!current || pending || contextLoading) return;
  const ticket = generation, id = current.id, request = ++contextRequest; contextLoading = true; applyEditScope();
  $("member-context").replaceChildren(node("p", "저장자료를 조회하고 있습니다."));
  try { const result = await call({ action: "context", id }); if (ticket === generation && request === contextRequest && current?.id === id) renderContext(result.context); }
  catch (error) { if (ticket === generation && request === contextRequest) $("member-context").replaceChildren(node("p", error.message || "저장자료를 조회하지 못했습니다.")); }
  finally { if (request === contextRequest) { contextLoading = false; applyEditScope(); } }
}
function showRow(row, events) {
  current = row; contextRequest++; contextLoading = false; $("member-context").replaceChildren();
  const index = rows.findIndex(item => item.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  $("request-detail").hidden = false; $("detail-title").textContent = schema.categories[row.category]?.title || "회원 문의";
  $("detail-status").textContent = labels[row.status] || row.status;
  $("member-request").replaceChildren();
  const item = schema.categories[row.category];
  const answers = (item?.questions || []).filter(q => row.answers[q.id] !== undefined).map(q => `${q.label}: ${Array.isArray(row.answers[q.id]) ? row.answers[q.id].join(", ") : row.answers[q.id]}`).join("\n");
  for (const [key, value] of [["접수번호", row.id], ["회원 입력 정보", `${row.memberName} / ${row.memberPhone}`], ["본인 확인", "확인 전 · 회원이 기입한 정보"], ["선택 내용", answers], ["추가 내용", row.details || "없음"], ["답변 방법", row.contact], ["담당자", row.assignedStaffName || "미배정"], ["담당 상태", assignmentLabel(row) || "별도 확인 사항 없음"], ["접수시각", `${localTime(row.createdAt)} · ${ageLabel(row)}`], ["안내한 규정 버전", row.policyVersion]])
    $("member-request").append(node("dt", key), node("dd", value));
  const fixed = row.category === "fixed" && row.answers.request === "취소·변경 예외 상담" || row.category === "booking" && row.answers.mode === "고정예약" && ["수업 취소", "다른 수업으로 변경"].includes(row.answers.request);
  $("policy-fit").value = row.review?.policyFit || (fixed ? "exception" : "insufficient");
  $("resolution-kind").value = row.review?.resolutionKind || (fixed ? "exception_review" : "guidance");
  $("plan").value = row.review?.plan || ""; $("member-reply").value = row.review?.memberReply || ""; $("internal-note").value = row.review?.internalNote || "";
  for (const id of ["assignment-reason", "decision-reason", "completion-note", "completion-evidence", "execution-note", "execution-evidence", "notification-note", "notification-evidence"]) $(id).value = "";
  $("notification-outcome").value = "manual_contact_recorded"; $("notification-channel").value = "phone"; $("action-message").textContent = "";
  $("assignment").hidden = !access.manager || row.status === "completed";
  const placeholder = node("option", access.assignees.length ? "담당자를 선택해 주세요" : "선택 가능한 재직 직원이 없습니다"); placeholder.value = "";
  $("assignee").replaceChildren(placeholder, ...access.assignees.map(person => { const option = node("option", person.name); option.value = person.staffId; return option; }));
  $("assignee").value = access.assignees.some(person => person.staffId === row.assignedStaffId) ? row.assignedStaffId : "";
  $("assignment-warning").textContent = [row.assignedStaffName ? `기존 담당: ${row.assignedStaffName}` : "현재 미배정", assignmentLabel(row), row.handoffReason ? `최근 배정 사유: ${row.handoffReason}` : ""].filter(Boolean).join(" · ");
  $("decision-panel").hidden = !access.manager || row.status !== "awaiting_approval";
  $("review-hash").textContent = row.reviewHash ? `현재 처리안: ${row.reviewHash.slice(0, 16)} · 수정번호 ${row.revision}` : "";
  renderGuidance(row); renderWorkRecords(row); loadedForm = formSnapshot(); initialReview = Object.fromEntries(reviewFields.map(id => [id, $(id).value])); applyEditScope();
  $("event-list").replaceChildren(...(events || []).map(event => {
    const item = node("li", `${localTime(event.at)} / ${actions[event.action] || "처리 기록"} / ${event.actorName || "회원"}${event.decision?.reason ? " / " + event.decision.reason : ""}`);
    if (event.assignment) item.append(node("p", `${event.assignment.fromName || "미배정"} → ${event.assignment.toName || "이름 확인 필요"}${event.assignment.reason ? " / " + event.assignment.reason : ""}`));
    return item;
  }));
  renderList(); $("detail-title").focus();
}
function recordSummary(record, kind) {
  if (!record) return "아직 기록되지 않았습니다.";
  const note = record.note ?? record[`${kind}Note`], evidence = record.evidence ?? record[`${kind}Evidence`];
  const parts = [matchingRecord(record) ? "현재 승인 처리안에 연결된 기록" : "이전 처리안 기록 · 현재 승인에 다시 확인 필요", note, evidence ? `근거: ${evidence}` : ""];
  if (kind === "notification") {
    const outcome = record.outcome ?? record.notificationOutcome, channel = record.channel ?? record.notificationChannel;
    parts.push(outcome === "not_required" ? "연락 불필요 기록" : outcome === "manual_contact_recorded" ? "직원 수동 연락 기록 · 전달 확인 아님" : "연락 결과 확인 필요");
    if (channel) parts.push(({ phone: "전화", kakao: "카카오톡", sms: "문자", onsite: "현장", none: "없음" })[channel] || "연락 방법 확인 필요");
  }
  return parts.filter(Boolean).join(" / ");
}
function renderWorkRecords(row) {
  $("execution-state").textContent = recordSummary(row.execution, "execution");
  $("notification-state").textContent = recordSummary(row.notification, "notification");
  // Keep saved evidence readable after completion without reopening any mutation controls.
  for (const [id, record] of [["execution-panel", row.execution], ["notification-panel", row.notification]]) $(id).hidden = row.status !== "approved" && !record;
  $("execution-form").hidden = $("notification-form").hidden = !approvedScope();
}
function applyEditScope() {
  if (!current || !access) return;
  const editable = canEdit(), approved = approvedScope();
  $("claim").hidden = Boolean(current.assignedStaffId) || current.status === "completed";
  $("edit-scope").textContent = editable ? "담당 문의를 검토하고 관리자에게 처리안 승인을 요청할 수 있습니다." : current.status === "completed" ? "완료 기록은 열람만 가능합니다." : current.assignedStaffId ? "전체 스태프가 열람할 수 있으며, 검토·처리는 담당자와 관리자가 진행합니다." : "미배정 문의입니다. 내 담당으로 접수한 뒤 검토해 주세요.";
  $("review-form").querySelectorAll("input,textarea,select,button").forEach(el => el.disabled = pending || !editable);
  $("execution-form").hidden = $("notification-form").hidden = !approved;
  for (const id of ["execution-form", "notification-form"]) $(id).querySelectorAll("input,textarea,select,button").forEach(el => el.disabled = pending || !approved);
  $("notification-channel").disabled = pending || !approved || $("notification-outcome").value === "not_required";
  $("completion-panel").hidden = !approved;
  const completeReady = approved && matchingRecord(current.execution) && matchingRecord(current.notification);
  $("complete").disabled = pending || !completeReady || formChanged();
  $("completion-state").textContent = completeReady ? "현재 승인 처리안의 작업·연락 기록이 모두 있습니다. 실제 확인한 최종 결과를 기록해 주세요." : "현재 승인 처리안과 일치하는 작업 기록과 수동 연락 결과(또는 연락 불필요) 기록이 모두 필요합니다.";
  $("load-context").disabled = pending || contextLoading;
  $("preview-guidance").disabled = pending;
  $("apply-guidance").disabled = pending || !editable || !preview;
  $("assignee").disabled = pending || !access.assignees.length;
  const reassignment = Boolean(current.assignedStaffId && $("assignee").value && current.assignedStaffId !== $("assignee").value);
  $("assignment-reason").required = reassignment; $("assignment-reason").disabled = pending;
  $("assignment-required").textContent = reassignment ? "· 재배정 시 필수" : "· 선택";
  $("assign").disabled = pending || !access.manager || !$("assignee").value || current.assignedStaffId === $("assignee").value || reassignment && !$("assignment-reason").value.trim();
  $("decision-panel").querySelectorAll("textarea,button").forEach(el => el.disabled = pending || !access.manager || current.status !== "awaiting_approval");
}
async function open(id, discard = false) {
  if (pending) return;
  if (!discard && !confirmDiscard()) return false;
  const ticket = ++generation; message("문의 상세를 조회하고 있습니다."); $("request-detail").hidden = true;
  try {
    const [result, freshAccess] = await Promise.all([call({ action: "get", id }), access.manager ? call({ action: "access" }) : Promise.resolve(access)]);
    if (ticket === generation) { access = freshAccess; showRow(result.row, result.events); message(""); return true; }
  }
  catch (error) { if (ticket === generation) message(error.message || "문의 상세를 조회하지 못했습니다."); return false; }
}
function formChanged() { return Boolean(current && reviewFields.some(id => $(id).value.trim() !== (initialReview[id] || "").trim())); }
async function mutate(action, fields = {}) {
  if (!current || pending) return;
  if (["approve", "reject", "needs_information", "record_execution", "record_notification", "complete"].includes(action) && formChanged()) { $("action-message").textContent = "처리안을 수정했습니다. 먼저 관리자 검토 요청으로 저장해 주세요."; return; }
  if (["record_execution", "record_notification", "complete"].includes(action) && !approvedScope()) return;
  if (action === "complete" && (!matchingRecord(current.execution) || !matchingRecord(current.notification))) { $("action-message").textContent = "현재 승인 처리안의 작업·연락 기록을 먼저 확인해 주세요."; return; }
  if (action === "assign" && current.assignedStaffId && current.assignedStaffId !== fields.assignedStaffId && !fields.assignmentReason?.trim()) { $("action-message").textContent = "재배정 사유를 입력해 주세요."; $("assignment-reason").focus(); return; }
  const submitted = { review: reviewFields, assign: ["assignee", "assignment-reason"], approve: ["decision-reason"], reject: ["decision-reason"], needs_information: ["decision-reason"], record_execution: ["execution-note", "execution-evidence"], record_notification: ["notification-outcome", "notification-channel", "notification-note", "notification-evidence"], complete: ["completion-note", "completion-evidence"] }[action] || [];
  if (dirtyFields().some(id => !submitted.includes(id)) && !window.confirm("다른 입력란에 저장하지 않은 내용이 있습니다. 이번 기록 저장 후 다시 조회하면 해당 입력은 사라집니다. 계속할까요?")) return;
  pending = true; const mutationGeneration = generation; const id = current.id; const controls = document.querySelectorAll("#workspace button, #workspace select, #workspace textarea, #workspace input"); controls.forEach(el => el.disabled = true);
  $("action-message").textContent = "처리 결과를 확인하고 있습니다.";
  try {
    await call({ action, id, expectedRevision: current.revision, expectedReviewHash: current.reviewHash, commandId: nonce(), ...fields });
    if (mutationGeneration !== generation) return; pending = false;
    const readback = await open(id, true);
    if (!readback) { if (current?.id === id) $("action-message").textContent = "저장 요청 후 상세 재조회를 확인하지 못했습니다. 반복 저장하지 말고 새로 조회해 주세요."; return; }
    const refreshedGeneration = generation; await list();
    if (generation === refreshedGeneration && current?.id === id) $("action-message").textContent = "저장 결과를 다시 조회해 확인했습니다. 회원 안내 발송이나 예약 변경은 실행하지 않았습니다.";
  } catch (error) { if (mutationGeneration === generation) $("action-message").textContent = `${error.message || "처리 결과를 확인하지 못했습니다."} 같은 작업을 반복하지 말고 ‘새로 조회’로 현재 상태를 확인해 주세요.`; }
  finally { pending = false; controls.forEach(el => el.disabled = false); applyEditScope(); }
}
$("review-form").addEventListener("submit", event => { event.preventDefault(); mutate("review", { policyFit: $("policy-fit").value, resolutionKind: $("resolution-kind").value, plan: $("plan").value, memberReply: $("member-reply").value, internalNote: $("internal-note").value }); });
$("approve").addEventListener("click", () => mutate("approve", { reason: $("decision-reason").value }));
$("reject").addEventListener("click", () => mutate("reject", { reason: $("decision-reason").value }));
$("request-info").addEventListener("click", () => mutate("needs_information", { reason: $("decision-reason").value }));
$("claim").addEventListener("click", () => mutate("claim"));
$("assign").addEventListener("click", () => mutate("assign", { assignedStaffId: $("assignee").value, assignmentReason: $("assignment-reason").value }));
$("assignee").addEventListener("change", applyEditScope);
$("assignment-reason").addEventListener("input", applyEditScope);
$("load-context").addEventListener("click", loadContext);
$("preview-guidance").addEventListener("click", buildPreview);
$("apply-guidance").addEventListener("click", applyPreview);
$("review-form").addEventListener("input", applyEditScope);
$("review-form").addEventListener("change", applyEditScope);
$("execution-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!$("execution-note").value.trim() || !$("execution-evidence").value.trim()) { $("action-message").textContent = "실제 작업·확인 내용과 증빙을 모두 입력해 주세요."; return; }
  mutate("record_execution", { executionNote: $("execution-note").value, executionEvidence: $("execution-evidence").value });
});
$("notification-outcome").addEventListener("change", () => {
  $("notification-channel").value = $("notification-outcome").value === "not_required" ? "none" : "phone";
  applyEditScope();
});
$("notification-form").addEventListener("submit", event => {
  event.preventDefault();
  const outcome = $("notification-outcome").value, channel = $("notification-channel").value;
  if (!$("notification-note").value.trim() || !$("notification-evidence").value.trim() || outcome === "manual_contact_recorded" && channel === "none" || outcome === "not_required" && channel !== "none") { $("action-message").textContent = "연락 결과에 맞는 방법, 내용·사유와 확인 근거를 입력해 주세요."; return; }
  mutate("record_notification", { notificationOutcome: outcome, notificationChannel: channel, notificationNote: $("notification-note").value, notificationEvidence: $("notification-evidence").value });
});
$("complete").addEventListener("click", () => mutate("complete", { completionNote: $("completion-note").value, evidence: $("completion-evidence").value }));
$("status-filter").addEventListener("change", renderList); $("load-more").addEventListener("click", () => list(true));
$("work-filter").addEventListener("change", renderList); $("order-filter").addEventListener("change", renderList);
$("refresh-list").addEventListener("click", async () => { if (pending || !confirmDiscard()) return; const id = current?.id; if (id && !await open(id, true)) return; await list(); });
window.addEventListener("beforeunload", event => { if (dirtyFields().length) { event.preventDefault(); event.returnValue = ""; } });
async function authenticate(user) {
  clearPrivate(); const ticket = generation; $("login-needed").hidden = Boolean(user);
  if (!user) { $("session-label").textContent = "로그인 필요"; message(""); return; }
  message("문의 담당 권한을 확인하고 있습니다.");
  try {
    const session = await runtime.httpsCallable(runtime.functionsClient, "getCoreAccessSession")({});
    if (!session.data || session.data.mustChangePassword === true) throw new Error("CORE 홈에서 계정 설정을 완료해 주세요.");
    const result = await call({ action: "access" }); if (ticket !== generation) return;
    access = result; $("session-label").textContent = `${result.name} · ${result.manager ? "관리자" : "스태프"}`;
    $("workspace").hidden = false; $("logout").hidden = false; await list();
    if (ticket === generation) await finishCoreNavigation(runtime, session.data);
  } catch (error) { if (ticket === generation) { clearPrivate(); message(error.message || "문의 담당 권한을 확인하지 못했습니다."); $("session-label").textContent = "접근 확인 필요"; } }
}
$("retry-auth").addEventListener("click", () => authenticate(runtime?.authClient.currentUser));
$("logout").addEventListener("click", async () => { clearPrivate(); await runtime.auth.signOut(runtime.authClient); });
async function initialize() {
  [schema, guidance] = await Promise.all([
    fetch("../assets/member-inquiry-schema.json", { cache: "no-store" }).then(res => { if (!res.ok) throw new Error("문의 유형 정보를 확인하지 못했습니다."); return res.json(); }),
    fetch("../assets/member-inquiry-guidance.json", { cache: "no-store" }).then(res => { if (!res.ok) throw new Error("규정 자료 확인 필요"); return res.json(); }).then(value => Array.isArray(value.rules) && value.sources ? value : null).catch(() => null),
  ]);
  const version = window.ARCHIVE_CORE_FIREBASE_VERSION || "10.14.1", config = window.KANGSAIN_FIREBASE_CONFIG;
  const [app, auth, functions] = await Promise.all([import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`), import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`), import(`https://www.gstatic.com/firebasejs/${version}/firebase-functions.js`)]);
  const client = app.getApps()[0] || app.initializeApp(config);
  runtime = sharedNavigationRuntime() || { auth, authClient: auth.getAuth(client), functionsClient: functions.getFunctions(client, config.functionsRegion), httpsCallable: functions.httpsCallable };
  runtime.auth.onAuthStateChanged(runtime.authClient, authenticate);
}
for (const [id, icon] of [["refresh-list", "refresh-cw"], ["load-context", "search"], ["preview-guidance", "file-text"], ["apply-guidance", "notebook-pen"], ["assign", "user-round"], ["record-execution", "clipboard-check"], ["record-notification", "messages-square"]]) {
  const element = $(id), label = element.textContent; element.innerHTML = uiIcon(icon); element.append(node("span", label)); element.title = label;
}
initialize().catch(() => { clearPrivate(); message("접수함 연결을 확인하지 못했습니다. 새로고침해 주세요."); });
