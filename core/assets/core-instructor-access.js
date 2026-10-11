import { uiIcon } from "./ui-icons.js";

const APPROVED_HOSTS = new Set(["in.archivepilates.com", "core.archivepilates.com"]);
const CORE_BASE = new URL("../", import.meta.url).pathname;
const ROUTES = [
  ["home", CORE_BASE, "홈", "house"],
  ["private", `${CORE_BASE}private/`, "프라이빗", "clipboard-check"],
  ["sequence", `${CORE_BASE}sequence/`, "시퀀스 노트", "notebook-pen"],
];
const TERMINAL_STATUSES = new Set(["completed", "done", "sent", "delivered", "cancelled", "canceled"]);
const STATUS_LABELS = {
  pending: "기록 대기", waiting: "대기", recording: "기록 중", submitted: "기록 제출",
  report_review: "리포트 확인", completed: "완료", done: "완료",
  sent: "발송 완료", delivered: "전달 완료", approved: "리포트 승인",
  cancelled: "취소", canceled: "취소",
};
const hiddenNodes = new Map();
let root;
let observer;
let stylesheet;
let activeSession;
let generation = 0;
let prepareJob;
let cancelFirstLogin;
let authUnsubscribe;
let observedRuntime;
let pageHideRegistered = false;
let sequenceFrame;
let sequenceParent;
let sequenceNext;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function loadStyles() {
  if (!stylesheet) {
    stylesheet = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./core-instructor-access.css", import.meta.url).href;
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        stylesheet = null;
        reject(new Error("강사 화면 스타일을 불러오지 못했습니다."));
      };
      document.head.append(link);
    });
  }
  return stylesheet;
}

function hideNode(node) {
  if (!(node instanceof HTMLElement) || node === root || node.id === "coreLoginGate"
    || ["SCRIPT", "STYLE", "LINK"].includes(node.tagName)) return;
  if (!hiddenNodes.has(node)) {
    hiddenNodes.set(node, {
      hadStyle: node.hasAttribute("style"),
      hidden: node.hidden, inert: node.inert, ariaHidden: node.getAttribute("aria-hidden"),
      display: node.style.getPropertyValue("display"), priority: node.style.getPropertyPriority("display"),
    });
    observer?.observe(node, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "style"] });
  }
  if (!node.hidden) node.hidden = true;
  if (!node.inert) node.inert = true;
  if (node.getAttribute("aria-hidden") !== "true") node.setAttribute("aria-hidden", "true");
  if (node.style.getPropertyValue("display") !== "none" || node.style.getPropertyPriority("display") !== "important") {
    node.style.setProperty("display", "none", "important");
  }
}

// Quarantine operator DOM before awaiting access, including late-added operator overlays.
function isolateOperatorContent() {
  if (!root?.isConnected) {
    root = document.createElement("div");
    root.className = "core-instructor-access";
    root.id = "coreInstructorAccess";
    document.body.append(root);
  }
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const child of document.body.children) hideNode(child);
    });
    observer.observe(document.body, { childList: true });
  }
  for (const child of document.body.children) hideNode(child);
  root.hidden = false;
  return root;
}

function resetSequence() {
  if (!sequenceFrame) return;
  sequenceFrame.hidden = true;
  sequenceFrame.removeAttribute("src");
  delete sequenceFrame.dataset.authReady;
  if (sequenceParent?.isConnected) {
    sequenceParent.insertBefore(sequenceFrame, sequenceNext?.parentNode === sequenceParent ? sequenceNext : null);
  }
  sequenceFrame = sequenceParent = sequenceNext = null;
}

function restoreManagerContent() {
  observer?.disconnect();
  observer = null;
  resetSequence();
  root?.remove();
  root = null;
  for (const [node, previous] of hiddenNodes) {
    node.hidden = previous.hidden;
    node.inert = previous.inert;
    if (previous.ariaHidden === null) node.removeAttribute("aria-hidden");
    else node.setAttribute("aria-hidden", previous.ariaHidden);
    if (previous.display) node.style.setProperty("display", previous.display, previous.priority);
    else node.style.removeProperty("display");
    if (!previous.hadStyle && !node.style.cssText) node.removeAttribute("style");
  }
  hiddenNodes.clear();
}

