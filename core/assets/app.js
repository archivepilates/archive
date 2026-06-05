const FIREBASE_APP_VERSION = "10.14.1";
const WORK_LANE_ID = "archive-core-transition";
const STUDIO_ID = "5330";

const state = {
  firebaseRuntime: null,
  automationItems: [],
  sourceImports: [],
  qualityIssues: [],
  businessSnapshot: null,
  businessMonths: [],
  businessMembers: [],
  members: [],
  memberDetail: null,
  alimtalkCandidates: [],
  alimtalkSends: [],
  privateRequests: [],
  privateRecords: [],
  privateUsageEvents: [],
  privateLedgerEntries: [],
  lessonOccurrences: [],
  reservations: [],
  deletedClassLogs: [],
  deletedLessons: [],
  lane: null,
  authReady: null,
};

let memberSearchTerm = "";
let memberFilter = "all";
let memberPage = 1;

const MEMBER_PAGE_SIZE = 20;

function qs(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = qs(id);
  if (element) element.textContent = value;
}

function setPillText(id, value) {
  const element = qs(id);
  if (!element) return;
  element.textContent = statusLabel(value);
  element.className = `pill ${normalizeStatus(value)}`;
}

function formatDate(value) {
  if (!value) return "-";
  if (Array.isArray(value) && !value.length) return "-";
  const raw = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(raw.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(raw);
}

function normMonth(value) {
  if (!value) return "";
  const stringValue = String(value);
  const match = stringValue.match(/(20\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value) {
  const month = normMonth(value);
  if (!month) return "-";
  return `${month.slice(2, 4)}년 ${Number(month.slice(5, 7))}월`;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replaceAll(",", "").replace("%", "").trim()) || 0;
}

function formatManwon(value) {
  if (!Number.isFinite(value)) return "-";
  const manwon = Math.round(value / 10000);
  return `${manwon.toLocaleString("ko-KR")}만`;
}

function formatCount(value, suffix = "건") {
  return `${toNumber(value).toLocaleString("ko-KR")}${suffix}`;
}

function shortDate(value) {
  if (!value) return "-";
  if (Array.isArray(value) && !value.length) return "-";
  const raw = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(raw.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  }).format(raw);
}

function compactDateTime(value) {
  if (!value) return "-";
  if (Array.isArray(value) && !value.length) return "-";
  const raw = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(raw.getTime())) return String(value);
  const month = raw.getMonth() + 1;
  const day = raw.getDate();
  const hours = String(raw.getHours()).padStart(2, "0");
  const minutes = String(raw.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hours}:${minutes}`;
}

function formatRate(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function memberDetailHref(memberId, depth = "root") {
  if (!memberId) return depth === "nested" ? "../../members/" : "../members/";
  const prefix = depth === "nested" ? "../../members/detail/" : "../members/detail/";
  return `${prefix}?id=${encodeURIComponent(memberId)}`;
}

function deltaText(current, previous, suffix = "%") {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "비교 데이터 대기";
  const diff = suffix === "%p" ? current - previous : ((current - previous) / previous) * 100;
  const marker = diff >= 0 ? "▲" : "▼";
  const sign = diff >= 0 ? "+" : "";
  return `${marker} ${sign}${diff.toFixed(1)}${suffix} vs 전월`;
}

function normalizeStatus(value) {
  const status = String(value || "unknown").toLowerCase();
  if (["success", "ok", "healthy", "done", "active", "completed"].includes(status)) return "good";
  if (["failed", "error", "critical", "blocked"].includes(status)) return "danger";
  if (["running", "pending", "warning", "review", "stale"].includes(status)) return "warn";
  return "";
}

function statusLabel(value) {
  const status = String(value || "unknown").toLowerCase();
  const labels = {
    active: "진행",
    success: "성공",
    completed: "완료",
    done: "완료",
    failed: "실패",
    error: "오류",
    blocked: "중단",
    running: "실행중",
    pending: "대기",
    warning: "주의",
    stale: "지연",
    reviewing: "검토",
    open: "확인",
    critical: "긴급",
  };
  return labels[status] || value || "확인";
}

function pill(value) {
  const tone = normalizeStatus(value);
  return `<span class="pill ${tone}">${escapeHtml(statusLabel(value))}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setConnection(label, detail) {
  setText("connectionLabel", label);
  setText("connectionDetail", detail);
}

const NAV_ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10M9 20v-6h6v6",
  members: "M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 19v-1a3 3 0 0 0-3-3h-1.2M15 5.2a2.8 2.8 0 0 1 0 5.6",
  lessons: "M4 6.5h16M4 12h16M4 17.5h9M8 4v16M16 4v10",
  private: "M5 4h14v16H5zM8 8h8M8 12h5M8 16h7",
  messages: "M4 6h16v11H8l-4 3V6zM8 10h8M8 14h5",
  automation: "M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  business: "M4 19h16M6 16V9M12 16V5M18 16v-7",
  imports: "M12 3v11M7 9l5 5 5-5M5 19h14",
  rules: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3v3M12 18v3M4.6 6.2l2.1 2.1M17.3 15.7l2.1 2.1M3 12h3M18 12h3M4.6 17.8l2.1-2.1M17.3 8.3l2.1-2.1",
};

function navIcon(section) {
  const path = NAV_ICONS[section] || NAV_ICONS.home;
  return `
    <svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="${path}" />
    </svg>
  `;
}

