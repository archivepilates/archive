const BASE = new URL("../", import.meta.url);
const NAV_SELECTOR = ".nav a, .cia-nav a, .cia-brand";
let embedded = false;
let stylesReady;

export function initCoreNavigationDocument() {
  if (stylesReady) return;
  try { embedded = window.parent !== window && window.frameElement?.hasAttribute("data-core-navigation-frame"); }
  catch { embedded = false; }
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./core-navigation.css", import.meta.url).href;
  stylesReady = new Promise(resolve => {
    style.onload = () => resolve(true);
    style.onerror = () => resolve(false);
  });
  document.head.append(style);
  if (embedded) document.documentElement.dataset.coreNavigationPage = "true";
}

export function sharedNavigationRuntime() {
  if (!embedded) return null;
  const host = window.parent.archiveCoreNavigation;
  return host && host.runtime.authClient.currentUser?.uid === host.uid ? host.runtime : null;
}

function sameSession(host, session, runtime) {
  return runtime?.authClient.currentUser?.uid === host.uid && session?.role === host.session.role
    && String(session.staffId || "") === String(host.session.staffId || "")
    && session.mustChangePassword !== true;
}

async function flushEditors(doc) {
  // Auth/provider helpers are not editors and may be cross-origin.
  for (const frame of doc.querySelectorAll("[data-sequence-studio], [data-core-navigation-frame]")) {
    if (!frame.hasAttribute("src")) continue;
    try {
      const child = frame.contentWindow;
      if (frame.hasAttribute("data-sequence-studio")) {
        if (!child?.archiveSequenceNavigation || !await child.archiveSequenceNavigation.prepare()) return false;
      } else if (!child?.document || !await flushEditors(child.document)) return false;
    } catch { return false; }
  }
  return true;
}

