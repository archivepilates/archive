const FIREBASE_APP_VERSION = "10.14.1";
const WORK_LANE_ID = "archive-core-transition";

const state = {
  firebaseRuntime: null,
  automationItems: [],
  sourceImports: [],
  qualityIssues: [],
  businessSnapshot: null,
  businessMonths: [],
  members: [],
  privateRequests: [],
  privateRecords: [],
  privateUsageEvents: [],
  privateLedgerEntries: [],
  lane: null,
  authReady: null,
};

function qs(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = qs(id);
  if (element) element.textContent = value;
}

function formatDate(value) {
  if (!value) return "-";
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

function formatRate(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
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

function renderLane(lane) {
  setText("laneStatus", statusLabel(lane?.status || "active"));
  setText(
    "laneUpdated",
    lane?.updatedAt ? `${formatDate(lane.updatedAt)} 업데이트` : "workLanes/archive-core-transition",
  );
}

function renderAutomation(items) {
  const automationMode = qs("automationMode");
  if (automationMode) {
    automationMode.textContent = items.length ? "연결" : "대기";
    automationMode.className = `pill ${items.length ? "good" : "warn"}`;
  }

  const list = qs("automationList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">automationStatus 문서가 아직 없거나 권한 확인이 필요합니다.</div>`;
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const name = item.title || item.name || item.id;
      const detail = item.summary || item.message || item.lastResult || item.description || "상세 기록 없음";
      const updated = formatDate(item.updatedAt || item.lastRunAt || item.checkedAt);
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(detail)} · ${escapeHtml(updated)}</p>
          </div>
          ${pill(item.status || item.health)}
        </div>
      `;
    })
    .join("");
}

function renderImports(items) {
  setText("importCount", String(items.length));
  const table = qs("importsTable");
  if (!table) return;
  if (!items.length) {
    table.innerHTML = `<tr><td colspan="4">최근 sourceImports 문서가 없거나 권한 확인이 필요합니다.</td></tr>`;
    return;
  }

  table.innerHTML = items
    .map((item) => {
      const source = item.sourceKind || item.kind || item.fileName || item.id;
      const rows = item.importedRows ?? item.rowCount ?? item.rows ?? "-";
      const updated = formatDate(item.updatedAt || item.importedAt || item.createdAt);
      return `
        <tr>
          <td>${escapeHtml(source)}</td>
          <td>${pill(item.status || item.importStatus)}</td>
          <td>${escapeHtml(rows)}</td>
          <td>${escapeHtml(updated)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderQualityIssues(items) {
  const activeIssues = items.filter((item) => !["resolved", "closed", "done"].includes(String(item.status || "").toLowerCase()));
  setText("qualityCount", String(activeIssues.length));

  const list = qs("qualityList");
  if (!list) return;
  if (!activeIssues.length) {
    list.innerHTML = `<div class="empty-state">열린 데이터 품질 이슈가 없습니다. 연결 전이면 권한 확인이 필요합니다.</div>`;
    return;
  }

  list.innerHTML = activeIssues
    .map((item) => {
      const title = item.title || item.issueType || item.id;
      const detail = item.summary || item.description || item.memberName || "상세 기록 없음";
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(detail)}</p>
          </div>
          ${pill(item.severity || item.status)}
        </div>
      `;
    })
    .join("");
}

function renderMembers(items) {
  const table = qs("membersTable");
  if (!table) return;
  setText("membersVisibleCount", String(items.length));
  setText("membersActiveTicketCount", String(items.filter((item) => toNumber(item.activeTicketCount) > 0).length));
  setText("membersRecentVisitCount", String(items.filter((item) => item.recentVisitAt).length));
  setText("membersRevenueCount", String(items.filter((item) => toNumber(item.totalRevenue) > 0).length));

  if (!items.length) {
    table.innerHTML = `<tr><td colspan="4">최근 members 문서가 없거나 권한 확인이 필요합니다.</td></tr>`;
    return;
  }

  table.innerHTML = items
    .map((item) => {
      const ticketNames = (item.currentTicketsSummary || item.activeTicketNames || [])
        .map((ticket) => (typeof ticket === "string" ? ticket : ticket.name))
        .filter(Boolean)
        .slice(0, 2);
      const ticketText = ticketNames.length ? ticketNames.join(", ") : "활성 수강권 없음";
      const phone = item.phoneLast4 ? ` · ${item.phoneLast4}` : "";
      return `
        <tr>
          <td><strong>${escapeHtml(item.name || item.memberId || item.id)}</strong><br><span>${escapeHtml(item.memberId || item.id)}${escapeHtml(phone)}</span></td>
          <td>${escapeHtml(ticketText)}<br><span>${escapeHtml(toNumber(item.activeTicketCount) ? `${item.activeTicketCount}개` : "0개")}</span></td>
          <td>${escapeHtml(formatDate(item.recentVisitAt))}</td>
          <td>${escapeHtml(formatManwon(toNumber(item.totalRevenue)))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPrivate(requests, records, usageEvents, ledgerEntries) {
  if (!qs("privateRequestList")) return;
  setText("privateRequestCount", String(requests.length));
  setText("privateRecordCount", String(records.length));
  setText("privateUsageCount", String(usageEvents.length));
  setText("privateLedgerCount", String(ledgerEntries.length));

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

function renderBusinessFallback(error) {
  if (!qs("businessMonthSelect")) return;
  qs("businessSnapshotStatus").textContent = error ? "권한 확인" : "대기";
  qs("businessSnapshotStatus").className = "pill warn";
  setText("businessHeroValue", "데이터 연결 대기");
  setText("businessHeroNote", error?.message || "Firestore 권한 또는 snapshot 문서 확인이 필요합니다.");
}

function renderFallback(error) {
  const reason = error?.code === "permission-denied" ? "로그인 권한 필요" : "Firestore 읽기 실패";
  setConnection(reason, error?.message || "정적 화면으로 표시합니다.");
  renderLane({ status: "active" });
  renderAutomation([]);
  renderImports([]);
  renderQualityIssues([]);
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
    const shouldLoadMembers = Boolean(qs("membersTable"));
    const shouldLoadPrivate = Boolean(qs("privateRequestList"));
    const [
      laneSnapshot,
      automationItems,
      sourceImports,
      qualityIssues,
      dashboardSnapshot,
      members,
      privateRequests,
      privateRecords,
      privateUsageEvents,
      privateLedgerEntries,
    ] = await Promise.all([
      getDoc(doc(db, "workLanes", WORK_LANE_ID)),
      getRecentCollection(db, runtime, "automationStatus"),
      getRecentCollection(db, runtime, "sourceImports"),
      getRecentCollection(db, runtime, "dataQualityIssues", 12),
      shouldLoadBusiness ? getDoc(doc(db, "dashboardSnapshots", "current")) : Promise.resolve(null),
      shouldLoadMembers ? getRecentCollection(db, runtime, "members", 12) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateLessonChartRequests", "createdAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateLessonChartRecords", "createdAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "memberUsageEvents", "updatedAt", 8) : Promise.resolve([]),
      shouldLoadPrivate ? getRecentCollectionBy(db, runtime, "privateSessionLedger", "updatedAt", 8) : Promise.resolve([]),
    ]);

    state.lane = laneSnapshot.exists() ? laneSnapshot.data() : { status: "active" };
    state.automationItems = automationItems;
    state.sourceImports = sourceImports;
    state.qualityIssues = qualityIssues;
    state.members = members;
    state.privateRequests = privateRequests;
    state.privateRecords = privateRecords;
    state.privateUsageEvents = privateUsageEvents;
    state.privateLedgerEntries = privateLedgerEntries;
    renderLane(state.lane);
    renderAutomation(automationItems);
    renderImports(sourceImports);
    renderQualityIssues(qualityIssues);
    renderMembers(members);
    renderPrivate(privateRequests, privateRecords, privateUsageEvents, privateLedgerEntries);
    if (shouldLoadBusiness) {
      if (dashboardSnapshot?.exists()) renderBusiness(normalizeBusinessSnapshot(dashboardSnapshot.data()));
      else renderBusinessFallback(new Error("dashboardSnapshots/current 문서가 없습니다."));
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
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-business-month]");
  if (!target) return;
  const month = target.getAttribute("data-business-month");
  const select = qs("businessMonthSelect");
  if (select) select.value = month;
  renderBusinessMonth(month);
});
if (document.querySelector("[data-firestore-dashboard]")) refresh();