function enhanceNav() {
  document.querySelectorAll(".nav a").forEach((link) => {
    if (link.dataset.enhanced === "true") return;
    const section = link.dataset.section || "home";
    const small = link.querySelector("small")?.textContent?.trim() || "";
    const label = [...link.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    const title = label || section;
    link.setAttribute("aria-label", `${title}${small ? ` · ${small}` : ""}`);
    link.removeAttribute("title");
    link.innerHTML = `
      ${navIcon(section)}
      <span class="nav-label">
        <span>${escapeHtml(title)}</span>
        ${small ? `<small>${escapeHtml(small)}</small>` : ""}
      </span>
    `;
    link.dataset.enhanced = "true";
  });
}

function activateNav() {
  const path = window.location.pathname.replace(/\/+$/, "");
  document.querySelectorAll(".nav a").forEach((link) => {
    const href = new URL(link.getAttribute("href"), window.location.href);
    const hrefPath = href.pathname.replace(/\/+$/, "");
    const isRoot = link.dataset.section === "home" && (path.endsWith("/core") || path === "");
    const isActive = isRoot || (link.dataset.section && hrefPath && path.endsWith(hrefPath));
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

async function initFirebase() {
  if (state.firebaseRuntime) return state.firebaseRuntime;
  const config = window.KANGSAIN_FIREBASE_CONFIG;
  if (!config?.apiKey) throw new Error("Firebase 설정을 찾을 수 없습니다.");

  const [{ initializeApp, getApps }, firestore, auth] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-auth.js`),
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  state.firebaseRuntime = {
    app,
    db: firestore.getFirestore(app),
    authClient: auth.getAuth(app),
    auth,
    ...firestore,
  };
  return state.firebaseRuntime;
}

function ensureLoginGate() {
  if (qs("coreLoginGate") || !document.querySelector("[data-firestore-dashboard]")) return;
  const gate = document.createElement("div");
  gate.className = "login-gate";
  gate.id = "coreLoginGate";
  gate.innerHTML = `
    <form class="login-card" id="coreLoginForm">
      <h2>ARCHIVE CORE</h2>
      <p>운영자 휴대폰번호와 비밀번호로 로그인하세요.</p>
      <label>
        <span>휴대폰번호</span>
        <input id="coreLoginPhone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01000000000" />
      </label>
      <label>
        <span>비밀번호</span>
        <input id="coreLoginPassword" type="password" autocomplete="current-password" placeholder="비밀번호" />
      </label>
      <button type="submit">로그인</button>
      <div class="login-error" id="coreLoginError"></div>
    </form>
  `;
  document.body.appendChild(gate);
  qs("coreLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = qs("coreLoginPhone")?.value.replace(/\D/g, "") || "";
    const password = qs("coreLoginPassword")?.value.trim() || "";
    if (!phone || !password) {
      setText("coreLoginError", "휴대폰번호와 비밀번호를 입력하세요.");
      return;
    }
    setText("coreLoginError", "");
    try {
      const runtime = await initFirebase();
      await runtime.auth.signInWithEmailAndPassword(runtime.authClient, `p${phone}@archivepilates.com`, password);
      gate.classList.remove("on");
      await refresh();
    } catch (error) {
      setText("coreLoginError", loginErrorMessage(error));
    }
  });
}

function loginErrorMessage(error) {
  const code = String(error?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "로그인 정보를 확인하세요.";
  }
  if (code.includes("too-many-requests")) return "요청이 많습니다. 잠시 후 다시 시도하세요.";
  if (code.includes("unauthorized-domain")) return "Firebase Auth 허용 도메인 확인이 필요합니다.";
  return error?.message || "로그인에 실패했습니다.";
}

function showLoginGate(message = "") {
  ensureLoginGate();
  const gate = qs("coreLoginGate");
  if (!gate) return;
  setText("coreLoginError", message);
  gate.classList.add("on");
}

async function waitForAuth(runtime) {
  if (runtime.authClient.currentUser) return runtime.authClient.currentUser;
  if (!state.authReady) {
    state.authReady = new Promise((resolve) => {
      const unsubscribe = runtime.auth.onAuthStateChanged(runtime.authClient, (user) => {
        unsubscribe();
        resolve(user || null);
      });
    });
  }
  return state.authReady;
}

async function getRecentCollection(db, firestore, collectionName, maxItems = 8) {
  return getRecentCollectionBy(db, firestore, collectionName, "updatedAt", maxItems);
}

async function getRecentCollectionBy(db, firestore, collectionName, orderField = "updatedAt", maxItems = 8) {
  try {
    const queryRef = firestore.query(
      firestore.collection(db, collectionName),
      firestore.orderBy(orderField, "desc"),
      firestore.limit(maxItems),
    );
    const snapshot = await firestore.getDocs(queryRef);
    return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  } catch (error) {
    if (String(error?.code || error?.message || "").includes("permission")) throw error;
    const snapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    return snapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .sort((a, b) => String(b[orderField] || "").localeCompare(String(a[orderField] || "")))
      .slice(0, maxItems);
  }
}

async function getCollectionBy(db, firestore, collectionName, orderField = "updatedAt", maxItems = 1000) {
  try {
    const snapshot = await firestore.getDocs(
      firestore.query(firestore.collection(db, collectionName), firestore.orderBy(orderField, "desc")),
    );
    return snapshot.docs.slice(0, maxItems).map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  } catch (error) {
    if (String(error?.code || error?.message || "").includes("permission")) throw error;
    const snapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    return snapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .sort((a, b) => String(b[orderField] || "").localeCompare(String(a[orderField] || "")))
      .slice(0, maxItems);
  }
}

function studioItems(items) {
  return items.filter((item) => String(item.studioId || STUDIO_ID) === STUDIO_ID);
}

function memberDetailId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("id") || params.get("memberId") || "").trim();
}

async function getLimitedSubcollection(db, firestore, memberId, subcollection, maxItems = 12) {
  const snapshot = await firestore.getDocs(
    firestore.query(firestore.collection(db, "members", memberId, subcollection), firestore.limit(maxItems)),
  );
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

async function loadMemberDetail(runtime, memberId) {
  if (!memberId) return { missingId: true };
  const { db, doc, getDoc } = runtime;
  const [memberSnapshot, cardSnapshot, summarySnapshot, tickets, purchases, bookings, memos, alimtalkLogs, tags] =
    await Promise.all([
      getDoc(doc(db, "members", memberId)),
      getDoc(doc(db, "member360Cards", memberId)),
      getDoc(doc(db, "members", memberId, "summary", "current")),
      getLimitedSubcollection(db, runtime, memberId, "tickets", 12),
      getLimitedSubcollection(db, runtime, memberId, "purchases", 12),
      getLimitedSubcollection(db, runtime, memberId, "bookings", 12),
      getLimitedSubcollection(db, runtime, memberId, "memos", 8),
      getLimitedSubcollection(db, runtime, memberId, "alimtalkLogs", 8),
      getLimitedSubcollection(db, runtime, memberId, "tags", 20),
    ]);
  return {
    id: memberId,
    missing: !memberSnapshot.exists() && !cardSnapshot.exists(),
    member: memberSnapshot.exists() ? { id: memberSnapshot.id, ...memberSnapshot.data() } : null,
    card: cardSnapshot.exists() ? { id: cardSnapshot.id, ...cardSnapshot.data() } : null,
    summary: summarySnapshot.exists() ? summarySnapshot.data() : null,
    tickets,
    purchases,
    bookings,
    memos,
    alimtalkLogs,
    tags,
  };
}

function renderLane(lane) {
  setText("laneStatus", statusLabel(lane?.status || "active"));
  setText(
    "laneUpdated",
    lane?.updatedAt ? `${formatDate(lane.updatedAt)} 업데이트` : "workLanes/archive-core-transition",
  );
}

function renderAutomation(items) {
  const failedItems = items.filter((item) =>
    ["failed", "error", "critical", "blocked"].includes(String(item.status || item.health || "").toLowerCase()),
  );
  const latestItem = [...items].sort((a, b) => {
    const left = new Date(a.updatedAt?.toDate?.() || a.updatedAt || a.lastRunAt || a.checkedAt || 0).getTime();
    const right = new Date(b.updatedAt?.toDate?.() || b.updatedAt || b.lastRunAt || b.checkedAt || 0).getTime();
    return right - left;
  })[0];
  const automationMode = qs("automationMode");
  if (automationMode) {
    automationMode.textContent = failedItems.length ? "확인 필요" : items.length ? "연결" : "기록 대기";
    automationMode.className = `pill ${failedItems.length ? "danger" : items.length ? "good" : "warn"}`;
  }
  setText("automationStatusCount", formatCount(items.length));
  setText("automationFailedCount", formatCount(failedItems.length));
  setText("automationRecentRun", latestItem ? formatDate(latestItem.updatedAt || latestItem.lastRunAt || latestItem.checkedAt) : "기록 대기");
  setText("automationConnectedState", items.length ? "상태 문서 연결됨" : "컬렉션 연결 · 기록 없음");
  setText(
    "automationNextAction",
    items.length
      ? "최근 문서 기준으로 상태를 표시합니다."
      : "Mac mini / Excel / 알림톡 작업이 automationStatus에 결과를 쓰도록 연결해야 합니다.",
  );

  const list = qs("automationList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">automationStatus 컬렉션은 읽었지만 최근 기록 문서가 없습니다. 자동화 작업 결과 저장 연결이 다음 단계입니다.</div>`;
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const name = item.title || item.name || item.id;
      const detail = item.summary || item.message || item.lastResult || item.description || "상세 기록 없음";
      const updated = formatDate(item.updatedAt || item.lastRunAt || item.checkedAt);
      const nextRun = item.nextRunAt || item.nextScheduledAt ? ` · 다음 ${formatDate(item.nextRunAt || item.nextScheduledAt)}` : "";
      const error = item.lastError || item.errorMessage ? ` · ${item.lastError || item.errorMessage}` : "";
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(detail)} · ${escapeHtml(updated)}${escapeHtml(nextRun)}${escapeHtml(error)}</p>
          </div>
          ${pill(item.status || item.health)}
        </div>
      `;
    })
    .join("");

  const healthList = qs("automationHealthList");
  if (healthList) {
    const flows = [
      {
        title: "StudioMate Excel 동기화",
        source: items.find((item) => item.id === "studiomate-excel-sync") || items[0],
        detail: "회원목록, 예약내역, 삭제 수업 원본을 가져와 CORE 표시용 상태를 갱신합니다.",
      },
      {
        title: "알림톡 자동발송",
        source: items.find((item) => String(item.id || "").includes("alimtalk")),
        detail: "후보 선정과 실제 발송은 기존 canonical 컬렉션 기준으로 유지합니다.",
      },
      {
        title: "Google Contacts 동기화",
        source: items.find((item) => String(item.id || "").includes("contact")),
        detail: "연락처 write는 승인된 동기화 큐와 매칭 규칙만 사용합니다.",
      },
    ];
    healthList.innerHTML = flows
      .map((flow) => {
        const status = flow.source?.status || flow.source?.health || (flow.source ? "active" : "pending");
        const updated = flow.source ? formatDate(flow.source.updatedAt || flow.source.lastRunAt || flow.source.checkedAt) : "기록 대기";
        const lastResult = flow.source?.lastResult || flow.source?.summary || flow.source?.message || flow.detail;
        return `
          <div class="status-row">
            <div>
              <strong>${escapeHtml(flow.title)}</strong>
              <p>${escapeHtml(lastResult)} · ${escapeHtml(updated)}</p>
            </div>
            ${pill(status)}
          </div>
        `;
      })
      .join("");
  }
}

function renderImports(items) {
  setText("importCount", String(items.length));
  setText("sourceImportCount", formatCount(items.length));
  setText("importConnectionState", items.length ? "최근 원본 처리 기록 연결됨" : "sourceImports 기록 대기");
  const latest = items[0];
  setText("latestImportKind", latest ? sourceKindLabel(latest.sourceKind || latest.kind || latest.fileName || latest.id) : "원본 대기");
  setText(
    "latestImportNote",
    latest
      ? `${latest.sourceFileName || latest.sourceKind || latest.id} · ${formatDate(latest.updatedAt || latest.importedAt || latest.createdAt)}`
      : "최근 import 결과가 없습니다.",
  );
  const table = qs("importsTable");
  if (!table) return;
  if (!items.length) {
    table.innerHTML = `<tr><td colspan="4">sourceImports 컬렉션은 읽었지만 최근 원본 처리 문서가 없습니다.</td></tr>`;
    return;
  }

  table.innerHTML = items
    .map((item) => {
      const source = item.sourceKind || item.kind || item.fileName || item.id;
      const rows = item.importedRows ?? item.rowCount ?? item.rows ?? "-";
      const updated = formatDate(item.updatedAt || item.importedAt || item.createdAt);
      return `
        <tr>
          <td><strong>${escapeHtml(sourceKindLabel(source))}</strong><br><span>${escapeHtml(item.sourceFileName || item.fileName || item.id)}</span></td>
          <td>${pill(item.status || item.importStatus)}</td>
          <td>${escapeHtml(rows)}</td>
          <td>${escapeHtml(updated)}</td>
        </tr>
      `;
    })
    .join("");
}

function sourceKindLabel(value) {
  const raw = String(value || "");
  if (raw.includes("member")) return "회원목록";
  if (raw.includes("reservation")) return "예약내역";
  if (raw.includes("deleted")) return "삭제 수업";
  if (raw.includes("sales")) return "매출 원본";
  return raw || "원본";
}

function renderQualityIssues(items) {
  const activeIssues = items.filter((item) => !["resolved", "closed", "done"].includes(String(item.status || "").toLowerCase()));
  const resolvedIssues = items.filter((item) => ["resolved", "closed", "done"].includes(String(item.status || "").toLowerCase()));
  const latestIssue = activeIssues[0];
  setText("qualityCount", String(activeIssues.length));
  setText("qualityOpenCount", formatCount(activeIssues.length));
  setText("qualityResolvedCount", formatCount(resolvedIssues.length));
  setText("latestQualityTitle", latestIssue ? latestIssue.title || latestIssue.issueType || "품질 이슈" : "열린 이슈 없음");
  setText(
    "latestQualityNote",
    latestIssue
      ? `${latestIssue.summary || "상세 기록 없음"} · ${qualityActionText(latestIssue)}`
      : "외부 실행 전 정지해야 할 열린 품질 이슈가 없습니다.",
  );

  const list = qs("qualityList");
  if (!list) return;
  if (!activeIssues.length) {
    list.innerHTML = `<div class="empty-state">열린 데이터 품질 이슈가 없습니다. import 검증 작업이 기록을 만들면 여기에서 확인합니다.</div>`;
    return;
  }

  list.innerHTML = activeIssues
    .map((item) => {
      const title = item.title || item.issueType || item.id;
      const detail = item.summary || item.description || item.memberName || "상세 기록 없음";
      const action = qualityActionText(item);
      const href = item.memberId ? memberDetailHref(item.memberId) : null;
      const tagName = href ? "a" : "div";
      const attrs = href ? ` class="status-row status-link" href="${escapeHtml(href)}"` : ` class="status-row"`;
      return `
        <${tagName}${attrs}>
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(detail)} · ${escapeHtml(action)} · ${escapeHtml((item.sourcePaths || []).map((path) => path.split("/").pop()).slice(0, 1).join(", "))}</p>
          </div>
          ${pill(item.severity || item.status)}
        </${tagName}>
      `;
    })
    .join("");
}

function qualityActionText(item) {
  const type = String(item.issueType || item.type || item.title || "").toLowerCase();
  if (type.includes("phone") || type.includes("전화")) return "전화번호 확인 전 외부 실행 보류";
  if (type.includes("duplicate") || type.includes("중복")) return "canonical key 기준 우선순위 확인";
  if (type.includes("name") || type.includes("동명이인")) return "이름 단독 매칭 금지, 전화번호/StudioMate ID 확인";
  if (type.includes("excel")) return "실제 StudioMate memberId 해소 후 사용";
  return "운영자가 원천/매칭 상태 확인";
}

function activeQualityIssues() {
  return state.qualityIssues.filter((item) => !["resolved", "closed", "done"].includes(String(item.status || "").toLowerCase()));
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizedMemberName(item) {
  return String(item.name || item.memberName || "").trim().replace(/\s+/g, "");
}

function memberMergeKey(item) {
  const phone = normalizePhone(item.phone || item.mobile || item.phoneNumber);
  const name = normalizedMemberName(item);
  if (name && phone.length >= 8) return `name-phone:${name}:${phone}`;
  const last4 = normalizePhone(item.phoneLast4).slice(-4);
  if (name && last4.length === 4) return `name-last4:${name}:${last4}`;
  return `id:${item.memberId || item.id}`;
}

function timestampMs(value) {
  if (!value) return 0;
  if (Array.isArray(value) && !value.length) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime() || 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateKey(value) {
  const ms = timestampMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(timestampMs(value));
  date.setHours(0, 0, 0, 0);
  return date;
}

function isWithinDays(value, startDate, days) {
  const ms = timestampMs(value);
  if (!ms) return false;
  const start = startOfLocalDay(startDate).getTime();
  const end = start + days * 24 * 60 * 60 * 1000;
  return ms >= start && ms < end;
}

function ticketLabel(ticket) {
  if (typeof ticket === "string") return ticket;
  return ticket?.name || ticket?.ticketName || ticket?.title || "";
}

function uniqueTickets(items) {
  const tickets = [];
  const seen = new Set();
  items
    .flatMap((item) => item.currentTicketsSummary || item.activeTicketNames || [])
    .forEach((ticket) => {
      const label = ticketLabel(ticket);
      if (!label || seen.has(label)) return;
      seen.add(label);
      tickets.push(ticket);
    });
  return tickets;
}

function memberRank(item) {
  const stableId = String(item.memberId || item.id || "");
  const isFallback = stableId.startsWith("excel_") || stableId.startsWith("usage_");
  return (
    (toNumber(item.activeTicketCount) > 0 ? 100 : 0) +
    (timestampMs(item.recentVisitAt) ? 40 : 0) +
    (toNumber(item.totalRevenue) > 0 ? 20 : 0) +
    (normalizePhone(item.phone).length >= 8 ? 10 : 0) +
    (isFallback ? -50 : 0)
  );
}

function mergeMemberGroup(group) {
  if (group.length === 1) return group[0];
  const sorted = [...group].sort((a, b) => memberRank(b) - memberRank(a) || timestampMs(b.updatedAt) - timestampMs(a.updatedAt));
  const primary = sorted[0];
  const ids = sorted.map((item) => String(item.memberId || item.id || "")).filter(Boolean);
  const recent = sorted.reduce((latest, item) => (timestampMs(item.recentVisitAt) > timestampMs(latest) ? item.recentVisitAt : latest), primary.recentVisitAt);
  return {
    ...primary,
    currentTicketsSummary: uniqueTickets(sorted),
    activeTicketCount: Math.max(...sorted.map((item) => toNumber(item.activeTicketCount || (item.currentTicketsSummary || []).length))),
    totalRevenue: Math.max(...sorted.map((item) => toNumber(item.totalRevenue))),
    recentVisitAt: recent,
    phone: primary.phone || sorted.find((item) => item.phone)?.phone,
    phoneLast4: primary.phoneLast4 || sorted.find((item) => item.phoneLast4)?.phoneLast4,
    mergedMemberCount: group.length,
    mergedMemberIds: ids,
  };
}

function mergeDuplicateMembers(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = memberMergeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()]
    .map(mergeMemberGroup)
    .sort((a, b) => toNumber(b.totalRevenue) - toNumber(a.totalRevenue) || timestampMs(b.recentVisitAt) - timestampMs(a.recentVisitAt));
}

function memberHasQualityIssue(item) {
  const activeIssues = activeQualityIssues();
  const memberId = String(item.memberId || item.id || "");
  const memberName = String(item.name || item.memberName || "");
  return activeIssues.some((issue) => {
    const target = [issue.memberId, issue.memberName, issue.name, issue.profileId].filter(Boolean).join(" ");
    return (memberId && target.includes(memberId)) || (memberName && target.includes(memberName));
  });
}

function matchesMemberSearch(item) {
  if (!memberSearchTerm) return true;
  const haystack = [
    item.name,
    item.memberName,
    item.memberId,
    item.id,
    item.phone,
    item.phoneLast4,
    ...(item.tagLabels || []),
    ...(item.currentTicketsSummary || []).map((ticket) => (typeof ticket === "string" ? ticket : ticket.name || ticket.ticketName)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(memberSearchTerm.toLowerCase());
}

function matchesMemberFilter(item) {
  if (memberFilter === "active-ticket") return toNumber(item.activeTicketCount) > 0;
  if (memberFilter === "recent-visit") return Boolean(item.recentVisitAt);
  if (memberFilter === "revenue") return toNumber(item.totalRevenue) > 0;
  if (memberFilter === "quality") return memberHasQualityIssue(item);
  return true;
}

function renderMemberFilterButtons(items) {
  const counts = {
    all: items.length,
    "active-ticket": items.filter((item) => toNumber(item.activeTicketCount) > 0).length,
    "recent-visit": items.filter((item) => item.recentVisitAt).length,
    revenue: items.filter((item) => toNumber(item.totalRevenue) > 0).length,
    quality: items.filter(memberHasQualityIssue).length,
  };
  setText("memberFilterAllCount", counts.all);
  setText("memberFilterActiveCount", counts["active-ticket"]);
  setText("memberFilterRecentCount", counts["recent-visit"]);
  setText("memberFilterRevenueCount", counts.revenue);
  setText("memberFilterQualityCount", counts.quality);
  document.querySelectorAll("[data-member-filter]").forEach((button) => {
    const active = button.dataset.memberFilter === memberFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderMemberPagination(totalItems) {
  const pagination = qs("memberPagination");
  if (!pagination) return;
  if (totalItems <= MEMBER_PAGE_SIZE) {
    pagination.innerHTML = `<span>전체 ${totalItems.toLocaleString("ko-KR")}명</span>`;
    return;
  }
  const totalPages = Math.ceil(totalItems / MEMBER_PAGE_SIZE);
  memberPage = Math.min(Math.max(memberPage, 1), totalPages);
  const start = (memberPage - 1) * MEMBER_PAGE_SIZE + 1;
  const end = Math.min(memberPage * MEMBER_PAGE_SIZE, totalItems);
  pagination.innerHTML = `
    <span>${start.toLocaleString("ko-KR")}-${end.toLocaleString("ko-KR")} / ${totalItems.toLocaleString("ko-KR")}명</span>
    <div class="pagination-actions">
      <button class="filter-button" type="button" data-member-page="prev" ${memberPage <= 1 ? "disabled" : ""}>이전</button>
      <strong>${memberPage.toLocaleString("ko-KR")} / ${totalPages.toLocaleString("ko-KR")}</strong>
      <button class="filter-button" type="button" data-member-page="next" ${memberPage >= totalPages ? "disabled" : ""}>다음</button>
    </div>
  `;
}

function renderMembers(items) {
  const table = qs("membersTable");
  if (!table) return;
  const mergedItems = mergeDuplicateMembers(items);
  renderMemberFilterButtons(mergedItems);
  const visibleItems = mergedItems.filter(matchesMemberSearch).filter(matchesMemberFilter);
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / MEMBER_PAGE_SIZE));
  memberPage = Math.min(Math.max(memberPage, 1), totalPages);
  const pageItems = visibleItems.slice((memberPage - 1) * MEMBER_PAGE_SIZE, memberPage * MEMBER_PAGE_SIZE);
  setText("membersVisibleCount", String(visibleItems.length));
  setText("membersActiveTicketCount", String(visibleItems.filter((item) => toNumber(item.activeTicketCount) > 0).length));
  setText("membersRecentVisitCount", String(visibleItems.filter((item) => item.recentVisitAt).length));
  setText("membersRevenueCount", String(visibleItems.filter((item) => toNumber(item.totalRevenue) > 0).length));

  if (!items.length) {
    table.innerHTML = `<tr><td colspan="4">member360Cards 문서가 없거나 권한 확인이 필요합니다.</td></tr>`;
    renderMemberPagination(0);
    return;
  }
  if (!visibleItems.length) {
    table.innerHTML = `<tr><td colspan="4">검색어와 일치하는 회원이 없습니다.</td></tr>`;
    renderMemberPagination(0);
    return;
  }

  table.innerHTML = pageItems
    .map((item) => {
      const ticketNames = (item.currentTicketsSummary || item.activeTicketNames || [])
        .map((ticket) => (typeof ticket === "string" ? ticket : ticket.name))
        .filter(Boolean)
        .slice(0, 2);
      const ticketText = ticketNames.length ? ticketNames.join(", ") : "활성 수강권 없음";
      const phone = item.phoneLast4 ? ` · ${item.phoneLast4}` : "";
      const detailHref = `./detail/?id=${encodeURIComponent(item.memberId || item.id)}`;
      const mergedNote =
        item.mergedMemberCount > 1
          ? `<br><span class="member-merge-note">중복 ${item.mergedMemberCount}건 병합 · ${escapeHtml((item.mergedMemberIds || []).join(", "))}</span>`
          : "";
      return `
        <tr>
          <td><a class="member-link" href="${detailHref}"><strong>${escapeHtml(item.name || item.memberId || item.id)}</strong></a><br><span>${escapeHtml(item.memberId || item.id)}${escapeHtml(phone)}</span>${mergedNote}</td>
          <td>${escapeHtml(ticketText)}<br><span>${escapeHtml(toNumber(item.activeTicketCount) ? `${item.activeTicketCount}개` : "0개")}</span></td>
          <td>${escapeHtml(formatDate(item.recentVisitAt))}</td>
          <td>${escapeHtml(formatManwon(toNumber(item.totalRevenue)))}</td>
        </tr>
      `;
    })
    .join("");
  renderMemberPagination(visibleItems.length);
}

function renderMessages(candidates, sends) {
  if (!qs("messagesCandidateList")) return;
  const sentCandidates = candidates.filter((item) => String(item.status || "").toLowerCase() === "sent");
  const failedSends = sends.filter((item) => ["failed", "error"].includes(String(item.status || "").toLowerCase()));
  const pendingCandidates = candidates.filter((item) =>
    ["queued", "pending", "review", "reviewed", "processing"].includes(String(item.status || "").toLowerCase()),
  );
  setText("messagesCandidateCount", formatCount(candidates.length));
  setText("messagesSendCount", formatCount(sends.length));
  setText("messagesSentCount", formatCount(sentCandidates.length));
  setText("messagesFailedCount", formatCount(failedSends.length));
  setText("messagesPendingDecision", pendingCandidates.length ? `${pendingCandidates.length}건 확인` : "대기 없음");
  setText("messagesRiskDecision", failedSends.length ? `${failedSends.length}건 실패` : "위험 낮음");

  const renderAlimtalkRow = (item, options = {}) => {
    const template = item.title || item.templateName || item.templateCode || item.type || "알림톡";
    const member = item.memberName || item.name || item.memberId || item.id;
    const date = formatDate(item.sentAt || item.updatedAt || item.createdAt || item.sourceDate);
    const reason = item.reason || item.lastError || item.dedupePolicy || item.candidateId || "";
    return `
      <div class="status-row">
        <div>
          <strong>${escapeHtml(member)}</strong>
          <p>${escapeHtml(template)} · ${escapeHtml(date)}${reason ? ` · ${escapeHtml(reason)}` : ""}</p>
        </div>
        ${pill(options.status?.(item) || item.status || item.sendStatus)}
      </div>
    `;
  };

  const candidateList = qs("messagesCandidateList");
  candidateList.innerHTML = candidates.length
    ? candidates.map((item) => renderAlimtalkRow(item)).join("")
    : `<div class="empty-state">최근 alimtalkCandidates 문서가 없습니다.</div>`;

  const sendList = qs("messagesSendList");
  if (sendList) {
    sendList.innerHTML = sends.length
      ? sends.map((item) => renderAlimtalkRow(item, { status: (send) => send.status || "done" })).join("")
      : `<div class="empty-state">최근 alimtalkSends 문서가 없습니다.</div>`;
  }

  const templateList = qs("messagesTemplateList");
  if (templateList) {
    const templateMap = new Map();
    for (const item of [...candidates, ...sends]) {
      const key = item.title || item.templateName || item.templateCode || item.type || "알림톡";
      const current = templateMap.get(key) || { label: key, candidates: 0, sends: 0, failed: 0, sent: 0 };
      if (candidates.includes(item)) current.candidates += 1;
      if (sends.includes(item)) current.sends += 1;
      const status = String(item.status || item.sendStatus || "").toLowerCase();
      if (["failed", "error"].includes(status)) current.failed += 1;
      if (["sent", "done", "success", "completed"].includes(status)) current.sent += 1;
      templateMap.set(key, current);
    }
    const rows = [...templateMap.values()]
      .sort((a, b) => b.failed - a.failed || b.sends + b.candidates - (a.sends + a.candidates))
      .slice(0, 8);
    templateList.innerHTML = rows.length
      ? rows
          .map((row) => {
            const status = row.failed ? "failed" : row.sent ? "success" : "active";
            return `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(row.label)}</strong>
                  <p>후보 ${escapeHtml(row.candidates)}건 · 발송 ${escapeHtml(row.sends)}건 · 실패 ${escapeHtml(row.failed)}건</p>
                </div>
                ${pill(status)}
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">최근 템플릿별 기록이 없습니다.</div>`;
  }

  const decisionList = qs("messagesDecisionList");
  if (decisionList) {
    const rows = [
      {
        title: "오늘 볼 것",
        detail: pendingCandidates.length
          ? "대기/검토/처리중 후보가 있습니다. 실제 발송 전 중복과 템플릿을 확인하세요."
          : "최근 후보 기준으로 즉시 승인해야 할 대기 항목은 보이지 않습니다.",
        status: pendingCandidates.length ? "warning" : "success",
      },
      {
        title: "실패 로그",
        detail: failedSends.length
          ? "실패 로그가 있습니다. 템플릿, 전화번호, Solapi 응답을 확인해야 합니다."
          : "최근 발송 로그에서 실패 상태는 보이지 않습니다.",
        status: failedSends.length ? "failed" : "success",
      },
      {
        title: "운영 경계",
        detail: "이 탭은 확인용입니다. 후보 선정과 발송 원천은 기존 alimtalkCandidates/alimtalkSends를 유지합니다.",
        status: "active",
      },
    ];
    decisionList.innerHTML = rows
      .map(
        (row) => `
          <div class="status-row">
            <div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></div>
            ${pill(row.status)}
          </div>
        `,
      )
      .join("");
  }
}