function suspendAccess() {
  generation += 1;
  activeSession = null;
  cancelFirstLogin?.();
  resetSequence();
  if (root) {
    root.replaceChildren();
    root.hidden = true;
  }
}

function observeAuth(runtime) {
  if (!pageHideRegistered) {
    window.addEventListener("pagehide", () => {
      suspendAccess();
      authUnsubscribe?.();
      observedRuntime = null;
    });
    pageHideRegistered = true;
  }
  if (observedRuntime === runtime) return;
  authUnsubscribe?.();
  observedRuntime = runtime;
  authUnsubscribe = runtime.auth?.onAuthStateChanged?.(runtime.authClient, (user) => {
    if (!user || (activeSession?.uid && activeSession.uid !== user.uid)) suspendAccess();
  });
}

async function signOut(runtime) {
  await runtime.auth.signOut(runtime.authClient);
  suspendAccess();
}

function currentRoute() {
  const path = window.location.pathname.replace(/\/index\.html$/, "/").replace(/\/+$/, "") || "/";
  return ROUTES.find(([, href]) => path === (href.replace(/\/+$/, "") || "/"))?.[0] || "blocked";
}

function safeUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !APPROVED_HOSTS.has(url.hostname)
      || url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

function bindLogout(runtime) {
  const button = root.querySelector("[data-core-instructor-logout]");
  button?.addEventListener("click", async () => {
    button.disabled = true;
    // Clear member data immediately, even if the network sign-out later fails.
    generation += 1;
    resetSequence();
    root.querySelector("[data-core-instructor-content]")?.replaceChildren();
    const status = root.querySelector("[data-core-instructor-status]");
    try {
      await signOut(runtime);
      document.dispatchEvent(new CustomEvent("core-instructor-signed-out", { bubbles: true }));
    } catch {
      status.textContent = "로그아웃하지 못했습니다. 다시 시도하세요.";
      button.disabled = false;
    }
  });
}

function renderShell(runtime, session, route) {
  isolateOperatorContent();
  root.classList.remove("core-instructor-access--gate");
  root.innerHTML = `
    <header class="cia-header">
      <a class="cia-brand" href="${escapeHtml(ROUTES[0][1])}">ARCHIVE CORE</a>
      <div class="cia-account"><span>${escapeHtml(session.staffName || "강사")}</span>
        <button class="cia-button" type="button" data-core-instructor-logout>${uiIcon("x", "cia-icon")}<span>로그아웃</span></button>
      </div>
      <nav class="cia-nav" aria-label="강사 메뉴">${ROUTES.map(([key, href, label, icon]) => `
        <a href="${href}"${key === route ? ' aria-current="page"' : ""}>${uiIcon(icon, "cia-icon")}<span>${label}</span></a>
      `).join("")}</nav>
    </header>
    <main class="cia-main" aria-label="강사 업무">
      <p class="cia-status" role="status" data-core-instructor-status></p>
      <div data-core-instructor-content></div>
    </main>`;
  bindLogout(runtime);
  return root.querySelector("[data-core-instructor-content]");
}

function renderAccessNotice(runtime, session, pending = false) {
  const content = renderShell(runtime, session, "blocked");
  content.innerHTML = `<section class="cia-notice" aria-labelledby="ciaAccessTitle">
    ${uiIcon("user-round", "cia-notice-icon")}
    <h1 id="ciaAccessTitle">${pending ? "접근 권한 확인 필요" : "접근할 수 없는 페이지"}</h1>
    <p>${pending ? "강사 계정 연결을 확인해 주세요." : "이 계정에는 페이지 접근 권한이 없습니다."}</p>
    <a class="cia-button" href="${escapeHtml(ROUTES[0][1])}">${uiIcon("house", "cia-icon")}<span>홈으로</span></a>
  </section>`;
}

