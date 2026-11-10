import { initCoreNavigationDocument, finishCoreNavigation, sharedNavigationRuntime } from "./core-navigation.js";
initCoreNavigationDocument();
const $ = id => document.getElementById(id);
const labels = { received: "새 접수", in_review: "직원 검토 중", awaiting_approval: "관리자 승인 대기", approved: "승인 · 수동 처리 대기", needs_information: "추가 확인 필요", rejected: "반려", completed: "처리 완료 기록" };
const actions = { received: "회원 접수", claim: "담당 확인", assign: "담당자 지정", review: "처리안 검토 요청", approve: "관리자 승인", reject: "관리자 반려", needs_information: "추가 확인 요청", complete: "수동 처리 결과 기록" };
let runtime, access, current, rows = [], cursor, generation = 0, schema, pending = false;
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, "0")).join("");
function message(value) { $("global-message").textContent = value; }
function node(tag, value) { const element = document.createElement(tag); element.textContent = value ?? ""; return element; }
function localTime(value) { return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST"; }
function clearPrivate() { generation++; access = current = null; rows = []; $("workspace").hidden = true; $("request-list").replaceChildren(); $("member-request").replaceChildren(); $("request-detail").hidden = true; $("event-list").replaceChildren(); $("decision-reason").value = $("completion-note").value = $("completion-evidence").value = ""; $("logout").hidden = true; $("plan").value = $("member-reply").value = $("internal-note").value = ""; }
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
function renderList() {
  const filter = $("status-filter").value, visible = rows.filter(row => filter === "all" || row.status === filter);
  $("request-list").replaceChildren();
  if (!visible.length) $("request-list").append(node("p", rows.length ? "선택한 상태의 문의가 없습니다. 다른 상태 또는 이전 접수도 확인해 주세요." : "조회한 범위에 문의가 없습니다."));
  visible.forEach(row => {
    const button = node("button", ""); button.type = "button"; button.className = "queue-item" + (current?.id === row.id ? " selected" : "");
    button.append(node("strong", schema.categories[row.category]?.title || "문의"), node("span", `${row.memberName} · ${row.maskedPhone}`), node("small", `${labels[row.status] || row.status} / ${row.assignedStaffName || "미배정"}`), node("small", new Date(row.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })));
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
    cursor = result.nextCursor; $("coverage").textContent = result.coverage.note + ` · 현재 ${rows.length}건 표시${cursor ? " · 이전 접수 더 있음" : ""}`;
    renderList(); message("");
  } catch (error) { if (ticket === generation) message(error.message || "접수 목록을 조회하지 못했습니다."); }
}
function showRow(row, events) {
  current = row; $("request-detail").hidden = false; $("detail-title").textContent = schema.categories[row.category]?.title || "회원 문의";
  $("detail-status").textContent = labels[row.status] || row.status;
  $("member-request").replaceChildren();
  const item = schema.categories[row.category];
  const answers = (item?.questions || []).filter(q => row.answers[q.id] !== undefined).map(q => `${q.label}: ${Array.isArray(row.answers[q.id]) ? row.answers[q.id].join(", ") : row.answers[q.id]}`).join("\n");
  for (const [key, value] of [["접수번호", row.id], ["회원 입력 정보", `${row.memberName} / ${row.memberPhone}`], ["본인 확인", "확인 전 · 회원이 기입한 정보"], ["선택 내용", answers], ["추가 내용", row.details || "없음"], ["답변 방법", row.contact], ["담당자", row.assignedStaffName || "미배정"], ["안내한 규정 버전", row.policyVersion]])
    $("member-request").append(node("dt", key), node("dd", value));
  const fixed = row.category === "fixed" && row.answers.request === "취소·변경 예외 상담" || row.category === "booking" && row.answers.mode === "고정예약" && ["수업 취소", "다른 수업으로 변경"].includes(row.answers.request);
  $("policy-fit").value = row.review?.policyFit || (fixed ? "exception" : "insufficient");
  $("resolution-kind").value = row.review?.resolutionKind || (fixed ? "exception_review" : "guidance");
  $("plan").value = row.review?.plan || ""; $("member-reply").value = row.review?.memberReply || ""; $("internal-note").value = row.review?.internalNote || "";
  $("decision-reason").value = ""; $("completion-note").value = ""; $("completion-evidence").value = ""; $("action-message").textContent = "";
  $("assignment").hidden = !access.manager || row.status === "completed";
  const placeholder = node("option", access.assignees.length ? "담당자를 선택해 주세요" : "선택 가능한 재직 직원이 없습니다"); placeholder.value = "";
  $("assignee").replaceChildren(placeholder, ...access.assignees.map(person => { const option = node("option", person.name); option.value = person.staffId; return option; }));
  $("assignee").value = access.assignees.some(person => person.staffId === row.assignedStaffId) ? row.assignedStaffId : "";
  $("decision-panel").hidden = !access.manager || row.status !== "awaiting_approval";
  $("review-hash").textContent = row.reviewHash ? `현재 처리안: ${row.reviewHash.slice(0, 16)} · 수정번호 ${row.revision}` : "";
  applyEditScope();
  $("event-list").replaceChildren(...events.map(event => node("li", `${localTime(event.at)} / ${actions[event.action] || "처리 기록"} / ${event.actorName || "회원"}${event.decision?.reason ? " / " + event.decision.reason : ""}`)));
  renderList(); $("detail-title").focus();
}
function applyEditScope() {
  if (!current || !access) return;
  const editable = current.status !== "completed" && (access.manager || current.assignedStaffId === access.staffId);
  $("claim").hidden = Boolean(current.assignedStaffId) || current.status === "completed";
  $("edit-scope").textContent = editable ? "담당 문의를 검토하고 관리자에게 처리안 승인을 요청할 수 있습니다." : current.status === "completed" ? "완료 기록은 열람만 가능합니다." : current.assignedStaffId ? "전체 스태프가 열람할 수 있으며, 검토·처리는 담당자와 관리자가 진행합니다." : "미배정 문의입니다. 내 담당으로 접수한 뒤 검토해 주세요.";
  $("review-form").querySelectorAll("input,textarea,select,button").forEach(el => el.disabled = !editable);
  $("completion-panel").hidden = current.status !== "approved" || !editable;
  $("assignee").disabled = pending || !access.assignees.length;
  $("assign").disabled = pending || !$("assignee").value;
}
async function open(id) {
  if (pending) return;
  const ticket = ++generation; message("문의 상세를 조회하고 있습니다."); $("request-detail").hidden = true;
  try {
    const [result, freshAccess] = await Promise.all([call({ action: "get", id }), access.manager ? call({ action: "access" }) : Promise.resolve(access)]);
    if (ticket === generation) { access = freshAccess; showRow(result.row, result.events); message(""); }
  }
  catch (error) { if (ticket === generation) message(error.message || "문의 상세를 조회하지 못했습니다."); }
}
function formChanged() { return current && (current.review?.plan || "") !== $("plan").value.trim() || current && (current.review?.memberReply || "") !== $("member-reply").value.trim() || current && (current.review?.internalNote || "") !== $("internal-note").value.trim() || current && current.review?.policyFit !== $("policy-fit").value || current && current.review?.resolutionKind !== $("resolution-kind").value; }
async function mutate(action, fields = {}) {
  if (!current || pending) return;
  if (["approve", "reject", "needs_information", "complete"].includes(action) && formChanged()) { $("action-message").textContent = "처리안을 수정했습니다. 먼저 관리자 검토 요청으로 저장해 주세요."; return; }
  pending = true; const mutationGeneration = generation; const id = current.id; const controls = document.querySelectorAll("#workspace button, #workspace select, #workspace textarea, #workspace input"); controls.forEach(el => el.disabled = true);
  $("action-message").textContent = "처리 결과를 확인하고 있습니다.";
  try {
    await call({ action, id, expectedRevision: current.revision, expectedReviewHash: current.reviewHash, commandId: nonce(), ...fields });
    if (mutationGeneration !== generation) return; pending = false; await open(id); await list(); $("action-message").textContent = "저장 결과를 다시 조회해 확인했습니다. 회원 안내 발송이나 예약 변경은 실행하지 않았습니다.";
  } catch (error) { $("action-message").textContent = `${error.message || "처리 결과를 확인하지 못했습니다."} 같은 작업을 반복하지 말고 ‘새로 조회’로 현재 상태를 확인해 주세요.`; }
  finally { pending = false; controls.forEach(el => el.disabled = false); applyEditScope(); }
}
$("review-form").addEventListener("submit", event => { event.preventDefault(); mutate("review", { policyFit: $("policy-fit").value, resolutionKind: $("resolution-kind").value, plan: $("plan").value, memberReply: $("member-reply").value, internalNote: $("internal-note").value }); });
$("approve").addEventListener("click", () => mutate("approve", { reason: $("decision-reason").value }));
$("reject").addEventListener("click", () => mutate("reject", { reason: $("decision-reason").value }));
$("request-info").addEventListener("click", () => mutate("needs_information", { reason: $("decision-reason").value }));
$("claim").addEventListener("click", () => mutate("claim"));
$("assign").addEventListener("click", () => mutate("assign", { assignedStaffId: $("assignee").value }));
$("assignee").addEventListener("change", applyEditScope);
$("complete").addEventListener("click", () => mutate("complete", { completionNote: $("completion-note").value, evidence: $("completion-evidence").value }));
$("status-filter").addEventListener("change", renderList); $("load-more").addEventListener("click", () => list(true));
$("refresh-list").addEventListener("click", async () => { await list(); if (current) await open(current.id); });
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
  schema = await fetch("../assets/member-inquiry-schema.json", { cache: "no-store" }).then(res => { if (!res.ok) throw new Error("문의 유형 정보를 확인하지 못했습니다."); return res.json(); });
  const version = window.ARCHIVE_CORE_FIREBASE_VERSION || "10.14.1", config = window.KANGSAIN_FIREBASE_CONFIG;
  const [app, auth, functions] = await Promise.all([import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`), import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`), import(`https://www.gstatic.com/firebasejs/${version}/firebase-functions.js`)]);
  const client = app.getApps()[0] || app.initializeApp(config);
  runtime = sharedNavigationRuntime() || { auth, authClient: auth.getAuth(client), functionsClient: functions.getFunctions(client, config.functionsRegion), httpsCallable: functions.httpsCallable };
  runtime.auth.onAuthStateChanged(runtime.authClient, authenticate);
}
initialize().catch(() => { clearPrivate(); message("접수함 연결을 확인하지 못했습니다. 새로고침해 주세요."); });