function lessonTypeLabel(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("semi")) return "세미";
  if (type.includes("private") || type.includes("개인") || type.includes("프라이빗")) return "프라이빗";
  if (type.includes("group") || type.includes("그룹")) return "그룹";
  return value || "수업";
}

function lessonStatusTone(item) {
  const count = toNumber(item.reservationCount);
  const capacity = toNumber(item.capacity);
  if (capacity && count >= capacity) return "success";
  if (capacity && count <= 1 && String(item.lessonType || "").toLowerCase().includes("group")) return "warning";
  return "active";
}

function renderLessonRow(item) {
  const startsAt = item.startsAt || item.lessonDate || item.startAt;
  const title = item.lessonTitle || item.lectureTitle || item.title || "수업명 없음";
  const staff = item.staffName || item.instructorName || "강사 미지정";
  const count = toNumber(item.reservationCount);
  const capacity = toNumber(item.capacity);
  const room = item.roomName || item.room || "";
  const source = item.sourceKind || "source";
  return `
    <div class="status-row">
      <div>
        <strong>${escapeHtml(compactDateTime(startsAt))} · ${escapeHtml(title)}</strong>
        <p>${escapeHtml(staff)} · ${escapeHtml(lessonTypeLabel(item.lessonType))}${room ? ` · ${escapeHtml(room)}` : ""}</p>
        <p>예약 ${count.toLocaleString("ko-KR")}${capacity ? ` / 정원 ${capacity.toLocaleString("ko-KR")}` : ""} · ${escapeHtml(source)}</p>
      </div>
      ${pill(lessonStatusTone(item))}
    </div>
  `;
}