function firstLogin(runtime) {
  isolateOperatorContent();
  root.classList.add("core-instructor-access--gate");
  root.innerHTML = `<div class="cia-gate">
    <section class="cia-password-panel" role="dialog" aria-modal="true" aria-labelledby="ciaPasswordTitle" aria-describedby="ciaPasswordDescription">
      <p class="cia-eyebrow">ARCHIVE CORE</p>
      <h1 id="ciaPasswordTitle">새 비밀번호 설정</h1>
      <p id="ciaPasswordDescription">첫 로그인 시 비밀번호를 변경해 주세요. 변경 후 다시 로그인합니다.</p>
      <form class="cia-password-form">
        <label for="ciaNewPassword">새 비밀번호</label>
        <input id="ciaNewPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="64" required aria-describedby="ciaPasswordHint ciaPasswordError" />
        <p id="ciaPasswordHint" class="cia-hint">8~64자</p>
        <label for="ciaConfirmPassword">새 비밀번호 확인</label>
        <input id="ciaConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="64" required aria-describedby="ciaPasswordError" />
        <p id="ciaPasswordError" class="cia-error" role="alert"></p>
        <button class="cia-button cia-button--primary" type="submit">변경 후 다시 로그인</button>
        <button class="cia-button" type="button" data-core-first-logout>${uiIcon("x", "cia-icon")}<span>로그아웃</span></button>
      </form>
    </section>
  </div>`;
  const panel = root.querySelector(".cia-password-panel");
  const form = root.querySelector("form");
  const passwordInput = form.elements.newPassword;
  const confirmInput = form.elements.confirmPassword;
  const error = root.querySelector("#ciaPasswordError");
  const submit = form.querySelector('[type="submit"]');
  const logout = form.querySelector("[data-core-first-logout]");
  const loginGate = document.getElementById("coreLoginGate");
  const loginGateState = loginGate && { inert: loginGate.inert, ariaHidden: loginGate.getAttribute("aria-hidden") };
  if (loginGate) {
    loginGate.inert = true;
    loginGate.setAttribute("aria-hidden", "true");
  }
  let busy = false;
  let passwordChanged = false;
  passwordInput.focus();

  return new Promise((resolve) => {
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      passwordInput.value = confirmInput.value = "";
      document.removeEventListener("keydown", trapFocus, true);
      document.removeEventListener("focusin", keepFocus, true);
      if (loginGateState) {
        loginGate.inert = loginGateState.inert;
        if (loginGateState.ariaHidden === null) loginGate.removeAttribute("aria-hidden");
        else loginGate.setAttribute("aria-hidden", loginGateState.ariaHidden);
      }
      if (cancelFirstLogin === finish) cancelFirstLogin = null;
      resolve(null);
    }
    cancelFirstLogin = finish;
    function keepFocus(event) {
      if (!panel.contains(event.target)) (busy ? panel : passwordChanged ? submit : passwordInput).focus();
    }
    function trapFocus(event) {
      if (event.key === "Escape") event.preventDefault();
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll("input, button")].filter((node) => !node.disabled && !node.hidden);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trapFocus, true);
    document.addEventListener("focusin", keepFocus, true);
    function setBusy(value) {
      busy = value;
      submit.disabled = logout.disabled = value;
      passwordInput.disabled = confirmInput.disabled = value || passwordChanged;
      form.setAttribute("aria-busy", String(value));
      if (value) {
        panel.setAttribute("tabindex", "-1");
        panel.focus();
      }
    }
    async function finishSignOut(changed) {
      await signOut(runtime);
      finish();
      document.dispatchEvent(new CustomEvent(changed ? "core-password-changed" : "core-instructor-signed-out", { bubbles: true }));
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || finished) return;
      error.textContent = "";
      if (!passwordChanged) {
        if (passwordInput.value === "111111" || passwordInput.value.length < 8 || passwordInput.value.length > 64) {
          error.textContent = "공용 비밀번호가 아닌 8~64자의 새 비밀번호를 입력하세요.";
          passwordInput.focus();
          return;
        }
        if (passwordInput.value.trim() !== passwordInput.value) {
          error.textContent = "비밀번호 앞뒤의 공백을 제거하세요.";
          passwordInput.focus();
          return;
        }
        if (passwordInput.value !== confirmInput.value) {
          error.textContent = "새 비밀번호가 일치하지 않습니다.";
          confirmInput.focus();
          return;
        }
      }
      setBusy(true);
      try {
        if (!passwordChanged) {
          await runtime.httpsCallable(runtime.functionsClient, "completeCoreFirstLogin")({ password: passwordInput.value });
          passwordChanged = true;
          passwordInput.value = confirmInput.value = "";
        }
        if (finished) return;
        await finishSignOut(true);
      } catch {
        if (finished) return;
        error.textContent = passwordChanged
          ? "비밀번호는 변경되었습니다. 로그아웃을 다시 시도하세요."
          : "비밀번호를 변경하지 못했습니다. 다시 시도하세요.";
        if (passwordChanged) submit.textContent = "로그아웃 후 다시 로그인";
        setBusy(false);
        (passwordChanged ? submit : passwordInput).focus();
      }
    });
    logout.addEventListener("click", async () => {
      if (busy || finished) return;
      setBusy(true);
      try {
        await finishSignOut(passwordChanged);
      } catch {
        if (finished) return;
        error.textContent = "로그아웃하지 못했습니다. 다시 시도하세요.";
        setBusy(false);
        logout.focus();
      }
    });
  });
}