export async function finishCoreNavigation(runtime, session, error = null) {
  if (!await stylesReady) return;
  if (embedded) {
    window.parent.archiveCoreNavigation?.ready(window.frameElement, runtime, session, error);
    return;
  }
  if (!session || session.mustChangePassword || !runtime.authClient.currentUser) return;
  window.archiveCoreNavigation?.dispose();
  const container = session.role === "instructor"
    ? document.querySelector(".cia-main") : document.querySelector(".shell > .main");
  if (!container) return;
  const uid = runtime.authClient.currentUser.uid;
  const initialUrl = location.href;
  const initialTitle = document.title;
  let currentUrl = initialUrl;
  let currentFrame;
  let pendingFrame;
  let generation = 0;
  let timer;
  let host;
  let disposed = false;
  let serial = Promise.resolve();
  const original = new Map([...container.children].map(node => [node, { hidden: node.hidden, inert: node.inert }]));
  const navLinks = new Map([...document.querySelectorAll(NAV_SELECTOR)].map(link => [link, link.getAttribute("href")]));
  const allowed = new Set([...navLinks.keys()].map(link => new URL(link.href).pathname));
  // Relative menu URLs must stay anchored to the original document after pushState.
  for (const link of navLinks.keys()) link.href = new URL(link.href).href;
  const status = document.createElement("div");
  status.className = "core-navigation-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  container.prepend(status);

  const setBusy = value => {
    container.setAttribute("aria-busy", String(value));
    if (currentFrame) currentFrame.inert = value;
    for (const node of container.children) {
      if (node !== status && node !== host && !node.classList.contains("core-account-bar")) node.inert = value;
    }
  };
  const showStatus = text => { status.textContent = text; status.hidden = !text; };
  const activate = url => {
    for (const link of document.querySelectorAll(NAV_SELECTOR)) {
      const selected = new URL(link.href).pathname === url.pathname;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    document.querySelector(".sidebar")?.classList.remove("is-open");
    document.querySelector(".mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
  };
  const validTarget = raw => {
    const url = new URL(raw, currentUrl);
    return url.origin === location.origin && url.pathname.startsWith(BASE.pathname)
      && allowed.has(url.pathname) ? url : null;
  };
  const fail = message => {
    clearTimeout(timer);
    pendingFrame?.remove();
    pendingFrame = null;
    setBusy(false);
    showStatus(message);
  };
  const invalidate = destination => {
    // An access change is never converted into a cached page or cached privilege.
    api.dispose();
    location.replace(destination);
  };
  const navigate = async (raw, historyMode = "push") => {
    const url = validTarget(raw);
    if (!url || disposed) return;
    if (url.href === currentUrl && historyMode !== "pop") return;
    const ticket = ++generation;
    clearTimeout(timer);
    pendingFrame?.remove();
    pendingFrame = null;
    setBusy(true);
    showStatus("화면 준비 중");
    if (!await flushEditors(currentFrame?.contentDocument || document)) {
      if (ticket !== generation || disposed) return;
      fail("저장을 확인하지 못했습니다. 시퀀스에서 저장 상태를 확인한 뒤 다시 이동하세요.");
      if (historyMode === "pop") history.pushState(null, "", currentUrl);
      return;
    }
    if (ticket !== generation || disposed) return;
    if (runtime.authClient.currentUser?.uid !== uid) { invalidate(url.href); return; }
    if (!host) {
      host = document.createElement("div");
      host.className = "core-navigation-host";
      container.append(host);
    }
    const frame = document.createElement("iframe");
    frame.dataset.coreNavigationFrame = "true";
    frame.title = "ARCHIVE CORE 메뉴";
    frame.hidden = true;
    frame.allow = "clipboard-write; web-share";
    frame.dataset.destination = url.href;
    frame.dataset.historyMode = historyMode;
    frame.addEventListener("error", () => { if (pendingFrame === frame) fail("화면을 불러오지 못했습니다. 메뉴를 다시 선택하세요."); });
    pendingFrame = frame;
    host.append(frame);
    timer = setTimeout(() => {
      if (pendingFrame !== frame) return;
      fail("화면 응답이 늦어지고 있습니다. 메뉴를 다시 선택하세요.");
    }, 30000);
    frame.src = url.href;
  };
  const click = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = validTarget(link.href);
    if (!url) {
      if (link.ownerDocument !== document && link.origin === location.origin) {
        event.preventDefault();
        serial = serial.then(async () => {
          if (await flushEditors(currentFrame?.contentDocument || document)) location.assign(link.href);
          else showStatus("저장을 확인하지 못했습니다. 시퀀스에서 저장 상태를 확인하세요.");
        });
      }
      return;
    }
    // In-page anchors retain their native behavior and current scroll position.
    if (!link.matches(NAV_SELECTOR) && url.pathname === new URL(currentUrl).pathname) return;
    event.preventDefault();
    serial = serial.then(() => navigate(url.href)).catch(() => fail("화면 전환에 실패했습니다. 다시 시도하세요."));
  };
  const pop = () => {
    const url = validTarget(location.href);
    if (!url) { invalidate(location.href); return; }
    serial = serial.then(() => navigate(url.href, "pop")).catch(() => invalidate(currentUrl));
  };
  const api = {
    runtime, uid, session,
    ready(frame, childRuntime, childSession, error = null) {
      if (disposed || (frame !== pendingFrame && frame !== currentFrame)) return;
      if (error === "core/access-unavailable" && childRuntime?.authClient.currentUser?.uid === uid) {
        if (frame === pendingFrame) fail("권한 확인이 지연되고 있습니다. 메뉴를 다시 선택하세요.");
        else showStatus("권한 확인이 지연되고 있습니다. 메뉴를 다시 선택하세요.");
        return;
      }
      if (!sameSession(api, childSession, childRuntime)) { invalidate(frame.dataset.destination); return; }
      if (frame === currentFrame) return;
      clearTimeout(timer);
      const url = new URL(frame.dataset.destination);
      const mode = frame.dataset.historyMode;
      frame.contentDocument.addEventListener("click", click);
      // Release a departing editor only after its acknowledged save and successful destination load.
      (currentFrame?.contentDocument || document).querySelectorAll("[data-sequence-studio]").forEach(editor => {
        editor.removeAttribute("src");
        editor.hidden = true;
      });
      for (const node of container.children) {
        if (node === status || node === host || node.classList.contains("core-account-bar")) continue;
        if (!original.has(node)) original.set(node, { hidden: node.hidden, inert: node.inert });
        node.hidden = true;
        node.inert = true;
      }
      currentFrame?.remove();
      currentFrame = frame;
      pendingFrame = null;
      container.classList.add("core-navigation-container");
      document.body.classList.add("core-navigation-active");
      frame.hidden = false;
      currentUrl = url.href;
      if (mode !== "pop") history.pushState(null, "", currentUrl);
      document.title = frame.contentDocument.title;
      frame.title = document.title;
      activate(url);
      setBusy(false);
      showStatus("");
      frame.contentWindow.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearTimeout(timer);
      pendingFrame?.remove();
      currentFrame?.remove();
      host?.remove();
      status.remove();
      for (const [node, previous] of original) { node.hidden = previous.hidden; node.inert = previous.inert; }
      for (const [link, href] of navLinks) link.setAttribute("href", href);
      container.classList.remove("core-navigation-container");
      container.removeAttribute("aria-busy");
      document.body.classList.remove("core-navigation-active");
      document.removeEventListener("click", click);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("pagehide", api.dispose);
      if (window.archiveCoreNavigation === api) delete window.archiveCoreNavigation;
      if (currentUrl !== initialUrl) history.replaceState(null, "", initialUrl);
      document.title = initialTitle;
    },
  };
  window.archiveCoreNavigation = api;
  document.addEventListener("click", click);
  window.addEventListener("popstate", pop);
  window.addEventListener("pagehide", api.dispose);
}