function renderLessons(lessons, reservations, deletedLogs) {
  if (!qs("lessonsTodayList")) return;
  const items = studioItems(lessons)
    .filter((item) => timestampMs(item.startsAt || item.lessonDate || item.startAt))
    .sort((a, b) => timestampMs(a.startsAt || a.lessonDate || a.startAt) - timestampMs(b.startsAt || b.lessonDate || b.startAt));
  const now = new Date();
  const todayLessons = items.filter((item) => dateKey(item.startsAt || item.lessonDate || item.startAt) === dateKey(now));
  const weekLessons = items.filter((item) => isWithinDays(item.startsAt || item.lessonDate || item.startAt, now, 7));
  const groupLessons = weekLessons.filter((item) => String(item.lessonType || "").toLowerCase().includes("group"));
  const privateLessons = weekLessons.filter((item) => {
    const type = String(item.lessonType || "").toLowerCase();
    return type.includes("private") || type.includes("semi");
  });
  const reservationItems = studioItems(reservations);
  const deletedItems = studioItems(deletedLogs);

  setText("lessonsTodayCount", formatCount(todayLessons.length, "개"));
  setText("lessonsWeekCount", formatCount(weekLessons.length, "개"));
  setText("lessonsGroupCount", formatCount(groupLessons.length, "개"));
  setText("lessonsPrivateCount", formatCount(privateLessons.length, "개"));
  setPillText("lessonsTodayStatus", todayLessons.length ? "active" : "warning");
  setPillText("lessonsInstructorStatus", weekLessons.length ? "success" : "warning");
  setPillText("lessonsDeletedStatus", deletedItems.length ? "active" : "warning");

  const todayList = qs("lessonsTodayList");
  if (todayList) {
    todayList.innerHTML = todayLessons.length
      ? todayLessons.slice(0, 12).map(renderLessonRow).join("")
      : `<div class="empty-state">오늘 기준 lessonOccurrences 수업이 없습니다. 원천 기간 또는 import 상태를 확인하세요.</div>`;
  }

  const byInstructor = new Map();
  weekLessons.forEach((item) => {
    const staff = item.staffName || item.instructorName || "강사 미지정";
    const current = byInstructor.get(staff) || { count: 0, reservations: 0, group: 0, private: 0 };
    current.count += 1;
    current.reservations += toNumber(item.reservationCount);
    const type = String(item.lessonType || "").toLowerCase();
    if (type.includes("private") || type.includes("semi")) current.private += 1;
    else current.group += 1;
    byInstructor.set(staff, current);
  });
  const instructorList = qs("lessonsInstructorList");
  if (instructorList) {
    const rows = [...byInstructor.entries()].sort((a, b) => b[1].count - a[1].count);
    instructorList.innerHTML = rows.length
      ? rows
          .map(
            ([staff, row]) => `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(staff)}</strong>
                  <p>이번주 ${row.count.toLocaleString("ko-KR")}개 · 그룹 ${row.group.toLocaleString("ko-KR")} · 프라이빗 ${row.private.toLocaleString("ko-KR")}</p>
                  <p>예약 합계 ${row.reservations.toLocaleString("ko-KR")}명</p>
                </div>
                ${pill("success")}
              </div>
            `,
          )
          .join("")
      : `<div class="empty-state">이번주 강사별 수업 집계가 없습니다.</div>`;
  }

  const sourceList = qs("lessonsSourceList");
  if (sourceList) {
    const sourceKinds = [...new Set(weekLessons.map((item) => item.sourceKind).filter(Boolean))];
    sourceList.innerHTML = `
      <div class="status-row">
        <div>
          <strong>lessonOccurrences ${items.length.toLocaleString("ko-KR")}개</strong>
          <p>이번주 표시 ${weekLessons.length.toLocaleString("ko-KR")}개 · reservations 샘플 ${reservationItems.length.toLocaleString("ko-KR")}개</p>
          <p>${escapeHtml(sourceKinds.join(", ") || "sourceKind 없음")}</p>
        </div>
        ${pill(items.length ? "success" : "warning")}
      </div>
      <div class="status-row">
        <div>
          <strong>운영 경계</strong>
          <p>이 탭은 read-only 현황입니다. 알림톡, 연락처, StudioMate write 대상 선정에는 사용하지 않습니다.</p>
        </div>
        ${pill("warning")}
      </div>
    `;
  }

  const deletedList = qs("lessonsDeletedList");
  if (deletedList) {
    deletedList.innerHTML = deletedItems.length
      ? deletedItems.slice(0, 8).map(renderLessonRow).join("")
      : `
        <div class="status-row">
          <div>
            <strong>삭제 수업 로그 미수집</strong>
            <p>현재 deletedClassLogs 원천이 비어 있어 인원미달 폐강과 시간표 조정을 자동 분류하지 않습니다.</p>
          </div>
          ${pill("warning")}
        </div>
      `;
  }
}