/** Call before any existing CORE reads; null means the caller must show its login gate. */
export async function prepareCoreAccess(runtime, user) {
  if (prepareJob?.runtime === runtime && prepareJob?.uid === user?.uid) return prepareJob.promise;
  cancelFirstLogin?.();
  const ticket = ++generation;
  activeSession = null;
  isolateOperatorContent();
  resetSequence();
  root.replaceChildren();
  if (!user) {
    suspendAccess();
    return null;
  }
  observeAuth(runtime);
  const promise = (async () => {
    try {
      await loadStyles();
      const response = await runtime.httpsCallable(runtime.functionsClient, "getCoreAccessSession")({});
      if (generation !== ticket) return null;
      const session = response?.data;
      if (session?.role === "manager") {
        activeSession = { session, uid: user.uid };
        restoreManagerContent();
        return session;
      }
      if (session?.role !== "instructor") {
        renderAccessNotice(runtime, {}, true);
        return null;
      }
      if (typeof session.mustChangePassword !== "boolean" || !String(session.staffId || "").trim()) {
        throw new Error("강사 접근 정보 확인이 필요합니다.");
      }
      activeSession = { session, uid: user.uid };
      if (session.mustChangePassword) return await firstLogin(runtime);
      return session;
    } catch (error) {
      if (generation !== ticket) return null;
      if (["functions/unauthenticated", "auth/user-token-expired", "auth/id-token-revoked", "auth/invalid-user-token"].includes(error?.code)) {
        await signOut(runtime);
        document.dispatchEvent(new Event("core-instructor-signed-out"));
        return null;
      }
      renderAccessNotice(runtime, {}, true);
      throw new Error("ARCHIVE CORE 접근 권한을 확인하지 못했습니다.");
    }
  })();
  prepareJob = { runtime, uid: user.uid, promise };
  try {
    return await promise;
  } finally {
    if (prepareJob?.promise === promise) prepareJob = null;
  }
}

function taskMarkup(task) {
  const actions = [["recordUrl", "기록 작성", "notebook-pen"], ["surveyUrl", "설문", "file-text"], ["reportUrl", "리포트 확인", "clipboard-check"]]
    .flatMap(([field, label, icon]) => {
      const href = safeUrl(task[field]);
      return href ? [`<a class="cia-button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${uiIcon(icon, "cia-icon")}<span>${label}</span></a>`] : [];
    });
  return `<li class="cia-row">
    <div class="cia-row-detail"><strong>${escapeHtml(task.memberName || "회원")}</strong>
      <span>${escapeHtml(task.date || "날짜 확인 필요")} ${escapeHtml(task.startTime || "")}</span></div>
    <span class="cia-task-status">${escapeHtml(STATUS_LABELS[task.status] || "확인 필요")}</span>
    <div class="cia-task-actions">${actions.length ? actions.join("") : '<span class="cia-hint">연결된 기록 없음</span>'}</div>
  </li>`;
}

