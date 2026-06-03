const FIREBASE_APP_VERSION = "10.14.1";
const WORK_LANE_ID = "archive-core-transition";

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  connectionLabel: document.getElementById("connectionLabel"),
  connectionDetail: document.getElementById("connectionDetail"),
  laneStatus: document.getElementById("laneStatus"),
  laneUpdated: document.getElementById("laneUpdated"),
  importCount: document.getElementById("importCount"),
  qualityCount: document.getElementById("qualityCount"),
  automationMode: document.getElementById("automationMode"),
  automationList: document.getElementById("automationList"),
  importsTable: document.getElementById("importsTable"),
  qualityList: document.getElementById("qualityList"),
};

let firebaseRuntime = null;

function setConnection(label, detail) {
  elements.connectionLabel.textContent = label;
  elements.connectionDetail.textContent = detail;
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
  };
  return labels[status] || value || "확인";
}

function pill(value) {
  const tone = normalizeStatus(value);
  return `<span class="pill ${tone}">${statusLabel(value)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initFirebase() {
  if (firebaseRuntime) return firebaseRuntime;
  const config = window.KANGSAIN_FIREBASE_CONFIG;
  if (!config?.apiKey) {
    throw new Error("Firebase 설정을 찾을 수 없습니다.");
  }

  const [{ initializeApp, getApps }, firestore] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-firestore.js`),
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  firebaseRuntime = {
    db: firestore.getFirestore(app),
    ...firestore,
  };
  return firebaseRuntime;
}

async function getRecentCollection(db, firestore, collectionName, maxItems = 8) {
  try {
    const queryRef = firestore.query(
      firestore.collection(db, collectionName),
      firestore.orderBy("updatedAt", "desc"),
      firestore.limit(maxItems),
    );
    const snapshot = await firestore.getDocs(queryRef);
    return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  } catch (error) {
    if (String(error?.code || error?.message || "").includes("permission")) throw error;
    const snapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    return snapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, maxItems);
  }
}

function renderLane(lane) {
  elements.laneStatus.textContent = statusLabel(lane?.status || "active");
  elements.laneUpdated.textContent = lane?.updatedAt
    ? `${formatDate(lane.updatedAt)} 업데이트`
    : "workLanes/archive-core-transition";
}

function renderAutomation(items) {
  elements.automationMode.textContent = items.length ? "연결" : "대기";
  elements.automationMode.className = `pill ${items.length ? "good" : "warn"}`;

  if (!items.length) {
    elements.automationList.innerHTML = `<div class="empty-state">automationStatus 문서가 아직 없거나 권한 확인이 필요합니다.</div>`;
    return;
  }

  elements.automationList.innerHTML = items
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
  elements.importCount.textContent = String(items.length);
  if (!items.length) {
    elements.importsTable.innerHTML = `<tr><td colspan="4">최근 sourceImports 문서가 없거나 권한 확인이 필요합니다.</td></tr>`;
    return;
  }

  elements.importsTable.innerHTML = items
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
  elements.qualityCount.textContent = String(activeIssues.length);

  if (!activeIssues.length) {
    elements.qualityList.innerHTML = `<div class="empty-state">열린 데이터 품질 이슈가 없습니다. 연결 전이면 권한 확인이 필요합니다.</div>`;
    return;
  }

  elements.qualityList.innerHTML = activeIssues
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

function renderPermissionFallback(error) {
  const reason = error?.code === "permission-denied" ? "로그인 권한 필요" : "Firestore 읽기 실패";
  setConnection(reason, error?.message || "정적 화면으로 표시합니다.");
  renderLane({ status: "active" });
  renderAutomation([]);
  renderImports([]);
  renderQualityIssues([]);
}

async function refresh() {
  elements.refreshButton.disabled = true;
  setConnection("연결 중", "Firestore 읽기 확인 중");

  try {
    const runtime = await initFirebase();
    const { db, doc, getDoc } = runtime;

    const [laneSnapshot, automationItems, sourceImports, qualityIssues] = await Promise.all([
      getDoc(doc(db, "workLanes", WORK_LANE_ID)),
      getRecentCollection(db, runtime, "automationStatus"),
      getRecentCollection(db, runtime, "sourceImports"),
      getRecentCollection(db, runtime, "dataQualityIssues", 12),
    ]);

    renderLane(laneSnapshot.exists() ? laneSnapshot.data() : { status: "active" });
    renderAutomation(automationItems);
    renderImports(sourceImports);
    renderQualityIssues(qualityIssues);
    setConnection("연결됨", `archive-pilates · ${formatDate(new Date())}`);
  } catch (error) {
    renderPermissionFallback(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton?.addEventListener("click", refresh);
refresh();