function renderMiniList(id, items, options = {}) {
  const list = qs(id);
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(options.empty || "표시할 기록이 없습니다.")}</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const title = options.title?.(item) || item.name || item.title || item.ticketName || item.id;
      const detail = options.detail?.(item) || item.summary || item.status || item.memo || item.id;
      const status = options.status?.(item);
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(detail)}</p>
          </div>
          ${status ? pill(status) : ""}
        </div>
      `;
    })
    .join("");
}

function renderMemberDetail(detail) {
  if (!qs("memberDetailName")) return;
  if (detail?.missingId) {
    setText("memberDetailName", "회원 선택 필요");
    setText("memberDetailSubtitle", "Members 목록에서 회원을 선택하면 상세 read-model을 표시합니다.");
    return;
  }
  if (detail?.missing) {
    setText("memberDetailName", "회원 문서 없음");
    setText("memberDetailSubtitle", `${detail.id} 회원 문서를 찾지 못했습니다.`);
    return;
  }

  const member = detail?.member || detail?.card || {};
  const summary = detail?.summary || {};
  const merged = { ...detail?.card, ...member, ...summary };
  const signals = merged.signals || detail?.card?.signals || [];
  const tickets = detail?.tickets?.length ? detail.tickets : merged.currentTicketsSummary || [];
  const purchases = detail?.purchases?.length ? detail.purchases : merged.recentPurchases || [];
  const bookings = detail?.bookings?.length ? detail.bookings : merged.recentBookings || [];
  const memos = detail?.memos?.length ? detail.memos : merged.recentMemos || [];
  const alimtalkLogs = detail?.alimtalkLogs?.length ? detail.alimtalkLogs : merged.recentAlimtalk || [];
  const tags = detail?.tags?.length ? detail.tags : merged.tags || [];
  const relatedIssues = state.qualityIssues.filter((item) => {
    const target = [item.memberId, item.memberName, item.name, item.profileId].filter(Boolean).join(" ");
    return target.includes(member.memberId || detail?.id || "") || target.includes(member.name || member.memberName || "");
  });
  const openSignals = signals.filter((signal) => {
    const level = typeof signal === "string" ? "" : signal.level || signal.severity;
    return ["critical", "danger", "error", "warning", "warn"].includes(String(level || "").toLowerCase());
  });

  setText("memberDetailName", member.name || member.memberName || detail?.id || "회원");
  setText(
    "memberDetailSubtitle",
    `${member.memberId || detail?.id || "-"} · ${member.phoneLast4 ? `끝자리 ${member.phoneLast4}` : "전화번호 요약 없음"} · ${statusLabel(member.status || "active")}`,
  );
  setText("memberDetailRevenue", formatManwon(toNumber(member.totalRevenue)));
  setText("memberDetailTickets", formatCount(member.activeTicketCount || tickets.length, "개"));
  setText("memberDetailBookings", formatCount(member.bookingCount || bookings.length));
  setText("memberDetailRecentVisit", compactDateTime(member.recentVisitAt));
  setText("memberDetailRegisteredAt", shortDate(member.registeredAt));
  setText("memberDetailUpdatedAt", formatDate(member.updatedAt || summary.updatedAt));
  setText("memberDetailMemoCount", formatCount(memos.length));
  setText("memberDetailAlimtalkCount", formatCount(alimtalkLogs.length));
  setText("memberDetailQualityCount", formatCount(relatedIssues.length));

  const activeTicketCount = toNumber(member.activeTicketCount || tickets.length);
  const lastVisitText = member.recentVisitAt ? compactDateTime(member.recentVisitAt) : "최근 방문 없음";
  if (relatedIssues.length) {
    setPillText("memberDetailPrimaryActionTone", "warning");
    setText("memberDetailPrimaryAction", "품질 이슈 먼저 확인");
    setText("memberDetailPrimaryActionNote", "전화번호, 임시 ID, 중복 fallback 여부를 확인하기 전에는 외부 실행으로 넘기지 않습니다.");
  } else if (openSignals.length) {
    setPillText("memberDetailPrimaryActionTone", "warning");
    setText("memberDetailPrimaryAction", "주의 신호 확인");
    setText("memberDetailPrimaryActionNote", "수강권, 메모, 알림톡 상태를 먼저 확인하고 필요하면 운영자가 직접 판단합니다.");
  } else {
    setPillText("memberDetailPrimaryActionTone", "success");
    setText("memberDetailPrimaryAction", "긴급 신호 낮음");
    setText("memberDetailPrimaryActionNote", "현재 read-model 기준으로 즉시 멈춰야 할 품질/주의 신호는 보이지 않습니다.");
  }
  setPillText("memberDetailCareActionTone", activeTicketCount ? "active" : "warning");
  setText("memberDetailCareAction", activeTicketCount ? "수강권 기반 케어" : "수강권 상태 확인");
  setText(
    "memberDetailCareActionNote",
    activeTicketCount
      ? `${activeTicketCount}개 활성 수강권 · 최근 방문 ${lastVisitText} · 메모 ${memos.length}건`
      : `활성 수강권 요약 없음 · 최근 방문 ${lastVisitText} · 상담/만료/미등록 여부 확인`,
  );
  setPillText("memberDetailGuardrailTone", "success");
  setText("memberDetailGuardrail", "검토용 read-model");
  setText("memberDetailGuardrailNote", "알림톡, 연락처, StudioMate write는 canonical source에서만 대상자를 선정합니다.");

  const signalList = qs("memberDetailSignals");
  if (signalList) {
    signalList.innerHTML = signals.length
      ? signals
          .map((signal) => {
            const label = typeof signal === "string" ? signal : signal.label || signal.type || "신호";
            const tone = signalTone(typeof signal === "string" ? "" : signal.level || signal.severity);
            return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
          })
          .join("")
      : `<span class="pill">신호 없음</span>`;
  }

  const decisionList = qs("memberDetailDecisionList");
  if (decisionList) {
    const rows = [
      {
        title: openSignals.length ? "주의 신호 확인" : "주의 신호 낮음",
        detail: openSignals.length
          ? `${openSignals.length}개 신호가 있습니다. 수강권, 메모, 알림톡 상태를 먼저 확인하세요.`
          : "현재 read-model 기준 긴급 신호는 보이지 않습니다.",
        status: openSignals.length ? "warning" : "success",
      },
      {
        title: toNumber(member.activeTicketCount || tickets.length) ? "수강권 보유" : "수강권 확인 필요",
        detail: toNumber(member.activeTicketCount || tickets.length)
          ? "현재 수강권 요약이 있어 최근 예약/출석과 함께 보면 됩니다."
          : "활성 수강권 요약이 없으므로 상담/미등록/만료 상태를 확인하세요.",
        status: toNumber(member.activeTicketCount || tickets.length) ? "active" : "warning",
      },
      {
        title: relatedIssues.length ? "데이터 품질 이슈 있음" : "품질 이슈 없음",
        detail: relatedIssues.length
          ? "전화번호, 임시 ID, 중복 fallback 등 외부 실행 전 확인이 필요합니다."
          : "최근 열린 품질 이슈와 직접 연결된 항목은 보이지 않습니다.",
        status: relatedIssues.length ? "warning" : "success",
      },
    ];
    decisionList.innerHTML = rows
      .map(
        (row) => `
          <div class="status-row">
            <div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></div>
            ${pill(row.status)}
          </div>
        `,
      )
      .join("");
  }

  const nextList = qs("memberDetailNextList");
  if (nextList) {
    const id = member.memberId || detail?.id;
    const links = [
      { title: "알림톡 이력 확인", detail: "최근 후보/발송 로그와 템플릿 상태를 함께 봅니다.", href: "../../messages/", status: "active" },
      { title: "원본 품질 확인", detail: "중복, 임시 ID, name-only match 여부를 확인합니다.", href: "../../imports/", status: relatedIssues.length ? "warning" : "active" },
      { title: "경영 맥락 확인", detail: "매출 상위/ACM 후보/장기회원 판단 흐름과 연결합니다.", href: "../../business/", status: toNumber(member.totalRevenue) ? "success" : "active" },
      { title: "회원 목록으로 돌아가기", detail: id ? `${id} 기준 검색/비교를 이어갑니다.` : "다른 회원을 검색합니다.", href: "../", status: "active" },
    ];
    nextList.innerHTML = links
      .map(
        (row) => `
          <a class="status-row status-link" href="${row.href}">
            <div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></div>
            ${pill(row.status)}
          </a>
        `,
      )
      .join("");
  }

  renderMiniList("memberDetailTicketsList", tickets, {
    empty: "현재 수강권 요약이 없습니다.",
    title: (item) => item.ticketName || item.name || item.id,
    detail: (item) => {
      const remain = item.remainingCount ?? item.remaining ?? item.remainCount;
      const max = item.maxCount ?? item.totalCount ?? "";
      const expires = item.expiresAt || item.expireAt || item.endAt;
      return [
        `잔여 ${remain ?? "-"}${max ? ` / ${max}` : ""}`,
        expires ? `만료 ${shortDate(expires)}` : "",
        item.classType || item.status || "",
      ]
        .filter(Boolean)
        .join(" · ");
    },
    status: (item) => item.status || item.ticketStatus,
  });
  renderMiniList("memberDetailPurchasesList", purchases, {
    empty: "최근 구매/수강권 이력이 없습니다.",
    title: (item) => item.ticketName || item.productName || item.name || item.id,
    detail: (item) =>
      [shortDate(item.purchasedAt || item.createdAt), formatManwon(toNumber(item.price || item.amount || item.revenue))]
        .filter(Boolean)
        .join(" · "),
    status: (item) => item.status,
  });
  renderMiniList("memberDetailBookingsList", bookings, {
    empty: "최근 예약/출석 이력이 없습니다.",
    title: (item) => item.lessonTitle || item.lectureTitle || item.ticketName || item.id,
    detail: (item) =>
      [shortDate(item.lessonDate || item.startsAt || item.startAt), item.startTime, item.staffName || item.instructorName]
        .filter(Boolean)
        .join(" · "),
    status: (item) => item.attendanceStatus || item.status,
  });
  renderMiniList("memberDetailMemosList", memos, {
    empty: "최근 메모가 없습니다.",
    title: (item) => item.title || item.memoType || item.authorName || "메모",
    detail: (item) => item.memo || item.content || item.text || shortDate(item.createdAt),
    status: (item) => item.syncStatus || item.status,
  });
  renderMiniList("memberDetailAlimtalkList", alimtalkLogs, {
    empty: "최근 알림톡 기록이 없습니다.",
    title: (item) => item.templateName || item.templateCode || item.candidateType || item.id,
    detail: (item) =>
      [shortDate(item.sentAt || item.createdAt), item.reason || item.message || item.managementNumber].filter(Boolean).join(" · "),
    status: (item) => item.status || item.sendStatus,
  });

  const tagList = qs("memberDetailTagsList");
  if (tagList) {
    const values = tags
      .map((tag) => (typeof tag === "string" ? tag : tag.label || tag.name || tag.tag || tag.id))
      .filter(Boolean)
      .slice(0, 24);
    tagList.innerHTML = values.length
      ? values.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")
      : `<span class="pill">태그 없음</span>`;
  }

  renderMiniList("memberDetailQualityList", relatedIssues, {
    empty: "이 회원과 직접 연결된 열린 품질 이슈가 없습니다.",
    title: (item) => item.title || item.issueType || item.id,
    detail: (item) => [item.summary || item.description || "상세 기록 없음", qualityActionText(item)].filter(Boolean).join(" · "),
    status: (item) => item.severity || item.status,
  });
}

function signalTone(value) {
  const level = String(value || "").toLowerCase();
  if (["critical", "danger", "error"].includes(level)) return "danger";
  if (["warning", "warn"].includes(level)) return "warn";
  if (["good", "success", "healthy"].includes(level)) return "good";
  return "";
}

function renderPrivate(requests, records, usageEvents, ledgerEntries) {
  if (!qs("privateRequestList")) return;
  setText("privateRequestCount", String(requests.length));
  setText("privateRecordCount", String(records.length));
  setText("privateUsageCount", String(usageEvents.length));
  setText("privateLedgerCount", String(ledgerEntries.length));
  const recordFailures = records.filter((item) =>
    ["failed", "error"].includes(String(item.gptStatus || item.status || "").toLowerCase()),
  ).length;
  const corrections = records.filter((item) => item.sessionNumberCorrection).length;
  const submitted = requests.filter((item) =>
    ["submitted", "pre_submitted", "post_submitted", "completed"].includes(
      String(item.preStatus || item.postStatus || item.status || "").toLowerCase(),
    ),
  ).length;
  setText("privateRecordHealth", recordFailures ? `${recordFailures}건 오류 확인` : "차트 기록 읽기 정상");
  setText("privateSubmittedCount", formatCount(submitted));
  setText("privateCorrectionCount", formatCount(corrections));

  const requestList = qs("privateRequestList");
  if (requestList) {
    requestList.innerHTML = requests.length
      ? requests
          .map((item) => {
            const status = item.preStatus || item.postStatus || item.status || item.alimtalk?.status || "pending";
            const lesson = [item.lessonDate, item.staffName].filter(Boolean).join(" · ");
            return `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(item.memberName || item.memberId || item.id)}</strong>
                  <p>${escapeHtml(lesson || "수업 정보 없음")} · ${escapeHtml(item.bookingId || item.requestId || item.id)}</p>
                </div>
                ${pill(status)}
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">최근 privateLessonChartRequests 문서가 없습니다.</div>`;
  }

  const ledgerList = qs("privateLedgerList");
  if (!ledgerList) return;
  if (ledgerEntries.length) {
    ledgerList.innerHTML = ledgerEntries
      .map((item) => `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(item.memberName || item.memberId || item.id)}</strong>
            <p>${escapeHtml(item.startsAt || item.lessonDate || "")} · 누적 ${escapeHtml(item.cumulativePrivateRound || "-")}회</p>
          </div>
          ${pill(item.status || "active")}
        </div>
      `)
      .join("");
    return;
  }
  ledgerList.innerHTML = `
    <div class="status-row">
      <div>
        <strong>memberUsageEvents</strong>
        <p>${usageEvents.length ? "이용 이력 문서가 감지되었습니다." : "아직 운영 반영된 이용 이력 문서가 없습니다."}</p>
      </div>
      ${pill(usageEvents.length ? "reviewing" : "pending")}
    </div>
    <div class="status-row">
      <div>
        <strong>privateSessionLedger</strong>
        <p>현재 회차 계산 장부는 준비 단계입니다. 기존 차트 원천은 유지됩니다.</p>
      </div>
      ${pill("pending")}
    </div>
    <div class="status-row">
      <div>
        <strong>이용내역 backfill dry-run</strong>
        <p>65,521행 검토 · 예약 생성 53,191건 후보 · 제한 적용 승인 전까지 write 보류</p>
      </div>
      ${pill("reviewing")}
    </div>
  `;
}