function renderWorkspace(content, workspace, session, route) {
  if (!workspace || !/^\d{4}-\d{2}-\d{2}$/.test(workspace.date)
    || !Array.isArray(workspace.lessons) || !Array.isArray(workspace.privateTasks)
    || workspace.lessons.some((item) => !item || typeof item !== "object")
    || workspace.privateTasks.some((item) => !item || typeof item !== "object")) {
    throw new Error("Invalid instructor workspace");
  }
  const pending = workspace.privateTasks.filter((task) => !TERMINAL_STATUSES.has(task.status));
  const tasks = route === "home" ? pending : workspace.privateTasks;
  const today = workspace.lessons.filter((lesson) => lesson.date === workspace.date)
    .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
  const sortedTasks = [...tasks].sort((a, b) => `${a.date || ""} ${a.startTime || ""}`.localeCompare(`${b.date || ""} ${b.startTime || ""}`));
  content.innerHTML = `<header class="cia-page-heading">
    <p class="cia-eyebrow">${escapeHtml(workspace.staffName || session.staffName || "강사")} · ${escapeHtml(workspace.date)}</p>
    <h1>${route === "home" ? "오늘의 수업" : "프라이빗 기록"}</h1>
  </header>
  ${route === "home" ? `<section class="cia-section" aria-labelledby="ciaLessonsTitle">
    <div class="cia-section-heading"><h2 id="ciaLessonsTitle">오늘 수업</h2><span>${today.length}건</span></div>
    ${today.length ? `<ul class="cia-list">${today.map((lesson) => `<li class="cia-row cia-lesson-row">
      <time>${escapeHtml(lesson.startTime || "시간 확인 필요")}</time>
      <div class="cia-row-detail"><strong>${escapeHtml(lesson.title || "수업")}</strong><span>${escapeHtml(lesson.memberName || "")}</span></div>
    </li>`).join("")}</ul>` : '<p class="cia-empty">오늘 예정된 수업이 없습니다.</p>'}
  </section>` : ""}
  <section class="cia-section" aria-labelledby="ciaTasksTitle">
    <div class="cia-section-heading"><h2 id="ciaTasksTitle">${route === "home" ? "미처리 프라이빗" : "내 기록"}</h2><span>${tasks.length}건</span></div>
    ${tasks.length ? `<ul class="cia-list">${sortedTasks.map(taskMarkup).join("")}</ul>` : `<p class="cia-empty">${route === "home" ? "미처리 기록이 없습니다." : "연결된 프라이빗 기록이 없습니다."}</p>`}
  </section>`;
}

/** true handles/blocks the route; false leaves manager UI or the sequence store to the caller. */
export async function renderInstructorCore(runtime, session) {
  if (session?.role === "manager") return false;
  if (!session || session.role !== "instructor" || session.mustChangePassword !== false
    || activeSession?.session !== session) {
    isolateOperatorContent();
    if (!cancelFirstLogin) renderAccessNotice(runtime, {}, true);
    return true;
  }
  await loadStyles();
  if (activeSession?.session !== session) return true;
  const route = currentRoute();
  const ticket = ++generation;
  if (route === "blocked") {
    renderAccessNotice(runtime, session);
    return true;
  }
  if (route === "sequence") {
    const frame = document.querySelector("[data-sequence-studio]");
    if (!frame) {
      renderAccessNotice(runtime, session);
      return true;
    }
    if (!sequenceFrame) {
      sequenceFrame = frame;
      sequenceParent = frame.parentNode;
      sequenceNext = frame.nextSibling;
    }
    // Move, never clone: the existing createSequenceStore still owns this iframe.
    frame.remove();
    const content = renderShell(runtime, session, route);
    content.append(frame);
    root.classList.add("core-instructor-access--sequence");
    return false;
  }
  resetSequence();
  const content = renderShell(runtime, session, route);
  root.classList.remove("core-instructor-access--sequence");
  const status = root.querySelector("[data-core-instructor-status]");
  status.textContent = "내 수업을 불러오는 중";
  content.setAttribute("aria-busy", "true");
  try {
    const response = await runtime.httpsCallable(runtime.functionsClient, "getCoreInstructorWorkspace")({});
    if (generation !== ticket || activeSession?.session !== session || !content.isConnected) return true;
    renderWorkspace(content, response?.data, session, route);
    status.textContent = "";
  } catch {
    if (generation !== ticket || !content.isConnected) return true;
    content.replaceChildren();
    status.textContent = "내 수업을 불러오지 못했습니다.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "cia-button";
    retry.innerHTML = `${uiIcon("refresh-cw", "cia-icon")}<span>다시 시도</span>`;
    retry.addEventListener("click", () => renderInstructorCore(runtime, session));
    content.append(retry);
  } finally {
    content.removeAttribute("aria-busy");
  }
  return true;
}