function normalizeBusinessSnapshot(data) {
  const summary = (data?.summary || [])
    .map((row) => ({
      month: normMonth(row.월),
      totalRevenue: toNumber(row.총매출),
      lessonRevenue: toNumber(row.수업매출),
      marginRate: toNumber(row.마진률),
      groupSessions: toNumber(row.그룹세션),
      privateSessions: toNumber(row.프라이빗),
      reservationRate: toNumber(row.예약률),
      attendanceRate: toNumber(row.출석률),
    }))
    .filter((row) => row.month)
    .sort((a, b) => a.month.localeCompare(b.month));

  const instructorRevenue = (data?.강사별 || [])
    .map((row) => ({
      month: normMonth(row.월),
      name: String(row.강사 || ""),
      revenue: toNumber(row.총매출),
    }))
    .filter((row) => row.month && row.name);

  const ticketTop = (data?.수강권TOP5 || [])
    .map((row) => ({
      month: normMonth(row.월),
      label: String(row.라벨 || row.수강권명 || ""),
      value: toNumber(row.값),
      hiddenKinds: toNumber(row.종류수),
    }))
    .filter((row) => row.month && row.label);

  const dailyRevenue = (data?.매출일일누적 || [])
    .map((row) => ({
      month: normMonth(row.기준월 || row.월),
      date: String(row.기준일 || row.일자 || ""),
      totalRevenue: toNumber(row.월누적매출),
      previousTotalRevenue: toNumber(row.전월동일일누적),
      lessonRevenue: toNumber(row.월누적수업매출),
      previousLessonRevenue: toNumber(row.전월동일일수업누적),
      marginRate: toNumber(row.월누적수업마진률),
      previousMarginRate: toNumber(row.전월동일일수업마진률),
      attendanceRate: toNumber(row.월누적그룹출석률),
      previousAttendanceRate: toNumber(row.전월동일일그룹출석률),
    }))
    .filter((row) => row.month && row.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary,
    instructorRevenue,
    ticketTop,
    dailyRevenue,
    updatedAt: data?.updatedAt || data?.syncedAt || null,
  };
}

function latestDailyForMonth(snapshot, month) {
  return [...(snapshot?.dailyRevenue || [])].filter((row) => row.month === month).pop() || null;
}

function renderBusinessBars(summary, selectedMonth) {
  const container = qs("businessMonthlyBars");
  if (!container) return;
  const rows = summary.slice(-8);
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">dashboardSnapshots/current summary 데이터가 없습니다.</div>`;
    return;
  }
  const maxRevenue = Math.max(...rows.map((row) => row.totalRevenue), 1);
  container.innerHTML = rows
    .map((row) => {
      const percent = Math.max(6, Math.round((row.totalRevenue / maxRevenue) * 100));
      const active = row.month === selectedMonth ? " active" : "";
      return `
        <button class="business-bar${active}" type="button" data-business-month="${escapeHtml(row.month)}">
          <span>${escapeHtml(formatMonth(row.month))}</span>
          <strong>${escapeHtml(formatManwon(row.totalRevenue))}</strong>
          <i style="--bar-width:${percent}%"></i>
        </button>
      `;
    })
    .join("");
}

function renderBusinessRanks(snapshot, month) {
  const container = qs("businessRankList");
  if (!container) return;
  const instructors = snapshot.instructorRevenue
    .filter((row) => row.month === month)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4);
  const tickets = snapshot.ticketTop.filter((row) => row.month === month).slice(0, 4);

  if (!instructors.length && !tickets.length) {
    container.innerHTML = `<div class="empty-state">선택 월 TOP 데이터가 없습니다.</div>`;
    return;
  }

  const renderRows = (title, rows, valueKey) => `
    <div class="rank-section">
      <h3>${escapeHtml(title)}</h3>
      ${rows
        .map(
          (row, index) => `
            <div class="rank-row">
              <span>${index + 1}</span>
              <strong>${escapeHtml(row.name || row.label)}</strong>
              <em>${escapeHtml(formatManwon(row[valueKey]))}</em>
            </div>
          `,
        )
        .join("")}
    </div>
  `;

  container.innerHTML = [
    instructors.length ? renderRows("강사 수업매출", instructors, "revenue") : "",
    tickets.length ? renderRows("수강권 차감매출", tickets, "value") : "",
  ].join("");
}

function renderBusinessMonth(month) {
  const snapshot = state.businessSnapshot;
  if (!snapshot) return;
  const current = snapshot.summary.find((row) => row.month === month) || snapshot.summary.at(-1);
  if (!current) return;
  const previousIndex = snapshot.summary.findIndex((row) => row.month === current.month) - 1;
  const previous = previousIndex >= 0 ? snapshot.summary[previousIndex] : null;
  const daily = latestDailyForMonth(snapshot, current.month);

  setText("businessMonthLabel", `${formatMonth(current.month)} 기준`);
  setText("businessHeroValue", `${formatManwon(current.totalRevenue)} 총매출`);
  setText(
    "businessHeroNote",
    daily ? `${daily.date} 누적 기준 · 기존 현황판 원천` : "월 summary 기준 · 기존 현황판 원천",
  );
  setText("businessTotalRevenue", formatManwon(daily?.totalRevenue || current.totalRevenue));
  setText("businessLessonRevenue", formatManwon(daily?.lessonRevenue || current.lessonRevenue));
  setText("businessMarginRate", formatRate(daily?.marginRate || current.marginRate));
  setText("businessAttendanceRate", formatRate(daily?.attendanceRate || current.attendanceRate));
  setText(
    "businessTotalDelta",
    daily?.previousTotalRevenue ? deltaText(daily.totalRevenue, daily.previousTotalRevenue) : deltaText(current.totalRevenue, previous?.totalRevenue),
  );
  setText(
    "businessLessonDelta",
    daily?.previousLessonRevenue ? deltaText(daily.lessonRevenue, daily.previousLessonRevenue) : deltaText(current.lessonRevenue, previous?.lessonRevenue),
  );
  setText(
    "businessMarginDelta",
    daily?.previousMarginRate ? deltaText(daily.marginRate, daily.previousMarginRate, "%p") : deltaText(current.marginRate, previous?.marginRate, "%p"),
  );
  setText(
    "businessAttendanceDelta",
    daily?.previousAttendanceRate
      ? deltaText(daily.attendanceRate, daily.previousAttendanceRate, "%p")
      : deltaText(current.attendanceRate, previous?.attendanceRate, "%p"),
  );
  renderBusinessBars(snapshot.summary, current.month);
  renderBusinessRanks(snapshot, current.month);
}

function renderBusiness(snapshot) {
  const select = qs("businessMonthSelect");
  if (!select) return;
  state.businessSnapshot = snapshot;
  state.businessMonths = snapshot.summary.map((row) => row.month);
  if (!state.businessMonths.length) {
    qs("businessSnapshotStatus").textContent = "데이터 없음";
    qs("businessSnapshotStatus").className = "pill warn";
    return;
  }
  select.innerHTML = [...state.businessMonths]
    .reverse()
    .map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(formatMonth(month))}</option>`)
    .join("");
  const latestMonth = state.businessMonths.at(-1);
  select.value = latestMonth;
  qs("businessSnapshotStatus").textContent = "연결됨";
  qs("businessSnapshotStatus").className = "pill good";
  setText("businessUpdatedAt", snapshot.updatedAt ? formatDate(snapshot.updatedAt) : "업데이트 확인");
  renderBusinessMonth(latestMonth);
}

function renderBusinessMemberInsights(items) {
  const list = qs("businessMemberInsightList");
  if (!list) return;
  setText("businessMemberSummary", items.length ? `${items.length}명 read-model` : "회원 지표 대기");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">member360Cards 또는 members의 누적 매출 요약을 읽지 못했습니다.</div>`;
    return;
  }
  list.innerHTML = items
    .map((item, index) => {
      const name = item.name || item.memberName || item.memberId || item.id;
      const id = item.memberId || item.id;
      const visits = item.attendedCount ? `출석 ${item.attendedCount}회` : "출석 요약 대기";
      const tickets = item.activeTicketCount ? `활성 ${item.activeTicketCount}개` : "활성 수강권 없음";
      return `
        <a class="rank-row rank-link" href="${memberDetailHref(id)}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(name)}<small>${escapeHtml(visits)} · ${escapeHtml(tickets)}</small></strong>
          <em>${escapeHtml(formatManwon(toNumber(item.totalRevenue)))}</em>
        </a>
      `;
    })
    .join("");
}

function renderHomeDecisions() {
  const list = qs("homeDecisionList");
  if (!list) return;
  const openIssues = activeQualityIssues();
  const failedAutomation = state.automationItems.filter((item) =>
    ["failed", "error", "critical", "blocked"].includes(String(item.status || item.health || "").toLowerCase()),
  );
  const rows = [
    {
      title: failedAutomation.length ? "자동화 실패 확인" : "자동화 상태 정상권",
      detail: failedAutomation.length
        ? `${failedAutomation.length}개 자동화 상태가 실패/중단으로 보입니다. Automation 탭에서 원인을 먼저 확인하세요.`
        : "최근 자동화 상태에서 실패/중단 신호는 보이지 않습니다.",
      status: failedAutomation.length ? "failed" : "success",
      href: "./automation/",
    },
    {
      title: openIssues.length ? "데이터 품질 이슈 확인" : "원본 품질 안정권",
      detail: openIssues.length
        ? `${openIssues.length}개 열린 이슈가 있습니다. 발송/쓰기 전 Imports 탭에서 매칭 상태를 확인하세요.`
        : "열린 데이터 품질 이슈가 없습니다.",
      status: openIssues.length ? "warning" : "success",
      href: "./imports/",
    },
    {
      title: "회원/알림톡은 read-only 확인",
      detail: "ARCHIVE CORE는 현재 운영 판단 콘솔입니다. 외부 발송/쓰기 원천은 기존 canonical 컬렉션을 유지합니다.",
      status: "active",
      href: "./rules/",
    },
  ];
  list.innerHTML = rows
    .map(
      (row) => `
        <a class="status-row status-link" href="${row.href}">
          <div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></div>
          ${pill(row.status)}
        </a>
      `,
    )
    .join("");
}

function renderHomeSummary() {
  if (!qs("homeMemberTotal")) return;
  const openIssues = activeQualityIssues();
  const failedAutomation = state.automationItems.filter((item) =>
    ["failed", "error", "critical", "blocked"].includes(String(item.status || item.health || "").toLowerCase()),
  );
  const activeMembers = state.members.filter((item) => toNumber(item.activeTicketCount) > 0).length;
  const pendingCandidates = state.alimtalkCandidates.filter((item) =>
    ["queued", "pending", "review", "reviewed", "processing"].includes(String(item.status || "").toLowerCase()),
  ).length;
  const latestImport = state.sourceImports[0];
  setText("homeMemberTotal", formatCount(state.members.length, "명"));
  setText("homeMemberNote", `활성 수강권 ${activeMembers.toLocaleString("ko-KR")}명 · 전체 회원 검색 가능`);
  setText("homeImportTotal", formatCount(state.sourceImports.length));
  setText(
    "homeImportNote",
    latestImport
      ? `${sourceKindLabel(latestImport.sourceKind || latestImport.kind)} · ${formatDate(latestImport.updatedAt || latestImport.importedAt)}`
      : "최근 원본 import 기록 대기",
  );
  setText("homeMessageTotal", formatCount(state.alimtalkCandidates.length));
  setText("homeMessageNote", pendingCandidates ? `${pendingCandidates}건 대기/검토 후보 확인` : "최근 후보 기준 대기 낮음");
  setText("homeAutomationTotal", failedAutomation.length ? `${failedAutomation.length}건 확인` : "정상권");
  setText("homeAutomationNote", openIssues.length ? `품질 이슈 ${openIssues.length}건과 함께 확인` : "자동화 실패/품질 위험 낮음");
}

function renderBusinessFallback(error) {
  if (!qs("businessMonthSelect")) return;
  qs("businessSnapshotStatus").textContent = error ? "권한 확인" : "대기";
  qs("businessSnapshotStatus").className = "pill warn";
  setText("businessHeroValue", "데이터 연결 대기");
  setText("businessHeroNote", error?.message || "Firestore 권한 또는 snapshot 문서 확인이 필요합니다.");
  renderBusinessMemberInsights([]);
}

function renderFallback(error) {
  const reason = error?.code === "permission-denied" ? "로그인 권한 필요" : "Firestore 읽기 실패";
  setConnection(reason, error?.message || "정적 화면으로 표시합니다.");
  renderLane({ status: "active" });
  renderAutomation([]);
  renderImports([]);
  renderQualityIssues([]);
  renderMembers([]);
  renderMessages([], []);
  renderLessons([], [], []);
  renderHomeSummary();
  renderHomeDecisions();
  renderMemberDetail(null);
  renderPrivate([], [], [], []);
  renderBusinessFallback(error);
  if (error?.code === "permission-denied") showLoginGate();
}

async function refresh() {
  const refreshButton = qs("refreshButton");
  if (refreshButton) refreshButton.disabled = true;
  setConnection("연결 중", "Firestore 읽기 확인 중");

  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      const error = new Error("운영자 로그인이 필요합니다.");
      error.code = "permission-denied";
      throw error;
    }
    const { db, doc, getDoc } = runtime;
    const shouldLoadBusiness = Boolean(qs("businessMonthSelect"));
    const shouldLoadHome = Boolean(qs("homeMemberTotal"));
    const shouldLoadMembers = Boolean(qs("membersTable"));
    const shouldLoadMessages = Boolean(qs("messagesCandidateList"));
    const shouldLoadMemberDetail = Boolean(qs("memberDetailName"));
    const shouldLoadPrivate = Boolean(qs("privateRequestList"));
    const shouldLoadLessons = Boolean(qs("lessonsTodayList"));
    const [
      laneSnapshot,
      automationItems,
      sourceImports,
      qualityIssues,
      dashboardSnapshot,
      members,
      alimtalkCandidates,
      alimtalkSends,
      memberDetail,
      businessMembers,
      privateRequests,
      privateRecords,
      privateUsageEvents,
      privateLedgerEntries,
      lessonOccurrences,
      reservations,
      deletedClassLogs,
      deletedLessons,
    ] = await Promise.all([
      getDoc(doc(db, "workLanes", WORK_LANE_ID)),
      getRecentCollection(db, runtime, "automationStatus"),
      getCollectionBy(db, runtime, "sourceImports", "updatedAt", 50),
      getCollectionBy(db, runtime, "dataQualityIssues", "updatedAt", 100),
      shouldLoadBusiness ? getDoc(doc(db, "dashboardSnapshots", "current")) : Promise.resolve(null),
      shouldLoadMembers || shouldLoadHome ? getCollectionBy(db, runtime, "member360Cards", "totalRevenue", 2000) : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome ? getRecentCollectionBy(db, runtime, "alimtalkCandidates", "updatedAt", 12) : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome ? getRecentCollectionBy(db, runtime, "alimtalkSends", "updatedAt", 12) : Promise.resolve([]),
      shouldLoadMemberDetail ? loadMemberDetail(runtime, memberDetailId()) : Promise.resolve(null),
      shouldLoadBusiness ? getRecentCollectionBy(db, runtime, "member360Cards", "totalRevenue", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateLessonChartRequests", "createdAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateLessonChartRecords", "createdAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "memberUsageEvents", "updatedAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateSessionLedger", "updatedAt", 8) : Promise.resolve([]),
      shouldLoadLessons ? getCollectionBy(db, runtime, "lessonOccurrences", "startsAt", 1000) : Promise.resolve([]),
      shouldLoadLessons ? getCollectionBy(db, runtime, "reservations", "startsAt", 1000) : Promise.resolve([]),
      shouldLoadLessons ? getCollectionBy(db, runtime, "deletedClassLogs", "updatedAt", 100) : Promise.resolve([]),
      shouldLoadLessons ? getCollectionBy(db, runtime, "deletedLessons", "updatedAt", 100) : Promise.resolve([]),
    ]);

    state.lane = laneSnapshot.exists() ? laneSnapshot.data() : { status: "active" };
    state.automationItems = automationItems;
    state.sourceImports = studioItems(sourceImports);
    state.qualityIssues = studioItems(qualityIssues);
    state.members = studioItems(members);
    state.alimtalkCandidates = alimtalkCandidates;
    state.alimtalkSends = alimtalkSends;
    state.memberDetail = memberDetail;
    state.businessMembers = businessMembers;
    state.privateRequests = privateRequests;
    state.privateRecords = privateRecords;
    state.privateUsageEvents = privateUsageEvents;
    state.privateLedgerEntries = privateLedgerEntries;
    state.lessonOccurrences = lessonOccurrences;
    state.reservations = reservations;
    state.deletedClassLogs = deletedClassLogs;
    state.deletedLessons = deletedLessons;
    renderLane(state.lane);
    renderAutomation(automationItems);
    renderImports(state.sourceImports);
    renderQualityIssues(state.qualityIssues);
    renderMembers(state.members);
    renderMessages(alimtalkCandidates, alimtalkSends);
    renderHomeSummary();
    renderHomeDecisions();
    renderMemberDetail(memberDetail);
    renderPrivate(privateRequests, privateRecords, privateUsageEvents, privateLedgerEntries);
    renderLessons(lessonOccurrences, reservations, [...deletedClassLogs, ...deletedLessons]);
    if (shouldLoadBusiness) {
      if (dashboardSnapshot?.exists()) renderBusiness(normalizeBusinessSnapshot(dashboardSnapshot.data()));
      else renderBusinessFallback(new Error("dashboardSnapshots/current 문서가 없습니다."));
      renderBusinessMemberInsights(businessMembers);
    }
    setConnection("연결됨", `archive-pilates · ${formatDate(new Date())}`);
  } catch (error) {
    renderFallback(error);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

enhanceNav();
activateNav();
qs("refreshButton")?.addEventListener("click", refresh);
qs("businessMonthSelect")?.addEventListener("change", (event) => renderBusinessMonth(event.target.value));
qs("memberSearchInput")?.addEventListener("input", (event) => {
  memberSearchTerm = event.target.value.trim();
  memberPage = 1;
  renderMembers(state.members);
});
document.querySelectorAll("[data-member-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    memberFilter = button.dataset.memberFilter || "all";
    memberPage = 1;
    renderMembers(state.members);
  });
});
qs("memberPagination")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-member-page]");
  if (!button) return;
  const action = button.dataset.memberPage;
  memberPage += action === "next" ? 1 : -1;
  renderMembers(state.members);
});
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-business-month]");
  if (!target) return;
  const month = target.getAttribute("data-business-month");
  const select = qs("businessMonthSelect");
  if (select) select.value = month;
  renderBusinessMonth(month);
});
if (document.querySelector("[data-firestore-dashboard]")) refresh();
