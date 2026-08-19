const FIREBASE_APP_VERSION = "10.14.1";
const CORE_RUNTIME_CONTRACT_VERSION = "2026-08-04.1";
const WORK_LANE_ID = "archive-core-transition";
const STUDIO_ID = "5330";

const ALIMTALK_TEMPLATE_LABELS_BY_CODE = Object.freeze({
  KA01TP260514145047261araXgWLVFRs: "그룹 기간권 잔여기간 안내 v3",
  KA01TP260514145047393VpTbcCZKkCV: "그룹 횟수권 잔여횟수 안내 v3",
  KA01TP260514152235608d9icGOBotnV: "프라이빗 횟수권 잔여횟수 안내 v1",
  KA01TP260514153314927WH270IppWQS: "프라이빗 기간권 잔여기간 안내 v1",
  KA01TP260514153632171uiWXYoeiOLS: "프라이빗 사전설문 안내 v1 (미사용)",
  KA01TP260519093416836f1EHZYJ00uM: "담당강사 사전설문 제출 안내 v1",
  KA01TP260808034937468FF5LLYH823H: "담당강사 사전설문 제출 안내 v2",
  KA01TP2605210729364330NbhZVAu9zA: "그룹 첫 수업 사전확인 안내 v1",
  KA01TP260521120040094XcMvYgFTryj: "강사레슨 수업자료 안내 v1",
  KA01TP260522041704111wu4Z0cu9cgl: "첫 그룹수업 회원 확인 v1",
  KA01TP260524083643752cySb9BoDOjN: "장기 미방문 수업안내 v1",
  KA01TP260527182741301uIuSTL01YQ1: "강사용 프라이빗 차트 작성 안내 v2 (미사용)",
  KA01TP260528081225871Fr92FW901Vo: "프라이빗 회원 리포트 안내 v1",
  KA01TP260528090148593isshfXtt8vE: "회원용 인바디 리포트 안내 v1",
  KA01TP260602101939427lPhGyuDLvFM: "신규회원 웰컴 v5",
  KA01TP260611053817155zqYlw27wEOU: "회원용 수강료 안내 링크 v1",
  KA01TP26072806273194229P2ZesQwPp: "스튜디오메이트 예약 안내 v4",
  KA01TP260728111926523p2JzzTgHsS8: "아카이브 추천식단 프로그램 v1 (삭제됨)",
  KA01TP260802163827071E2TTuX6CsWp: "아카이브 추천식단 프로그램 v2",
  KA01TP260731123545629Sx4N5CZa5BF: "아카이브 추천식단 도착 안내 v1 (미사용)",
  KA01TP260729144645970fv13He8mfsK: "프라이빗 사전설문 안내 v2",
  KA01TP260729144657202OV26yAD15wR: "강사용 프라이빗 차트 작성 안내 v3",
});

const ALIMTALK_TEMPLATE_LABELS_BY_TYPE = Object.freeze({
  reservation_open: "스튜디오메이트 예약 안내",
  new_member: "신규회원 안내",
  onsite_welcome: "신규회원 웰컴",
  ticket_expiring: "그룹 기간권 잔여기간 안내",
  remaining_low: "그룹 횟수권 잔여횟수 안내",
  private_count_low: "프라이빗 횟수권 잔여횟수 안내",
  private_survey: "프라이빗 사전설문 안내",
  group_survey: "그룹 첫 수업 사전확인 안내",
  private_ticket_expiring: "프라이빗 기간권 잔여기간 안내",
  long_absence: "장기 미방문 수업안내",
  staff_private_survey: "담당강사 사전설문 제출 안내",
  staff_private_chart: "강사용 프라이빗 차트 작성 안내",
  staff_group_survey: "첫 그룹수업 회원 확인",
  instructor_lesson_material: "강사레슨 수업자료 안내",
  private_lesson_report: "프라이빗 회원 리포트 안내",
  inbody_report: "회원용 인바디 리포트 안내",
  pricing_info: "회원용 수강료 안내",
  recommended_meal_survey: "아카이브 추천식단 프로그램 v2",
});

const state = {
  firebaseRuntime: null,
  automationItems: [],
  sourceImports: [],
  qualityIssues: [],
  businessSnapshot: null,
  businessMonths: [],
  businessMembers: [],
  ticketLiabilityReports: [],
  members: [],
  memberCards: [],
  memberProfiles: [],
  renewalCases: [],
  memberDetail: null,
  alimtalkCandidates: [],
  alimtalkSends: [],
  onsiteWelcomeRequests: [],
  memberSignupContracts: [],
  pricingInquiryAlimtalkRequests: [],
  recommendedMealProgramRequests: [],
  recommendedMealReview: null,
  refundCases: [],
  parkingVehicles: [],
  parkingJobs: [],
  parkingConfig: null,
  staffItems: [],
  staffHrCards: [],
  staffEvaluationSubmissions: [],
  staffEvaluationRows: [],
  instructorEvaluationQuiz: null,
  instructorEvaluationTargets: [],
  privateRequests: [],
  privateRecords: [],
  privateLedgerEntries: [],
  privateSessions: [],
  lessonOccurrences: [],
  bookings: [],
  reservations: [],
  deletedClassLogs: [],
  deletedLessons: [],
  instagramDashboard: null,
  lane: null,
  authReady: null,
  readWarnings: [],
  readStates: {},
};

let memberSearchTerm = "";
let memberFilter = "all";
let memberPage = 1;
let selectedStaffKey = "";
let selectedMealRequestId = "";
let mealQueueFilter = "active";
let refundFlow = { member: null, tickets: [], selectedTicket: null, preview: null };

const MEMBER_PAGE_SIZE = 20;
const COMMAND_ITEMS = [
  {
    title: "회원 검색",
    detail: "회원명, 전화번호, 수강권, 최근 방문 확인",
    href: "./members/",
    keywords: "member 회원 검색 전화번호 수강권 방문",
  },
  {
    title: "수강료 안내 발송",
    detail: "문의 전화번호 입력 후 승인 템플릿으로 즉시 발송",
    href: "#pricingInquiry",
    keywords: "수강료 가격 문의 알림톡 발송 상담",
  },
  {
    title: "추천식단 관리",
    detail: "설문·InBody 기반 식단 초안 검토와 승인 발송",
    href: "./recommended-meals/",
    keywords: "추천식단 식단 다이어트 설문 인바디 검토 발송 alimtalk",
  },
  {
    title: "환불 안내·동의서",
    detail: "회원 수강권 환불 예상액 검토와 이폼싸인 발송",
    href: "./refunds/",
    keywords: "refund 환불 수강권 동의서 이폼싸인",
  },
  {
    title: "재등록 관리",
    detail: "만료 임박, 잔여 부족, 재등록 대기 회원 확인",
    href: "#renewalPipeline",
    keywords: "renewal 재등록 만료 잔여 수강권 상담",
  },
  {
    title: "주차등록",
    detail: "회원/강사 차량 등록과 오늘 자동 주차권 적용",
    href: "#parkingTools",
    keywords: "parking 주차 차량 등록 할인권 아이파킹",
  },
  {
    title: "프라이빗 진행",
    detail: "사전 설문, 사후 설문, 리포트, 발송 단계 확인",
    href: "./private/",
    keywords: "private 프라이빗 차트 리포트 설문 회차",
  },
  {
    title: "알림톡 확인",
    detail: "후보, 발송, 실패, 대기 상태 확인",
    href: "./messages/",
    keywords: "alimtalk 알림톡 실패 후보 발송 카카오",
  },
  {
    title: "Instagram 콘텐츠",
    detail: "게시물 초안, 승인, 예약 발행, 성과 확인",
    href: "./content/",
    keywords: "instagram 인스타그램 콘텐츠 게시물 릴스 예약 발행",
  },
  {
    title: "자동화 관제",
    detail: "실패, 지연, 중복 실행 확인",
    href: "./automation/",
    keywords: "automation 자동화 launchagent 실패 지연",
  },
  {
    title: "수강권 잔여금액",
    detail: "월말 수강권별 환산 잔여횟수와 잔여금액 확인",
    href: "./business/#ticketLiability",
    keywords: "ticket liability 수강권 잔여금액 잔여횟수 월말",
  },
  {
    title: "운영규칙",
    detail: "현재 유효한 운영 규칙과 데이터 기준 확인",
    href: "./rules/",
    keywords: "rules 규칙 운영규칙 데이터 정책",
  },
  {
    title: "원본 데이터",
    detail: "회원목록, 예약내역, 삭제 수업 import 상태 확인",
    href: "./imports/",
    keywords: "imports 원본 데이터 엑셀 예약 회원목록",
  },
  {
    title: "강사 인사기록",
    detail: "강사 평가, 퀴즈, 월별 지표 확인",
    href: "./staff/",
    keywords: "staff 강사 평가 인사기록 퀴즈",
  },
];

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
  const ms = timestampMs(value);
  const raw = ms ? new Date(ms) : typeof value?.toDate === "function" ? value.toDate() : new Date(value);
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

function memberCountDeltaText(current, previous, label = "전년동월") {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return `${label} 비교 대기`;
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  const marker = diff >= 0 ? "▲" : "▼";
  const sign = diff >= 0 ? "+" : "";
  return `${marker} ${sign}${diff.toLocaleString("ko-KR")}명 · ${sign}${percent.toFixed(1)}% vs ${label}`;
}

function normalizeStatus(value) {
  const status = String(value || "unknown").toLowerCase();
  if (["success", "ok", "healthy", "done", "active", "completed", "sent", "eligible", "published"].includes(status)) return "good";
  if (["failed", "error", "critical", "blocked"].includes(status)) return "danger";
  if (
    ["running", "pending", "warning", "review", "manual_review", "review_needed", "stale", "queued", "skipped", "template_pending", "held", "publishing", "blocked_config"].includes(status)
  )
    return "warn";
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
    manual_review: "수동확인",
    eligible: "적용가능",
    queued: "대기",
    sent: "발송완료",
    skipped: "차단",
    template_pending: "승인대기",
    submitted: "제출",
    passed: "합격",
    review_needed: "검토필요",
    pre_submitted: "사전 제출",
    post_submitted: "사후 제출",
    draft_created: "초안 생성",
    draft: "초안",
    review: "승인 필요",
    held: "보류",
    publishing: "발행 중",
    published: "발행 완료",
    blocked_config: "연결 필요",
    cancelled: "취소",
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

const READ_TIMESTAMP_FIELDS = [
  "sourceUpdatedAt",
  "syncedAt",
  "updatedAt",
  "importedAt",
  "rebuiltAt",
  "generatedAt",
  "submittedAt",
  "createdAt",
];

function readValueCount(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value?.exists === "function") return value.exists() ? 1 : 0;
  return value === null || value === undefined ? 0 : 1;
}

function readValueRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value?.exists === "function" && value.exists()) return [value.data()];
  return [];
}

function latestReadSourceMs(value) {
  return readValueRows(value).reduce((latest, item) => {
    const itemLatest = READ_TIMESTAMP_FIELDS.reduce((current, field) => Math.max(current, timestampMs(item?.[field])), 0);
    return Math.max(latest, itemLatest);
  }, 0);
}

function setReadState(label, status, details = {}) {
  state.readStates[label] = {
    label,
    status,
    checkedAt: Date.now(),
    count: details.count ?? 0,
    sourceUpdatedAtMs: details.sourceUpdatedAtMs ?? 0,
    message: details.message || "",
  };
}

function readState(label) {
  return state.readStates[label] || { label, status: "idle", count: 0, sourceUpdatedAtMs: 0, message: "" };
}

function readUnavailable(label) {
  return ["unavailable", "permission-denied"].includes(readState(label).status);
}

function hoursSince(value) {
  const ms = Number(value || 0);
  return ms ? Math.max(0, (Date.now() - ms) / (60 * 60 * 1000)) : Number.POSITIVE_INFINITY;
}

function sourceAgeText(value) {
  const ageHours = hoursSince(value);
  if (!Number.isFinite(ageHours)) return "원본 시각 없음";
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))}분 전`;
  if (ageHours < 48) return `${Math.round(ageHours)}시간 전`;
  return `${Math.round(ageHours / 24)}일 전`;
}

function currentReadRequirements() {
  if (qs("lessonsTodayList")) return [{ label: "bookings", title: "예약 원본", staleAfterHours: 30 }];
  if (qs("membersTable")) {
    return [
      { label: "memberProfiles", title: "회원 원본", staleAfterHours: 30 },
      { label: "member360Cards", title: "회원 요약", staleAfterHours: 72 },
    ];
  }
  if (qs("staffHrList")) {
    return [
      { label: "staffs", title: "강사 명단", staleAfterHours: 24 * 14 },
      { label: "dashboardSnapshots/current", title: "강사 지표", staleAfterHours: 24 * 35 },
    ];
  }
  if (qs("messagesCandidateList")) {
    return [
      { label: "alimtalkCandidates", title: "알림톡 후보", staleAfterHours: null },
      { label: "alimtalkSends", title: "알림톡 발송", staleAfterHours: null },
    ];
  }
  if (qs("privateProgressList")) {
    return [{ label: "privateLessonChartRequests", title: "프라이빗 진행", staleAfterHours: 48 }];
  }
  if (qs("homeDecisionList")) {
    return [
      { label: "automationStatus", title: "자동화 상태", staleAfterHours: 30 },
      { label: "sourceImports", title: "StudioMate 원본", staleAfterHours: 36 },
      { label: "memberProfiles", title: "회원 원본", staleAfterHours: 30 },
    ];
  }
  return [];
}

function renderReadHealth() {
  const requirements = currentReadRequirements();
  if (!requirements.length) {
    setConnection(state.readWarnings.length ? "부분 연결" : "연결됨", `화면 조회 ${formatDate(new Date())}`);
    return;
  }

  const unavailable = requirements.filter((item) => readUnavailable(item.label));
  if (unavailable.length) {
    document.body.dataset.sourceHealth = "unavailable";
    setConnection(
      "원본 확인 필요",
      `${unavailable.map((item) => item.title).join(", ")} 읽기 실패 · 화면의 0은 확정값이 아닙니다.`,
    );
    return;
  }

  const stale = requirements
    .map((item) => ({ ...item, state: readState(item.label) }))
    .filter(
      (item) =>
        Number.isFinite(item.staleAfterHours) &&
        item.state.count > 0 &&
        hoursSince(item.state.sourceUpdatedAtMs) > item.staleAfterHours,
    )
    .sort((a, b) => hoursSince(b.state.sourceUpdatedAtMs) - hoursSince(a.state.sourceUpdatedAtMs));
  if (stale.length) {
    const oldest = stale[0];
    document.body.dataset.sourceHealth = "stale";
    setConnection("원본 지연", `${oldest.title} ${sourceAgeText(oldest.state.sourceUpdatedAtMs)} · 최신화 전 외부 판단 보류`);
    return;
  }

  const nonEmpty = requirements
    .map((item) => ({ ...item, state: readState(item.label) }))
    .filter((item) => item.state.count > 0)
    .sort((a, b) => b.state.sourceUpdatedAtMs - a.state.sourceUpdatedAtMs);
  document.body.dataset.sourceHealth = nonEmpty.length ? "current" : "empty";
  if (!nonEmpty.length) {
    setConnection("조회 완료 · 0건", "원본 읽기는 성공했고 현재 표시할 기록이 없습니다.");
    return;
  }
  const latest = nonEmpty[0];
  setConnection("원본 연결됨", `${latest.title} ${sourceAgeText(latest.state.sourceUpdatedAtMs)} · 화면 조회 ${formatDate(new Date())}`);
}

function commandSearchText(item) {
  return [item.title, item.detail, item.keywords, item.phone, item.memberName, item.name, item.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function commandPaletteEntries() {
  const memberEntries = state.members.slice(0, 80).map((member) => {
    const memberId = member.memberId || member.id || "";
    const name = member.name || member.memberName || memberId || "회원";
    const phone = normalizePhone(member.phone || member.memberPhone || "");
    const ticketCount = toNumber(member.activeTicketCount || member.currentTicketsSummary?.activeCount);
    return {
      title: `${name} 회원`,
      detail: `${phone ? formatPhoneNumber(phone) : "전화번호 없음"} · 활성 수강권 ${ticketCount.toLocaleString("ko-KR")}개`,
      href: memberId ? `./members/detail/?id=${encodeURIComponent(memberId)}` : "./members/",
      keywords: "member 회원 상세 수강권 방문",
      phone,
      memberName: name,
      id: memberId,
    };
  });
  return [...COMMAND_ITEMS, ...memberEntries];
}

function renderCommandPaletteResults() {
  const list = qs("commandPaletteResults");
  const input = qs("commandPaletteInput");
  if (!list) return;
  const term = String(input?.value || "").trim().toLowerCase();
  const entries = commandPaletteEntries()
    .filter((item) => !term || commandSearchText(item).includes(term))
    .slice(0, 9);
  if (!entries.length) {
    list.innerHTML = `<div class="command-palette-empty">검색 결과가 없습니다. 회원명, 전화번호 끝자리, 메뉴명을 다시 입력하세요.</div>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (item) => `
        <a href="${escapeHtml(item.href)}">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </a>
      `,
    )
    .join("");
}

function openCommandPalette() {
  const palette = qs("commandPalette");
  const input = qs("commandPaletteInput");
  if (!palette || !input) return;
  palette.hidden = false;
  palette.classList.add("open");
  renderCommandPaletteResults();
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 20);
}

function closeCommandPalette() {
  const palette = qs("commandPalette");
  if (!palette) return;
  palette.classList.remove("open");
  palette.hidden = true;
}

function setRuleSectionOpen(section, open) {
  if (!section) return;
  section.classList.toggle("is-collapsed", !open);
  const button = section.querySelector(":scope > .panel-header .reference-toggle");
  if (!button) return;
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "접기" : "보기";
}

function enhanceRuleSections() {
  document.querySelectorAll(".rule-section").forEach((section) => {
    const header = section.querySelector(":scope > .panel-header");
    if (!header || header.querySelector(".reference-toggle")) return;
    const button = document.createElement("button");
    button.className = "reference-toggle";
    button.type = "button";
    button.addEventListener("click", () => setRuleSectionOpen(section, section.classList.contains("is-collapsed")));
    header.appendChild(button);
    setRuleSectionOpen(section, window.location.hash === `#${section.id}`);
  });
}

function revealHashTarget() {
  const id = window.location.hash.replace(/^#/, "");
  if (!id) return;
  const target = document.getElementById(id);
  if (target?.classList?.contains("rule-section")) setRuleSectionOpen(target, true);
  const details = target?.matches?.("details") ? target : target?.closest?.("details");
  if (details) details.open = true;
}

const NAV_ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h14V10M9 20v-6h6v6",
  members: "M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 19v-1a3 3 0 0 0-3-3h-1.2M15 5.2a2.8 2.8 0 0 1 0 5.6",
  lessons: "M4 6.5h16M4 12h16M4 17.5h9M8 4v16M16 4v10",
  private: "M5 4h14v16H5zM8 8h8M8 12h5M8 16h7",
  "recommended-meals": "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5",
  refunds: "M4 7h16M7 4v6M17 4v6M6 11h12v9H6zM9 15h6",
  staff: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0M17.5 7.5l1.5 1.5 3-3",
  messages: "M4 6h16v11H8l-4 3V6zM8 10h8M8 14h5",
  content: "M5 4h14v16H5zM8 8h8M8 12h5M8 16h7M16.5 15.5l2.5 2.5",
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

const SECONDARY_NAV_SECTIONS = new Set(["automation", "business", "imports", "rules", "settings"]);
const NAV_LABELS = {
  home: "홈",
  members: "회원",
  lessons: "수업",
  private: "프라이빗",
  "recommended-meals": "추천식단",
  refunds: "환불",
  staff: "강사",
  messages: "알림톡",
  content: "콘텐츠",
  automation: "자동화",
  business: "경영",
  imports: "원본",
  rules: "운영규칙",
  settings: "설정",
};

function setAdminNavOpen(open) {
  document.body.classList.toggle("admin-nav-open", open);
  const button = document.querySelector(".nav-more-button");
  if (!button) return;
  button.setAttribute("aria-expanded", String(open));
  const label = button.querySelector(".nav-label span");
  if (label) label.textContent = open ? "관리 메뉴 닫기" : "관리 메뉴";
}

function enhanceNav() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  if (!nav.querySelector('[data-section="recommended-meals"]')) {
    const homeHref = nav.querySelector('[data-section="home"]')?.getAttribute("href") || "./";
    const link = document.createElement("a");
    link.href = `${homeHref.replace(/\/?$/, "/")}recommended-meals/`;
    link.dataset.section = "recommended-meals";
    link.innerHTML = "Meals <small>추천식단</small>";
    const before = nav.querySelector('[data-section="messages"]');
    nav.insertBefore(link, before || null);
  }
  if (!nav.querySelector('[data-section="refunds"]')) {
    const homeHref = nav.querySelector('[data-section="home"]')?.getAttribute("href") || "./";
    const link = document.createElement("a");
    link.href = `${homeHref.replace(/\/?$/, "/")}refunds/`;
    link.dataset.section = "refunds";
    link.innerHTML = "Refund <small>환불</small>";
    const before = nav.querySelector('[data-section="messages"]');
    nav.insertBefore(link, before || null);
  }
  const links = [...nav.querySelectorAll("a")];
  links.forEach((link) => {
    if (link.dataset.enhanced === "true") return;
    const section = link.dataset.section || "home";
    const small = link.querySelector("small")?.textContent?.trim() || "";
    const label = [...link.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    const title = NAV_LABELS[section] || small || label || section;
    link.setAttribute("aria-label", title);
    link.removeAttribute("title");
    link.innerHTML = `
      ${navIcon(section)}
      <span class="nav-label">
        <span>${escapeHtml(title)}</span>
      </span>
    `;
    if (SECONDARY_NAV_SECTIONS.has(section)) link.classList.add("nav-secondary");
    link.dataset.enhanced = "true";
  });

  if (!nav.querySelector(".nav-more-button")) {
    const firstSecondary = nav.querySelector(".nav-secondary");
    const button = document.createElement("button");
    button.className = "nav-more-button";
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "관리 메뉴");
    button.innerHTML = `
      ${navIcon("settings")}
      <span class="nav-label"><span>관리 메뉴</span></span>
    `;
    button.addEventListener("click", () => setAdminNavOpen(!document.body.classList.contains("admin-nav-open")));
    nav.insertBefore(button, firstSecondary);
  }
}

function activateNav() {
  const path = window.location.pathname.replace(/\/+$/, "");
  let secondaryPage = false;
  document.querySelectorAll(".nav a").forEach((link) => {
    const href = new URL(link.getAttribute("href"), window.location.href);
    const hrefPath = href.pathname.replace(/\/+$/, "");
    const isRoot = link.dataset.section === "home" && (path.endsWith("/core") || path === "");
    const isActive = isRoot || (link.dataset.section && hrefPath && path.endsWith(hrefPath));
    if (isActive) {
      link.setAttribute("aria-current", "page");
      secondaryPage ||= SECONDARY_NAV_SECTIONS.has(link.dataset.section);
    }
    else link.removeAttribute("aria-current");
  });
  setAdminNavOpen(secondaryPage);
}

async function initFirebase() {
  if (state.firebaseRuntime) return state.firebaseRuntime;
  const config = window.KANGSAIN_FIREBASE_CONFIG;
  if (!config?.apiKey) throw new Error("Firebase 설정을 찾을 수 없습니다.");

  const [{ initializeApp, getApps }, firestore, auth, functions] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_APP_VERSION}/firebase-functions.js`),
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  state.firebaseRuntime = {
    app,
    db: firestore.getFirestore(app),
    authClient: auth.getAuth(app),
    functionsClient: functions.getFunctions(app, config.functionsRegion || "asia-northeast3"),
    httpsCallable: functions.httpsCallable,
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

function hideLoginGate() {
  const gate = qs("coreLoginGate");
  if (gate) gate.classList.remove("on");
}

async function waitForAuth(runtime) {
  if (runtime.authClient.currentUser) return runtime.authClient.currentUser;
  if (!state.authReady) {
    state.authReady = new Promise((resolve) => {
      const unsubscribe = runtime.auth.onAuthStateChanged(runtime.authClient, (user) => {
        unsubscribe();
        state.authReady = null;
        resolve(user || null);
      });
    });
  }
  return state.authReady;
}

async function safeRead(label, operation, fallback) {
  try {
    const value = await operation();
    const count = readValueCount(value);
    setReadState(label, count ? "success" : "empty", {
      count,
      sourceUpdatedAtMs: latestReadSourceMs(value),
    });
    return value;
  } catch (error) {
    state.readWarnings.push({ label, message: error?.message || String(error) });
    setReadState(label, isPermissionDenied(error) ? "permission-denied" : "unavailable", {
      message: error?.message || String(error),
    });
    console.warn(`ARCHIVE CORE read skipped: ${label}`, error);
    return fallback;
  }
}

function isPermissionDenied(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("permission-denied") || text.includes("missing or insufficient permission");
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

async function getCurrentPrivateLessonSessions(db, firestore, maxItems = 500) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  try {
    const snapshot = await firestore.getDocs(
      firestore.query(
        firestore.collection(db, "privateLessonSessions"),
        firestore.where("lessonStartAt", ">=", start),
        firestore.orderBy("lessonStartAt", "asc"),
        firestore.limit(maxItems),
      ),
    );
    return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  } catch (error) {
    if (String(error?.code || error?.message || "").includes("permission")) throw error;
    const snapshot = await firestore.getDocs(firestore.collection(db, "privateLessonSessions"));
    return snapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((session) => timestampMs(session.lessonStartAt || session.lessonDate) >= start.getTime())
      .sort((a, b) => timestampMs(a.lessonStartAt || a.lessonDate) - timestampMs(b.lessonStartAt || b.lessonDate))
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

async function getOptionalCollectionBy(db, firestore, collectionName, orderField = "updatedAt", maxItems = 1000) {
  try {
    return await getCollectionBy(db, firestore, collectionName, orderField, maxItems);
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn(`ARCHIVE CORE optional collection skipped: ${collectionName}`, error);
      throw error;
    }
    throw error;
  }
}

async function getStudioCollectionBy(db, firestore, collectionName, orderField = "updatedAt", maxItems = 1000) {
  const snapshot = await firestore.getDocs(
    firestore.query(
      firestore.collection(db, collectionName),
      firestore.where("studioId", "==", STUDIO_ID),
      firestore.limit(maxItems),
    ),
  );
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .sort((a, b) => String(b[orderField] || "").localeCompare(String(a[orderField] || "")));
}

async function getBookingsForLessonWindow(db, firestore) {
  const rangeStart = startOfLocalDay(new Date());
  rangeStart.setDate(rangeStart.getDate() - 1);
  const rangeEnd = startOfLocalDay(new Date());
  rangeEnd.setDate(rangeEnd.getDate() + 8);
  const snapshot = await firestore.getDocs(
    firestore.query(
      firestore.collection(db, "bookings"),
      firestore.where("lectureDate", ">=", dateKey(rangeStart)),
      firestore.where("lectureDate", "<=", dateKey(rangeEnd)),
      firestore.limit(2000),
    ),
  );
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
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
  const [profileSnapshot, memberSnapshot, cardSnapshot, summarySnapshot, tickets, purchases, bookings, memos, alimtalkLogs, tags] =
    await Promise.all([
      getDoc(doc(db, "memberProfiles", memberId)),
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
    missing: !profileSnapshot.exists() && !memberSnapshot.exists() && !cardSnapshot.exists(),
    profile: profileSnapshot.exists() ? { id: profileSnapshot.id, ...profileSnapshot.data() } : null,
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
  const launchAgentItems = items.filter((item) => String(item.runner || item.source || "").toLowerCase().includes("launchagent"));
  const codexItems = items.filter((item) => String(item.runner || item.source || "").toLowerCase().includes("codex"));
  const knownAutomationItems = [...launchAgentItems, ...codexItems];
  const knownAutomationIds = new Set(knownAutomationItems.map((item) => item.id || item.automationId || item.title || item.name));
  const otherStatusItems = items.filter((item) => !knownAutomationIds.has(item.id || item.automationId || item.title || item.name));
  const activeCodexItems = codexItems.filter((item) => ["active", "healthy"].includes(String(item.status || "").toLowerCase()));
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
  setText("automationStatusCount", formatCount(knownAutomationItems.length || items.length));
  setText("automationFailedCount", formatCount(failedItems.length));
  setText("automationRecentRun", latestItem ? formatDate(latestItem.updatedAt || latestItem.lastRunAt || latestItem.checkedAt) : "기록 대기");
  setText("automationConnectedState", items.length ? "상태 기록 연결됨" : "기록 대기");
  setText(
    "automationRunnerCount",
    `LaunchAgent ${launchAgentItems.length} · Codex ${codexItems.length}${
      otherStatusItems.length ? ` · 기타 ${otherStatusItems.length}` : ""
    }`,
  );
  setText("automationCodexActiveCount", formatCount(activeCodexItems.length));
  setText(
    "automationNextAction",
    items.length
      ? activeCodexItems.length
        ? "Codex ACTIVE 자동화는 LaunchAgent와 중복 실행되지 않는지 먼저 확인합니다."
        : "안정적인 정기 실행은 Mac mini LaunchAgent 기준으로 관리합니다."
      : "Mac mini / Excel / 알림톡 작업이 automationStatus에 결과를 쓰도록 연결해야 합니다.",
  );

  const list = qs("automationList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">최근 자동화 기록이 없습니다. 작업 결과 저장 연결이 다음 단계입니다.</div>`;
    return;
  }

  const orderedItems = [...knownAutomationItems, ...otherStatusItems];
  list.innerHTML = orderedItems
    .map((item) => {
      const name = item.title || item.name || item.id;
      const detail = item.summary || item.message || item.lastResult || item.description || "상세 기록 없음";
      const updated = formatDate(item.updatedAt || item.lastRunAt || item.checkedAt);
      const nextRun = item.nextRunAt || item.nextScheduledAt ? ` · 다음 ${formatDate(item.nextRunAt || item.nextScheduledAt)}` : "";
      const error = item.lastError || item.errorMessage ? ` · ${item.lastError || item.errorMessage}` : "";
      const runner = item.runner || item.source || item.kind || "runner 미기록";
      const schedule = item.schedule || item.rrule || "";
      const owner = item.ownerArea ? ` · ${item.ownerArea}` : "";
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(runner)}${escapeHtml(owner)}${schedule ? ` · ${escapeHtml(schedule)}` : ""}</p>
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
        title: "Mac mini LaunchAgent",
        source: launchAgentItems.find((item) => ["failed", "warning"].includes(String(item.status || "").toLowerCase())) || launchAgentItems[0],
        detail: "안정적인 정기 실행의 기본 주체입니다.",
      },
      {
        title: "Codex 자동화",
        source: activeCodexItems[0] || codexItems[0],
        detail: "기본은 테스트와 리뷰입니다. ACTIVE 항목은 중복 여부를 확인합니다.",
      },
      {
        title: "운영 상태 기록",
        source: items[0],
        detail: "새 자동화는 automationStatus에 상태를 써야 CORE 관제에 표시됩니다.",
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
  setText("importConnectionState", items.length ? "최근 원본 처리 기록 연결됨" : "원본 처리 기록 대기");
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
    table.innerHTML = `<tr><td colspan="4">최근 원본 처리 기록이 없습니다.</td></tr>`;
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
  const activeIssues = items.filter(isOperatorActionableQualityIssue);
  const resolvedIssues = items.filter((item) => isResolvedQualityIssue(item) || isExplicitlyHiddenFromOperator(item));
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
  if (type.includes("duplicate") || type.includes("중복")) return "중복 기준 우선순위 확인";
  if (type.includes("name") || type.includes("동명이인")) return "이름 단독 매칭 금지, 전화번호/StudioMate ID 확인";
  if (type.includes("excel")) return "실제 StudioMate memberId 해소 후 사용";
  return "운영자가 매칭 상태 확인";
}

function hasOperatorActionFlag(item) {
  const flags = [
    item.operatorActionRequired,
    item.requiresOperatorAction,
    item.reviewRequired,
    item.operatorVisible,
    item.needsOperatorReview,
  ];
  return flags.some((value) => value === true || (typeof value === "number" && value > 0) || value === "true");
}

function isExplicitlyHiddenFromOperator(item) {
  return (
    item.operatorVisible === false ||
    item.operatorActionRequired === false ||
    item.requiresOperatorAction === false ||
    item.reviewRequired === false ||
    item.reviewRequired === 0 ||
    String(item.operatorAction || item.nextAction || "").includes("추가 조치 없음")
  );
}

function isResolvedQualityIssue(item) {
  return ["resolved", "closed", "done", "auto_resolved", "ignored"].includes(String(item.status || "").toLowerCase()) || Boolean(item.resolvedAt);
}

function isOperatorActionableQualityIssue(item) {
  if (isResolvedQualityIssue(item) || isExplicitlyHiddenFromOperator(item)) return false;
  if (hasOperatorActionFlag(item)) return true;
  const severity = String(item.severity || item.priority || "").toLowerCase();
  const status = String(item.status || "").toLowerCase();
  const text = [item.title, item.issueType, item.type, item.summary, item.description, item.operatorAction, item.nextAction]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const systemHandled = [
    "canonical key",
    "canonicalusagekey",
    "정규화",
    "중복",
    "duplicate",
    "excluded",
    "외부 실행 원천에서 제외",
    "외부 실행 보류",
    "자동 처리",
    "자동 정리",
    "누락 행",
    "이름/전화번호 누락",
    "전화번호가 없어",
  ].some((keyword) => text.includes(keyword));
  if (systemHandled) return false;
  if (["critical", "danger", "blocked"].includes(severity) || ["needs_action", "blocked"].includes(status)) {
    return true;
  }
  return false;
}

function activeQualityIssues() {
  return state.qualityIssues.filter(isOperatorActionableQualityIssue);
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
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000);
  if (Number.isFinite(Number(value?._seconds))) return Number(value._seconds) * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1000000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateKey(value) {
  const ms = timestampMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStartMs(referenceDate = new Date()) {
  return startOfLocalDay(referenceDate).getTime();
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

function memberStableId(item) {
  return String(item?.memberId || item?.id || "").trim();
}

function profileActiveTickets(profile) {
  return Array.isArray(profile?.activeTickets) ? profile.activeTickets.filter(isCurrentProfileTicket) : [];
}

function hasProfileActiveTicketsField(profile) {
  return Boolean(profile && Array.isArray(profile.activeTickets));
}

function isCurrentProfileTicket(ticket) {
  const expiresMs = ticketExpiresMs(ticket);
  if (expiresMs && expiresMs + 24 * 60 * 60 * 1000 < Date.now()) return false;
  return true;
}

function currentTicketSummaryFromProfile(profile, fallback = []) {
  const activeTickets = profileActiveTickets(profile);
  if (hasProfileActiveTicketsField(profile)) return activeTickets;
  return fallback || [];
}

function mergeMemberCardsWithProfiles(cards = [], profiles = []) {
  const cardsById = new Map();
  for (const card of cards) {
    const id = memberStableId(card);
    if (id) cardsById.set(id, card);
  }
  const mergedById = new Map();
  for (const card of cards) {
    const id = memberStableId(card);
    if (id) mergedById.set(id, { ...card, dataSources: { ...(card.dataSources || {}), card: "member360Cards" } });
  }
  for (const profile of profiles) {
    const id = memberStableId(profile);
    if (!id) continue;
    const card = cardsById.get(id) || {};
    const activeTickets = profileActiveTickets(profile);
    const profileVisitAt = profile.emergencyLastAttendance || profile.lastAttendanceAt || profile.recentVisitAt;
    const cardVisitAt = card.recentVisitAt || card.lastAttendanceAt;
    const recentVisitAt = timestampMs(profileVisitAt) >= timestampMs(cardVisitAt) ? profileVisitAt || cardVisitAt : cardVisitAt;
    mergedById.set(id, {
      ...card,
      ...profile,
      id,
      memberId: profile.memberId || card.memberId || id,
      totalRevenue: toNumber(card.totalRevenue),
      purchaseCount: toNumber(card.purchaseCount),
      bookingCount: toNumber(card.bookingCount),
      attendedCount: toNumber(card.attendedCount),
      absentCount: toNumber(card.absentCount),
      recentPurchases: card.recentPurchases || [],
      recentBookings: card.recentBookings || [],
      recentMemos: card.recentMemos || [],
      signals: card.signals || [],
      recentVisitAt,
      currentTicketsSummary: currentTicketSummaryFromProfile(profile, card.currentTicketsSummary || []),
      activeTicketCount: hasProfileActiveTicketsField(profile) ? activeTickets.length : toNumber(card.activeTicketCount),
      sourceProfileUpdatedAt: profile.updatedAt || profile.syncedAt || card.sourceProfileUpdatedAt || null,
      cardRebuiltAt: card.rebuiltAt || null,
      dataSources: {
        ...(card.dataSources || {}),
        card: card.id ? "member360Cards" : "",
        profile: "memberProfiles",
      },
    });
  }
  return [...mergedById.values()];
}

const RENEWAL_EXCLUDED_TICKET_KEYWORDS = ["강사레슨", "강사용", "직원", "상담", "체험", "락커", "양말", "토삭스", "상품권", "쿠폰"];

function ticketNameText(ticket) {
  return String(ticketLabel(ticket) || "").trim();
}

function ticketClassText(ticket) {
  return String(ticket?.classType || ticket?.ticketClassType || ticket?.lessonType || ticket?.ticketType || "").trim();
}

function renewalTicketKind(ticket) {
  const text = `${ticketClassText(ticket)} ${ticketNameText(ticket)}`.toLowerCase();
  if (/프라이빗|개인|1:1|private|semi|세미|duet|듀엣/.test(text)) return "private";
  if (/그룹|group|소그룹/.test(text)) return "group";
  return "lesson";
}

function isRenewalManagedTicket(ticket) {
  const name = ticketNameText(ticket);
  if (!name) return false;
  return !RENEWAL_EXCLUDED_TICKET_KEYWORDS.some((keyword) => name.includes(keyword));
}

function ticketRemainingCount(ticket) {
  const value = ticket?.remainingCount ?? ticket?.remaining ?? ticket?.remainCount;
  if (value === null || value === undefined || value === "") return Number.NaN;
  return Number(value);
}

function ticketMaxCount(ticket) {
  const value = ticket?.maxCount ?? ticket?.totalCount ?? ticket?.usableCount;
  if (value === null || value === undefined || value === "") return Number.NaN;
  return Number(value);
}

function ticketExpiresMs(ticket) {
  return timestampMs(ticket?.expiresAt || ticket?.expireAt || ticket?.endAt || ticket?.expiryDate);
}

function daysUntilDate(ms, referenceDate = new Date()) {
  if (!ms) return Number.POSITIVE_INFINITY;
  const start = todayStartMs(referenceDate);
  const target = startOfLocalDay(new Date(ms)).getTime();
  return Math.ceil((target - start) / (24 * 60 * 60 * 1000));
}

function renewalCountThreshold(kind) {
  return kind === "private" ? 3 : 5;
}

function isHealthyBackupTicket(ticket, referenceDate = new Date()) {
  if (!isRenewalManagedTicket(ticket)) return false;
  const kind = renewalTicketKind(ticket);
  const remaining = ticketRemainingCount(ticket);
  const days = daysUntilDate(ticketExpiresMs(ticket), referenceDate);
  if (Number.isFinite(remaining) && remaining <= renewalCountThreshold(kind)) return false;
  if (Number.isFinite(days) && days <= 30) return false;
  return true;
}

function hasSameKindBackupTicket(tickets, target, referenceDate = new Date()) {
  const targetKind = renewalTicketKind(target);
  return tickets.some((ticket) => {
    if (ticket === target) return false;
    if (renewalTicketKind(ticket) !== targetKind) return false;
    return isHealthyBackupTicket(ticket, referenceDate);
  });
}

function renewalTicketRisk(ticket, tickets, referenceDate = new Date()) {
  if (!isRenewalManagedTicket(ticket)) return null;
  const kind = renewalTicketKind(ticket);
  const remaining = ticketRemainingCount(ticket);
  const maxCount = ticketMaxCount(ticket);
  const days = daysUntilDate(ticketExpiresMs(ticket), referenceDate);
  const reasons = [];
  if (Number.isFinite(days) && days < 0) reasons.push("기간 만료");
  else if (Number.isFinite(days) && days <= 30) reasons.push(`만료 D-${days}`);
  if (Number.isFinite(remaining) && remaining <= renewalCountThreshold(kind)) reasons.push(`잔여 ${remaining}회`);
  if (!reasons.length) return null;
  if (hasSameKindBackupTicket(tickets, ticket, referenceDate)) return null;
  const urgent =
    (Number.isFinite(days) && days <= 7) ||
    (Number.isFinite(remaining) && remaining <= (kind === "private" ? 1 : 2));
  const warning =
    urgent ||
    (Number.isFinite(days) && days <= 14) ||
    (Number.isFinite(remaining) && remaining <= (kind === "private" ? 2 : 3));
  return {
    ticket,
    kind,
    days,
    remaining,
    maxCount,
    priority: urgent ? "urgent" : warning ? "warning" : "follow",
    reason: reasons.join(" · "),
  };
}

function renewalStatusValue(priority) {
  if (priority === "urgent") return "critical";
  if (priority === "warning" || priority === "waiting") return "warning";
  return "reviewing";
}

function renewalActionText(candidate) {
  if (candidate.priority === "waiting") return "최근 방문 이력 기준 복귀 연락";
  if (candidate.priority === "urgent") return "오늘 수업 전후 현장 상담";
  if (candidate.topRisk?.kind === "private") return "프라이빗 다음 블록 상담";
  return "그룹권 재등록/소진 플랜 상담";
}

function renewalCandidateRows(referenceDate = new Date()) {
  const syncedRows = renewalCaseRows(referenceDate);
  if (syncedRows) return syncedRows;
  const mergedMembers = mergeDuplicateMembers(state.members || []);
  const rows = [];
  for (const member of mergedMembers) {
    const memberId = member.memberId || member.id || "";
    const name = member.name || member.memberName || memberId || "회원";
    const tickets = (member.currentTicketsSummary || member.activeTicketNames || []).filter((ticket) => typeof ticket !== "string");
    const activeTicketCount = toNumber(member.activeTicketCount || tickets.length);
    const risks = tickets
      .map((ticket) => renewalTicketRisk(ticket, tickets, referenceDate))
      .filter(Boolean)
      .sort((a, b) => {
        const priorityRank = { urgent: 3, warning: 2, follow: 1 };
        return (
          (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) ||
          (Number.isFinite(a.days) ? a.days : 9999) - (Number.isFinite(b.days) ? b.days : 9999) ||
          (Number.isFinite(a.remaining) ? a.remaining : 9999) - (Number.isFinite(b.remaining) ? b.remaining : 9999)
        );
      });
    const recentVisitMs = timestampMs(member.recentVisitAt);
    const recentVisitDays = recentVisitMs ? Math.max(0, Math.floor((todayStartMs(referenceDate) - startOfLocalDay(new Date(recentVisitMs)).getTime()) / (24 * 60 * 60 * 1000))) : Number.POSITIVE_INFINITY;
    const recentlyVisited = recentVisitDays <= 45;
    if (!risks.length && !(activeTicketCount === 0 && recentlyVisited && toNumber(member.totalRevenue) > 0)) continue;
    const topRisk = risks[0] || null;
    const priority = topRisk?.priority || "waiting";
    const phone = normalizePhone(member.phone || member.memberPhone || member.phoneNumber || "");
    const ticketName = topRisk ? ticketNameText(topRisk.ticket) : "활성 수강권 없음";
    const reason = topRisk ? topRisk.reason : `최근 방문 ${recentVisitDays}일 전`;
    rows.push({
      member,
      memberId,
      name,
      phone,
      priority,
      topRisk,
      ticketName,
      reason,
      recentVisitDays,
      activeTicketCount,
      href: memberId ? `./members/detail/?id=${encodeURIComponent(memberId)}` : "./members/",
      action: renewalActionText({ priority, topRisk }),
    });
  }
  const priorityRank = { urgent: 4, warning: 3, waiting: 2, follow: 1 };
  return rows.sort(
    (a, b) =>
      (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) ||
      timestampMs(b.member.recentVisitAt) - timestampMs(a.member.recentVisitAt) ||
      toNumber(b.member.totalRevenue) - toNumber(a.member.totalRevenue),
  );
}

function renewalCaseRows(referenceDate = new Date()) {
  if (!state.renewalCases.length) return null;
  const memberById = new Map((state.members || []).map((member) => [String(member.memberId || member.id || ""), member]));
  const now = referenceDate.getTime();
  const rows = state.renewalCases
    .filter((item) => item.active !== false && !["resolved", "excluded"].includes(String(item.workflowStatus || "open")))
    .filter((item) => item.workflowStatus !== "snoozed" || !timestampMs(item.nextActionAt) || timestampMs(item.nextActionAt) <= now)
    .filter((item) => {
      if (!isRenewalManagedTicket({ name: item.ticketName || "" })) return false;
      const member = memberById.get(String(item.memberId || "")) || {};
      const tickets = (member.currentTicketsSummary || []).filter((ticket) => ticket && typeof ticket !== "string");
      const sameKindTickets = tickets.filter(
        (ticket) => renewalTicketKind(ticket) === String(item.kind || "lesson") && isRenewalManagedTicket(ticket),
      );
      return sameKindTickets.length < 2;
    })
    .map((item) => {
      const member = memberById.get(String(item.memberId || "")) || {};
      const memberId = item.memberId || member.memberId || member.id || "";
      return {
        member,
        memberId,
        name: item.memberName || member.name || "회원",
        phone: normalizePhone(member.phone || member.memberPhone || member.phoneNumber || ""),
        priority: item.priority || "follow",
        topRisk: { kind: item.kind || "lesson" },
        ticketName: item.ticketName || "수강권 확인",
        reason: item.reason || "재등록 확인",
        recentVisitDays: Number.POSITIVE_INFINITY,
        activeTicketCount: toNumber(member.activeTicketCount),
        href: memberId ? `./members/detail/?id=${encodeURIComponent(memberId)}` : "./members/",
        action: item.recommendation || "최근 이용 패턴 기준 재등록 상담",
        predictedDepletionDate: item.predictedDepletionDate || "",
        weeklyUsagePace: toNumber(item.weeklyUsagePace),
        nextBookingDate: item.nextBookingDate || "",
        workflowStatus: item.workflowStatus || "open",
        renewalCaseId: item.caseId || item.id || "",
      };
    });
  const priorityRank = { urgent: 4, warning: 3, waiting: 2, follow: 1 };
  return rows.sort(
    (a, b) =>
      (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) ||
      String(a.predictedDepletionDate || "9999-12-31").localeCompare(String(b.predictedDepletionDate || "9999-12-31")),
  );
}

function ticketFingerprint(tickets = []) {
  return (tickets || [])
    .filter((ticket) => ticket && typeof ticket !== "string")
    .map((ticket) =>
      [
        ticketNameText(ticket),
        renewalTicketKind(ticket),
        ticketRemainingCount(ticket),
        ticketExpiresMs(ticket),
        ticketMaxCount(ticket),
      ].join("|"),
    )
    .sort()
    .join(";");
}

function latestPurchaseDateMs(member) {
  return Math.max(
    0,
    ...(member?.recentPurchases || []).map((purchase) => timestampMs(purchase.paymentDate || purchase.purchasedAt || purchase.createdAt)),
  );
}

function latestActiveTicketStartMs(profile) {
  return Math.max(0, ...profileActiveTickets(profile).map((ticket) => timestampMs(ticket.availableFrom || ticket.startDate || ticket.issuedAt)));
}

function latestActiveTicketPaymentMs(profile) {
  return Math.max(0, ...profileActiveTickets(profile).map((ticket) => timestampMs(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt)));
}

function hasActiveTicketPaymentEvidence(profile) {
  return profileActiveTickets(profile).some(
    (ticket) =>
      timestampMs(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt) ||
      toNumber(ticket.paymentAmount ?? ticket.amountTotal ?? ticket.price),
  );
}

function coreDataHealthIssues() {
  const cardsById = new Map(state.memberCards.map((card) => [memberStableId(card), card]).filter(([id]) => id));
  const issues = [];
  for (const profile of state.memberProfiles || []) {
    const memberId = memberStableId(profile);
    if (!memberId) continue;
    const card = cardsById.get(memberId);
    const profileUpdatedAt = timestampMs(profile.updatedAt || profile.syncedAt);
    if (!card) {
      issues.push({
        memberId,
        memberName: profile.name || profile.memberName || memberId,
        level: "warning",
        type: "missing_member360_card",
        label: "CORE 회원 미러 없음",
        detail: "memberProfiles는 있지만 member360Cards가 없어 CORE 상세/매출 화면이 불완전합니다.",
      });
      continue;
    }
    const cardUpdatedAt = timestampMs(card.rebuiltAt || card.updatedAt || card.sourceProfileUpdatedAt);
    const profileTickets = ticketFingerprint(profileActiveTickets(profile));
    const cardTickets = ticketFingerprint(card.currentTicketsSummary || []);
    if (profileUpdatedAt && cardUpdatedAt && profileUpdatedAt > cardUpdatedAt + 5 * 60 * 1000 && profileTickets !== cardTickets) {
      issues.push({
        memberId,
        memberName: profile.name || profile.memberName || memberId,
        level: "warning",
        type: "stale_member360_ticket_summary",
        label: "CORE 수강권 미러 지연",
        detail: "memberProfiles 최신 수강권과 member360Cards 수강권 요약이 다릅니다.",
      });
    }
    const latestTicketStart = latestActiveTicketStartMs(profile);
    const latestPurchase = Math.max(latestPurchaseDateMs(card), latestActiveTicketPaymentMs(profile));
    if (latestTicketStart && !hasActiveTicketPaymentEvidence(profile) && (!latestPurchase || latestTicketStart > latestPurchase + 30 * 24 * 60 * 60 * 1000)) {
      issues.push({
        memberId,
        memberName: profile.name || profile.memberName || memberId,
        level: "warning",
        type: "missing_recent_purchase_amount",
        label: "최근 구매금액 미러 누락",
        detail: "활성 수강권 시작일 이후 구매 이력이 없어 금액 표시가 최신 원천과 맞지 않을 수 있습니다.",
      });
    }
  }
  return issues.sort((a, b) => String(a.memberName).localeCompare(String(b.memberName), "ko"));
}

function purchaseRowsWithProfileTickets(purchases = [], profile = {}) {
  const out = [...(purchases || [])];
  const seen = new Set(
    out.map((item) =>
      [item.ticketName || item.productName || item.name || "", item.paymentDate || item.purchasedAt || item.createdAt || "", toNumber(item.amountTotal ?? item.price ?? item.amount ?? item.revenue)].join("|"),
    ),
  );
  for (const ticket of profileActiveTickets(profile)) {
    const amountTotal = toNumber(ticket.paymentAmount ?? ticket.amountTotal ?? ticket.price);
    const paymentDate = ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt;
    if (!amountTotal && !paymentDate) continue;
    const key = [ticket.ticketName || ticket.name || "", paymentDate || "", amountTotal].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift({
      id: `active_ticket_payment_${key}`,
      ticketName: ticket.ticketName || ticket.name || "현재 수강권",
      paymentDate,
      amountTotal,
      paymentMethod: ticket.paymentMethod || "",
      category: ticket.paymentType || "현재 수강권",
      status: ticket.status || "현재 수강권",
    });
  }
  return out;
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
  if (readUnavailable("memberProfiles") && readUnavailable("member360Cards")) {
    ["membersVisibleCount", "membersActiveTicketCount", "membersRecentVisitCount", "membersRevenueCount"].forEach((id) => setText(id, "-"));
    table.innerHTML = `<tr><td colspan="4"><span class="error-state">회원 원본과 요약을 읽지 못했습니다. 현재 0명으로 판단하지 않습니다.</span></td></tr>`;
    renderMemberPagination(0);
    return;
  }
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
    table.innerHTML = `<tr><td colspan="4">회원 데이터가 없거나 권한 확인이 필요합니다.</td></tr>`;
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

function isFailureStatus(value) {
  return ["failed", "error", "critical", "blocked"].includes(String(value || "").toLowerCase());
}

function isClosedStatus(value) {
  return ["resolved", "closed", "done", "completed", "success", "sent", "skipped", "excluded", "ignored"].includes(
    String(value || "").toLowerCase(),
  );
}

function isResolvedOperationalItem(item) {
  return Boolean(
    item?.resolvedAt ||
      item?.resolutionStatus === "resolved" ||
      item?.actionStatus === "resolved" ||
      item?.actionStatus === "completed" ||
      item?.operatorStatus === "resolved" ||
      item?.operatorStatus === "completed" ||
      item?.reviewStatus === "resolved" ||
      item?.reviewStatus === "completed" ||
      item?.resolved === true ||
      item?.completed === true ||
      isClosedStatus(item?.status) ||
      isClosedStatus(item?.sendStatus),
  );
}

function operatorLifecycle(item) {
  if (isResolvedOperationalItem(item)) return "resolved";
  const values = [
    item?.operatorStatus,
    item?.actionStatus,
    item?.resolutionStatus,
    item?.reviewStatus,
    item?.sendStatus,
    item?.status,
    item?.health,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  if (values.some((value) => ["blocked", "critical"].includes(value))) return "blocked";
  if (values.some((value) => ["failed", "error"].includes(value))) return "blocked";
  if (values.some((value) => ["running", "processing", "in_progress"].includes(value))) return "in_progress";
  if (values.some((value) => ["acknowledged", "reviewed"].includes(value))) return "acknowledged";
  return "open";
}

function operatorActionKey(item, domain = "action") {
  const explicitKey =
    item?.canonicalActionKey ||
    item?.canonicalBookingKey ||
    item?.dedupeKey ||
    item?.candidateId ||
    item?.requestId ||
    item?.jobId ||
    item?.automationId ||
    item?.id;
  if (explicitKey) return String(explicitKey);
  const memberKey = item?.memberId || item?.memberName || "";
  const actionKey = item?.templateCode || item?.title || item?.name || "";
  return memberKey || actionKey ? `${domain}:${memberKey}:${actionKey}` : "";
}

function uniqueOperatorItems(items = [], domain = "action") {
  const byKey = new Map();
  for (const [index, item] of items.entries()) {
    const key = operatorActionKey(item, domain) || `${domain}:unkeyed:${index}`;
    const current = byKey.get(key);
    const itemMs = timestampMs(item.updatedAt || item.createdAt || item.lastRunAt || item.sentAt);
    const currentMs = timestampMs(current?.updatedAt || current?.createdAt || current?.lastRunAt || current?.sentAt);
    if (!current || itemMs >= currentMs) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function isPendingStatus(value) {
  return ["queued", "pending", "review", "reviewed", "processing", "template_pending"].includes(
    String(value || "").toLowerCase(),
  );
}

function isAlimtalkTemplateIdentifier(value) {
  return /^KA\d{2}TP[0-9A-Za-z]+$/.test(String(value || "").trim());
}

function alimtalkTemplateTitle(item = {}) {
  const templateCode = String(item.templateCode || item.templateId || "").trim();
  const explicitName = String(item.templateName || "").trim();
  if (explicitName && !isAlimtalkTemplateIdentifier(explicitName)) return explicitName;
  if (ALIMTALK_TEMPLATE_LABELS_BY_CODE[templateCode]) return ALIMTALK_TEMPLATE_LABELS_BY_CODE[templateCode];
  const candidateType = String(item.candidateType || item.type || "").trim().toLowerCase();
  if (ALIMTALK_TEMPLATE_LABELS_BY_TYPE[candidateType]) return ALIMTALK_TEMPLATE_LABELS_BY_TYPE[candidateType];
  return "알림톡 템플릿";
}

function alimtalkRowTitle(item = {}) {
  const title = String(item.title || "").trim();
  return title && !isAlimtalkTemplateIdentifier(title) ? title : alimtalkTemplateTitle(item);
}

function humanizeAlimtalkTemplateText(value) {
  return String(value || "").replace(/KA\d{2}TP[0-9A-Za-z]+/g, (templateCode) => {
    return ALIMTALK_TEMPLATE_LABELS_BY_CODE[templateCode] || "알림톡 템플릿";
  });
}

function communicationActionText(item) {
  return [
    item?.status,
    item?.sendStatus,
    item?.reasonCode,
    item?.skipCode,
    item?.reason,
    item?.skipReason,
    item?.excludeReason,
    item?.exclusionReason,
    item?.dedupeReason,
    item?.dedupePolicy,
    item?.lastError,
    item?.errorMessage,
    item?.operatorAction,
    item?.nextAction,
    item?.templateName,
    item?.templateCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isNonActionableCommunicationItem(item) {
  if (isResolvedOperationalItem(item)) return true;
  const code = String(item?.reasonCode || item?.skipCode || item?.excludeCode || "").toLowerCase();
  if (
    [
      "auto_sendability_blocked",
      "duplicate_send_blocked",
      "not_current_target",
      "duplicate_booking_source",
      "inactive_booking",
      "operator_excluded",
      "template_deleted",
      "legacy_replaced",
    ].includes(code)
  ) {
    return true;
  }
  const text = communicationActionText(item);
  return [
    "skipped",
    "excluded",
    "duplicate",
    "dedupe",
    "중복",
    "제외",
    "차단",
    "발송 제외",
    "중복 발송 차단",
    "운영자 제외",
    "규칙 제외",
    "이미 처리",
    "대체",
    "중지",
    "템플릿 삭제",
    "삭제된",
    "레거시",
  ].some((keyword) => text.includes(keyword));
}

function failedAlimtalkCandidates(items = state.alimtalkCandidates) {
  return uniqueOperatorItems(
    items.filter((item) => hasCommunicationFailureSignal(item) && !isNonActionableCommunicationItem(item)),
    "alimtalk-candidate",
  );
}

function failedAlimtalkSends(items = state.alimtalkSends) {
  return uniqueOperatorItems(
    items.filter((item) => hasCommunicationFailureSignal(item) && !isNonActionableCommunicationItem(item)),
    "alimtalk-send",
  );
}

function hasCommunicationFailureSignal(item) {
  return [
    item?.status,
    item?.sendStatus,
    item?.deliveryStatus,
    item?.resultStatus,
    item?.solapiStatus,
    item?.alimtalkStatus,
  ].some(isFailureStatus);
}

function onsiteWelcomeProblems(items = state.onsiteWelcomeRequests) {
  return items.filter((item) => !isResolvedOperationalItem(item) && (isFailureStatus(item.status) || Boolean(item.lastError)));
}

function signupContractProblems(items = state.memberSignupContracts) {
  return items.filter(
    (item) =>
      !isResolvedOperationalItem(item) &&
      (isFailureStatus(item.status) ||
        isFailureStatus(item.syncStatus) ||
        isFailureStatus(item.studiomateSyncStatus) ||
      isFailureStatus(item.studiomateProfileSyncStatus) ||
      isFailureStatus(item.studiomateProfileSync?.status) ||
      isFailureStatus(item.driveArchive?.status) ||
        Boolean(item.lastError || item.driveArchive?.lastError)),
  );
}

function pricingInquiryProblems(items = state.pricingInquiryAlimtalkRequests) {
  return items.filter((item) => !isResolvedOperationalItem(item) && (isFailureStatus(item.status) || isFailureStatus(item.sendStatus)));
}

function problemRequestRows() {
  return uniqueOperatorItems(
    [
    ...onsiteWelcomeProblems().map((item) => ({
      ...item,
      title: "현장 웰컴 준비 실패",
      memberName: item.memberName || item.name || item.memberNameHint,
      memberPhone: item.phone || item.memberPhone,
      reason: item.lastError || item.progressLabel || item.requestId,
      status: item.status || "error",
      updatedAt: item.updatedAt || item.createdAt,
    })),
    ...signupContractProblems().map((item) => ({
      ...item,
      title: "회원가입서 후속 처리 실패",
      memberName: item.memberName || item.name,
      memberPhone: item.phone || item.memberPhone,
      reason:
        item.lastError ||
        item.driveArchive?.lastError ||
        item.syncStatus ||
        item.studiomateSyncStatus ||
        item.studiomateProfileSyncStatus ||
        item.contractId,
      status:
        item.status ||
        item.syncStatus ||
        item.studiomateSyncStatus ||
        item.studiomateProfileSyncStatus ||
        item.studiomateProfileSync?.status ||
        item.driveArchive?.status ||
        "error",
      updatedAt: item.updatedAt || item.submittedAt || item.createdAt,
    })),
    ...pricingInquiryProblems().map((item) => ({
      ...item,
      title: "수강료 안내 발송 실패",
      memberName: item.memberName || item.name || item.memberPhone || item.phone,
      memberPhone: item.memberPhone || item.phone,
      reason: item.lastError || item.requestId,
      status: item.status || item.sendStatus || "error",
      updatedAt: item.updatedAt || item.completedAt || item.createdAt,
    })),
    ],
    "communication-flow",
  );
}

function renderMessages(candidates, sends) {
  if (!qs("messagesCandidateList")) return;
  if (readUnavailable("alimtalkCandidates") && readUnavailable("alimtalkSends")) {
    ["messagesCandidateCount", "messagesSendCount", "messagesSentCount", "messagesFailedCount"].forEach((id) => setText(id, "-"));
    setPillText("messagesPendingDecision", "blocked");
    setPillText("messagesRiskDecision", "blocked");
    ["messagesDecisionList", "messagesTemplateList", "messagesCandidateList", "messagesSendList"].forEach((id) => {
      const element = qs(id);
      if (element) element.innerHTML = `<div class="empty-state error-state">알림톡 원본을 읽지 못했습니다. 0건으로 판단하지 않습니다.</div>`;
    });
    return;
  }
  const sentCandidates = candidates.filter((item) => String(item.status || "").toLowerCase() === "sent");
  const failedCandidates = failedAlimtalkCandidates(candidates);
  const failedSends = failedAlimtalkSends(sends);
  const flowProblems = problemRequestRows();
  const totalFailures = failedCandidates.length + failedSends.length + flowProblems.length;
  const pendingCandidates = uniqueOperatorItems(
    candidates.filter((item) => isPendingStatus(item.status) && !isNonActionableCommunicationItem(item)),
    "alimtalk-candidate",
  );
  setText("messagesCandidateCount", formatCount(pendingCandidates.length));
  setText("messagesSendCount", formatCount(sends.length));
  setText("messagesSentCount", formatCount(sentCandidates.length));
  setText("messagesFailedCount", formatCount(totalFailures));
  setText("messagesPendingDecision", pendingCandidates.length ? `${pendingCandidates.length}건 확인` : "대기 없음");
  setText("messagesRiskDecision", totalFailures ? `${totalFailures}건 실패` : "위험 낮음");

  const renderAlimtalkRow = (item, options = {}) => {
    const title = alimtalkRowTitle(item);
    const template = alimtalkTemplateTitle(item);
    const member = item.memberName || item.name || item.memberId || item.id;
    const date = formatDate(item.sentAt || item.updatedAt || item.createdAt || item.sourceDate);
    const reason = humanizeAlimtalkTemplateText(item.reason || item.lastError || item.dedupePolicy || item.candidateId || "");
    const templateContext = title !== template ? `${template} · ` : "";
    return `
      <div class="status-row">
        <div>
          <strong>${escapeHtml(member)}</strong>
          <p>${escapeHtml(title)} · ${escapeHtml(templateContext)}${escapeHtml(date)}${reason ? ` · ${escapeHtml(reason)}` : ""}</p>
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
    const failureRows = [
      ...failedCandidates.map((item) => ({
        ...item,
        title: item.title || "후보 단계 실패",
        reason: item.lastError || item.reason || item.candidateId,
      })),
      ...flowProblems,
      ...failedSends,
    ];
    sendList.innerHTML = failureRows.length
      ? failureRows.map((item) => renderAlimtalkRow(item, { status: (row) => row.status || row.sendStatus || "failed" })).join("")
      : `<div class="empty-state">현재 확인할 실패 알림톡이 없습니다.</div>`;
  }

  const templateList = qs("messagesTemplateList");
  if (templateList) {
    const templateMap = new Map();
    for (const item of [...candidates, ...sends]) {
      const key = alimtalkTemplateTitle(item);
      const current = templateMap.get(key) || { label: key, candidates: 0, sends: 0, failed: 0, sent: 0 };
      if (candidates.includes(item)) current.candidates += 1;
      if (sends.includes(item)) current.sends += 1;
      const status = String(item.status || item.sendStatus || "").toLowerCase();
      if (["failed", "error"].includes(status) && !isNonActionableCommunicationItem(item)) current.failed += 1;
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
        detail: totalFailures
          ? `후보 실패 ${failedCandidates.length}건, 발송 실패 ${failedSends.length}건, 회원가입/수강료 흐름 문제 ${flowProblems.length}건을 확인해야 합니다.`
          : "최근 후보/발송/회원가입 흐름에서 실패 상태는 보이지 않습니다.",
        status: totalFailures ? "failed" : "success",
      },
      {
        title: "운영 경계",
        detail: "이 탭은 확인용입니다. 실제 발송 전에는 대상자와 템플릿을 다시 확인합니다.",
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

function setPricingInquiryStatus(message, tone = "") {
  const element = qs("pricingInquiryStatus");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function pricingInquiryDisplayPhone(item) {
  const phone = normalizePhone(item.memberPhone || item.phone || item.inquiryPhone || "");
  if (!phone) return "전화번호 없음";
  return formatPhoneNumber(phone);
}

function formatPhoneNumber(value) {
  const phone = normalizePhone(value);
  if (/^010\d{8}$/.test(phone)) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
  return phone || "전화번호 없음";
}

function pricingInquiryRecentTime(item) {
  return item.completedAt || item.sentAt || item.updatedAt || item.createdAt || item.requestedAt;
}

function renderPricingInquiryRecentList() {
  const list = qs("pricingInquiryHistoryList");
  const count = qs("pricingInquiryHistoryCount");
  if (!list) return;
  const items = [...(state.pricingInquiryAlimtalkRequests || [])]
    .sort((a, b) => timestampMs(pricingInquiryRecentTime(b)) - timestampMs(pricingInquiryRecentTime(a)))
    .slice(0, 20);
  if (count) count.textContent = `${items.length}건`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">최근 수강료 안내 발송 이력이 없습니다.</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const name = item.memberName || item.name || "고객";
      const phone = pricingInquiryDisplayPhone(item);
      const status = item.status || item.sendStatus || "unknown";
      const time = formatDate(pricingInquiryRecentTime(item));
      const note = item.note || item.payload?.note || "";
      const error = item.lastError || item.errorMessage || "";
      const buttonUrl = item.buttonUrl || item.pricingUrl || "";
      const meta = [phone, time, item.requestedByName ? `처리 ${item.requestedByName}` : "", item.solapiMessageId ? `SOLAPI ${item.solapiMessageId}` : ""]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            <p class="meta-line">${escapeHtml(meta)}</p>
            ${note ? `<p class="note-line">메모: ${escapeHtml(note)}</p>` : `<p class="meta-line">내부 메모 없음</p>`}
            ${error ? `<p class="note-line">확인: ${escapeHtml(error)}</p>` : ""}
            ${buttonUrl ? `<p class="meta-line">링크: ${escapeHtml(buttonUrl)}</p>` : ""}
          </div>
          ${pill(status)}
        </div>
      `;
    })
    .join("");
}

function togglePricingInquiryHistory() {
  const panel = qs("pricingInquiryHistoryPanel");
  const button = qs("pricingInquiryHistoryToggle");
  if (!panel || !button) return;
  const nextOpen = panel.hidden;
  panel.hidden = !nextOpen;
  button.setAttribute("aria-expanded", String(nextOpen));
  button.textContent = nextOpen ? "최근 발송/메모 닫기" : "최근 발송/메모 보기";
  if (nextOpen) renderPricingInquiryRecentList();
}

function setRecommendedMealStatus(message, tone = "") {
  const element = qs("recommendedMealStatus");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function recommendedMealRecentTime(item) {
  return item.submittedAt || item.completedAt || item.updatedAt || item.createdAt;
}

function renderRecommendedMealRecentList() {
  const list = qs("recommendedMealHistoryList");
  const count = qs("recommendedMealHistoryCount");
  if (!list) return;
  const items = [...(state.recommendedMealProgramRequests || [])]
    .sort((a, b) => timestampMs(recommendedMealRecentTime(b)) - timestampMs(recommendedMealRecentTime(a)))
    .slice(0, 20);
  if (count) count.textContent = `${items.length}건`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">최근 추천식단 요청이 없습니다.</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const status = String(item.status || "pending");
      const inbody = item.inbody?.status === "available" ? "InBody 연결" : "InBody 확인 필요";
      const recommendation =
        item.recommendationStatus === "review_required"
          ? "운영자 검토 필요"
          : item.recommendationStatus === "ready_for_draft"
            ? "식단 초안 준비 가능"
            : "설문 대기";
      const meta = [
        formatPhoneNumber(item.memberPhone || ""),
        formatDate(recommendedMealRecentTime(item)),
        inbody,
        recommendation,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(item.memberName || "회원")}</strong>
            <p class="meta-line">${escapeHtml(meta)}</p>
            ${item.note ? `<p class="note-line">메모: ${escapeHtml(item.note)}</p>` : ""}
            ${item.lastError ? `<p class="note-line">확인: ${escapeHtml(item.lastError)}</p>` : ""}
          </div>
          ${pill(status)}
        </div>
      `;
    })
    .join("");
}

function toggleRecommendedMealHistory() {
  const panel = qs("recommendedMealHistoryPanel");
  const button = qs("recommendedMealHistoryToggle");
  if (!panel || !button) return;
  const nextOpen = panel.hidden;
  panel.hidden = !nextOpen;
  button.setAttribute("aria-expanded", String(nextOpen));
  button.textContent = nextOpen ? "최근 요청 닫기" : "최근 요청 보기";
  if (nextOpen) renderRecommendedMealRecentList();
}

function mealFlowStatus(item) {
  const status = String(item.recommendationStatus || item.status || "");
  if (["published", "sent"].includes(status)) return { label: "리포트 공개", tone: "success", stage: "sent" };
  if (status === "send_failed") return { label: "공개 실패", tone: "danger", stage: "review" };
  if (status === "approved") return { label: "공개 준비", tone: "active", stage: "review" };
  if (["awaiting_operator_review", "draft_ready", "operator_edited"].includes(status)) {
    return { label: "운영자 검토", tone: "warning", stage: "review" };
  }
  if (status === "review_required") return { label: "주의 응답 확인", tone: "danger", stage: "review" };
  if (status === "ready_for_draft") return { label: "초안 가능", tone: "active", stage: "ready" };
  if (status === "submitted") return { label: "설문 제출", tone: "active", stage: "ready" };
  return { label: "설문 대기", tone: "neutral", stage: "awaiting" };
}

function mealQueueItems() {
  const rows = [...(state.recommendedMealProgramRequests || [])].sort(
    (a, b) => timestampMs(recommendedMealRecentTime(b)) - timestampMs(recommendedMealRecentTime(a)),
  );
  if (mealQueueFilter === "sent") return rows.filter((item) => mealFlowStatus(item).stage === "sent");
  if (mealQueueFilter === "review") return rows.filter((item) => mealFlowStatus(item).stage === "review");
  return rows.filter((item) => mealFlowStatus(item).stage !== "sent");
}

function renderRecommendedMealQueue() {
  const list = qs("recommendedMealQueue");
  if (!list) return;
  const all = state.recommendedMealProgramRequests || [];
  const grouped = all.reduce(
    (acc, item) => {
      const stage = mealFlowStatus(item).stage;
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    },
    {},
  );
  setText("mealAwaitingCount", grouped.awaiting || 0);
  setText("mealReadyCount", grouped.ready || 0);
  setText("mealReviewCount", grouped.review || 0);
  setText("mealSentCount", grouped.sent || 0);
  const items = mealQueueItems();
  setText("mealQueueCount", `${items.length}건`);
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">선택한 상태의 추천식단 요청이 없습니다.</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const flow = mealFlowStatus(item);
      const selected = item.requestId === selectedMealRequestId ? " is-active" : "";
      const meta = [
        formatPhoneNumber(item.memberPhone || ""),
        item.inbody?.status === "available" ? "InBody 있음" : "InBody 없음",
        formatDate(recommendedMealRecentTime(item)),
      ]
        .filter(Boolean)
        .join(" · ");
      return `<button class="status-row meal-queue-button${selected}" type="button" data-meal-request-id="${escapeHtml(item.requestId || item.id || "")}">
        <span><strong>${escapeHtml(item.memberName || "회원")}</strong><small>${escapeHtml(meta)}</small></span>
        ${pill(flow.label, flow.tone)}
      </button>`;
    })
    .join("");
}

function mealReviewSetMessage(message, tone = "") {
  const element = qs("mealReviewMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function mealAnswerLabel(key) {
  return {
    primaryGoal: "식단 목표",
    goalDetail: "목표 상세",
    targetTimeline: "목표 기간",
    wakeTime: "기상 시간",
    sleepTime: "취침 시간",
    sleepQuality: "수면 상태",
    workType: "업무 형태",
    workIntensity: "업무 강도",
    workSchedule: "업무 시간",
    mealBreakWindow: "식사 가능 시간",
    exerciseSchedule: "운동 일정",
    mealsPerDay: "하루 식사 횟수",
    breakfastPattern: "아침 식사",
    regularMealPattern: "평소 식사",
    snackPattern: "간식",
    lateNightFrequency: "야식",
    eatingOutFrequency: "외식",
    cookingAccess: "식사 준비 환경",
    mealBudget: "식비",
    allergies: "알레르기",
    avoidFoods: "섭취 어려운 음식",
    preferredFoods: "선호 음식",
    alcoholFrequency: "음주 빈도",
    alcoholAmount: "음주량",
    smokingStatus: "흡연",
    medicalConditions: "질환·주의사항",
    medications: "복용 약물",
    pregnancyStatus: "임신·수유",
    eatingDisorderHistory: "섭식 관련 치료 경험",
    weekendDifference: "주말 패턴",
    additionalNote: "추가 메모",
  }[key] || key;
}

function renderMealSource(review) {
  const inbody = review?.inbody;
  const inbodyElement = qs("mealInbodySummary");
  if (inbodyElement) {
    if (!inbody) {
      inbodyElement.innerHTML = `<p class="meal-source-warning">연결된 InBody 측정값이 없습니다. 식단 확정 전 확인하세요.</p>`;
    } else {
      const metrics = [
        ["측정일", inbody.testAt ? formatDate(inbody.testAt) : "-"],
        ["체중", Number.isFinite(Number(inbody.weightKg)) ? `${inbody.weightKg}kg` : "-"],
        ["골격근량", Number.isFinite(Number(inbody.skeletalMuscleMassKg)) ? `${inbody.skeletalMuscleMassKg}kg` : "-"],
        ["체지방률", Number.isFinite(Number(inbody.percentBodyFat)) ? `${inbody.percentBodyFat}%` : "-"],
        ["기초대사량", Number.isFinite(Number(inbody.basalMetabolicRateKcal)) ? `${inbody.basalMetabolicRateKcal}kcal` : "-"],
        ["목표체중", Number.isFinite(Number(inbody.targetWeightKg)) ? `${inbody.targetWeightKg}kg` : "-"],
      ];
      inbodyElement.innerHTML = `<dl class="meal-source-list">${metrics
        .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
        .join("")}</dl>`;
    }
  }
  const answers = review?.response?.answers || {};
  const surveyElement = qs("mealSurveySummary");
  if (surveyElement) {
    const rows = Object.entries(answers)
      .filter(([key, value]) => key !== "consent" && value != null && String(value).trim())
      .map(([key, value]) => [mealAnswerLabel(key), Array.isArray(value) ? value.join(", ") : String(value)]);
    surveyElement.innerHTML = rows.length
      ? `<dl class="meal-answer-list">${rows
          .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
          .join("")}</dl>`
      : `<p>설문 제출 전입니다.</p>`;
  }
}

function mealDayEditorHtml(day, index) {
  const row = day || {};
  const fields = [
    ["breakfast", "아침", row.breakfast],
    ["lunch", "점심", row.lunch],
    ["dinner", "저녁", row.dinner],
    ["snack", "간식", row.snack],
    ["timingTip", "타이밍 팁", row.timingTip],
  ];
  return `<fieldset class="meal-day-editor" data-meal-day="${index}">
    <legend>${index + 1}일차</legend>
    ${fields
      .map(
        ([key, label, value]) => `<label><span>${label}</span><textarea rows="2" maxlength="500" data-meal-day-field="${key}" ${["breakfast", "lunch", "dinner"].includes(key) ? "required" : ""}>${escapeHtml(value || "")}</textarea></label>`,
      )
      .join("")}
  </fieldset>`;
}

function fillMealDraftForm(draft) {
  const form = qs("mealDraftForm");
  const content = draft?.publicContent;
  if (!form || !content) {
    if (form) form.hidden = true;
    return;
  }
  form.hidden = false;
  qs("mealTitle").value = content.title || "";
  qs("mealGoal").value = content.goal || "";
  qs("mealSummary").value = content.summary || "";
  qs("mealMetricsSummary").value = content.metricsSummary || "";
  qs("mealPrinciples").value = (content.principles || []).join("\n");
  qs("mealHydration").value = content.hydration || "";
  qs("mealExerciseNutrition").value = content.exerciseNutrition || "";
  qs("mealWeekendStrategy").value = content.weekendStrategy || "";
  qs("mealCaution").value = content.caution || "";
  qs("mealDaysEditor").innerHTML = Array.from({ length: 7 }, (_, index) => mealDayEditorHtml(content.days?.[index], index)).join("");
  const reasons = draft.reviewReasons || [];
  qs("mealReviewCheckWrap").hidden = !reasons.length;
  qs("mealReviewAcknowledged").checked = Boolean(draft.reviewAcknowledged);
  const published = ["published", "sent"].includes(state.recommendedMealReview?.report?.publicationStatus);
  form.querySelectorAll("input, textarea, button").forEach((element) => {
    element.disabled = published;
  });
  qs("mealDraftMeta").textContent = published
    ? `리포트 공개 · ${formatDate(state.recommendedMealReview.report.publishedAt || state.recommendedMealReview.report.sentAt)}`
    : `${draft.provider || "draft"} · ${draft.model || ""} · ${draft.revision?.slice(0, 10) || ""}`;
}

function renderRecommendedMealReview(review) {
  state.recommendedMealReview = review;
  const body = qs("mealReviewBody");
  const empty = qs("mealReviewEmpty");
  if (!review) {
    if (body) body.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  if (body) body.hidden = false;
  if (empty) empty.hidden = true;
  const flow = mealFlowStatus(review.request || {});
  setText("mealReviewTitle", `${review.request?.memberName || "회원"} 추천식단`);
  setText(
    "mealReviewMeta",
    [formatPhoneNumber(review.request?.memberPhone || ""), review.response?.submittedAt ? `설문 ${formatDate(review.response.submittedAt)}` : "설문 대기"]
      .filter(Boolean)
      .join(" · "),
  );
  const status = qs("mealReviewStatus");
  if (status) {
    status.textContent = flow.label;
    status.className = `pill ${flow.tone}`;
  }
  renderMealSource(review);
  fillMealDraftForm(review.draft);
  const published = ["published", "sent"].includes(review.report?.publicationStatus);
  qs("mealGenerateButton").disabled = !review.response || published;
  if (!review.response) mealReviewSetMessage("회원 설문 제출을 기다리고 있습니다.", "warn");
  else if (!review.draft) mealReviewSetMessage("설문 제출 후 식단을 자동 생성하고 있습니다. 잠시 뒤 새로고침하세요.", "warn");
  else if (published) mealReviewSetMessage("리포트가 공개되어 수정이 잠겼습니다. 회원은 최초 설문 링크에서 확인할 수 있습니다.", "good");
  else if ((review.draft.reviewReasons || []).length && !review.draft.reviewAcknowledged) {
    mealReviewSetMessage("주의 응답을 확인하고 체크한 뒤 저장해야 공개할 수 있습니다.", "warn");
  } else mealReviewSetMessage("내용을 수정·저장한 뒤 회원 확인 링크에 공개할 수 있습니다.");
}

async function loadRecommendedMealReview(requestId) {
  selectedMealRequestId = requestId;
  renderRecommendedMealQueue();
  mealReviewSetMessage("설문, InBody, 식단 초안을 불러오고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const getReview = runtime.httpsCallable(runtime.functionsClient, "getRecommendedMealProgramReview");
    const result = await getReview({ requestId });
    renderRecommendedMealReview(result?.data || null);
  } catch (error) {
    mealReviewSetMessage(error?.message || "추천식단 검토 자료를 불러오지 못했습니다.", "danger");
  }
}

async function handleMealGenerate() {
  if (!selectedMealRequestId) return;
  const button = qs("mealGenerateButton");
  if (button) {
    button.disabled = true;
    button.textContent = "초안 생성 중";
  }
  mealReviewSetMessage("설문과 최신 InBody를 반영해 7일 식단 초안을 만들고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const generate = runtime.httpsCallable(runtime.functionsClient, "generateRecommendedMealProgramDraft");
    await generate({ requestId: selectedMealRequestId });
    await loadRecommendedMealReview(selectedMealRequestId);
  } catch (error) {
    mealReviewSetMessage(error?.message || "추천식단 초안 생성에 실패했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "AI 식단 다시 생성";
    }
  }
}

function collectMealPublicContent() {
  const days = [...document.querySelectorAll("[data-meal-day]")].map((fieldset, index) => {
    const value = (key) => fieldset.querySelector(`[data-meal-day-field="${key}"]`)?.value?.trim() || "";
    return {
      day: index + 1,
      label: `${index + 1}일차`,
      breakfast: value("breakfast"),
      lunch: value("lunch"),
      dinner: value("dinner"),
      snack: value("snack"),
      timingTip: value("timingTip"),
    };
  });
  return {
    title: qs("mealTitle")?.value?.trim() || "",
    summary: qs("mealSummary")?.value?.trim() || "",
    goal: qs("mealGoal")?.value?.trim() || "",
    metricsSummary: qs("mealMetricsSummary")?.value?.trim() || "",
    principles: (qs("mealPrinciples")?.value || "").split("\n").map((value) => value.trim()).filter(Boolean),
    days,
    hydration: qs("mealHydration")?.value?.trim() || "",
    exerciseNutrition: qs("mealExerciseNutrition")?.value?.trim() || "",
    weekendStrategy: qs("mealWeekendStrategy")?.value?.trim() || "",
    caution: qs("mealCaution")?.value?.trim() || "",
  };
}

async function saveMealDraft({ quiet = false } = {}) {
  if (!selectedMealRequestId) throw new Error("검토할 추천식단 요청을 선택하세요.");
  const runtime = await initFirebase();
  const saveDraft = runtime.httpsCallable(runtime.functionsClient, "saveRecommendedMealProgramDraft");
  const result = await saveDraft({
    requestId: selectedMealRequestId,
    publicContent: collectMealPublicContent(),
    reviewAcknowledged: Boolean(qs("mealReviewAcknowledged")?.checked),
  });
  if (!quiet) mealReviewSetMessage("추천식단 수정 내용을 저장했습니다.", "good");
  return result?.data || {};
}

async function handleMealDraftSubmit(event) {
  event.preventDefault();
  const button = qs("mealSaveButton");
  if (button) {
    button.disabled = true;
    button.textContent = "저장 중";
  }
  try {
    await saveMealDraft();
    await loadRecommendedMealReview(selectedMealRequestId);
  } catch (error) {
    mealReviewSetMessage(error?.message || "추천식단 저장에 실패했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "수정 저장";
    }
  }
}

async function handleMealApproveAndSend() {
  if (!selectedMealRequestId) return;
  if (!window.confirm("현재 식단을 최종 승인하고 최초 설문 링크에 공개할까요? 공개 후에는 수정할 수 없습니다.")) return;
  const button = qs("mealSendButton");
  if (button) {
    button.disabled = true;
    button.textContent = "저장·공개 중";
  }
  mealReviewSetMessage("최종 수정 내용을 저장하고 승인 revision을 확인하고 있습니다.", "warn");
  try {
    await saveMealDraft({ quiet: true });
    const runtime = await initFirebase();
    const publish = runtime.httpsCallable(runtime.functionsClient, "operatorPublishRecommendedMealPlan");
    const result = await publish({ requestId: selectedMealRequestId, confirmPublish: true });
    const data = result?.data || {};
    if (data.status === "published") mealReviewSetMessage("추천식단을 공개했습니다. 회원은 최초 설문 알림톡 링크에서 확인할 수 있습니다.", "good");
    else mealReviewSetMessage(data.message || "추천식단 공개를 완료하지 못했습니다.", "danger");
    await refresh();
    await loadRecommendedMealReview(selectedMealRequestId);
  } catch (error) {
    mealReviewSetMessage(error?.message || "추천식단 승인·공개에 실패했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "검토 완료 후 리포트 공개";
    }
  }
}

function handleMealQueueClick(event) {
  const button = event.target.closest("[data-meal-request-id]");
  if (button) loadRecommendedMealReview(button.dataset.mealRequestId || "");
}

function handleMealFilterClick(event) {
  const button = event.target.closest("[data-meal-filter]");
  if (!button) return;
  mealQueueFilter = button.dataset.mealFilter || "active";
  document.querySelectorAll("[data-meal-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
  renderRecommendedMealQueue();
}

function setParkingStatus(message, tone = "") {
  const element = qs("parkingStatus");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function normalizeCarNumber(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function renderParkingDashboard() {
  const vehicleList = qs("parkingVehicleList");
  const jobList = qs("parkingJobList");
  const vehicleCount = qs("parkingVehicleCount");
  const jobCount = qs("parkingJobCount");
  if (!vehicleList && !jobList) return;
  const vehicles = [...(state.parkingVehicles || [])].sort((a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt));
  const jobs = [...(state.parkingJobs || [])].sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
  if (vehicleCount) vehicleCount.textContent = `${vehicles.length}대`;
  if (jobCount) jobCount.textContent = `${jobs.length}건`;

  if (vehicleList) {
    vehicleList.innerHTML = vehicles.length
      ? vehicles
          .slice(0, 20)
          .map((item) => {
            const role = item.ownerType === "staff" ? "강사" : item.ownerType === "visitor" ? "방문" : "회원";
            const phone = formatPhoneNumber(item.ownerPhone || "");
            const validDate = item.ownerType === "visitor" && item.validDate ? ` · ${escapeHtml(item.validDate)}` : "";
            const contact = item.ownerType === "visitor" ? "일회성" : phone || "연락처 없음";
            return `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(item.ownerName || "이름 없음")} · ${escapeHtml(item.carNumber || item.label || "")}</strong>
                  <p>${escapeHtml(role)} · ${escapeHtml(contact)}${validDate} · ${escapeHtml(formatDate(item.updatedAt))}</p>
                </div>
                <div class="parking-row-actions">
                  ${pill(item.status || "active")}
                  <button
                    class="parking-delete-button"
                    type="button"
                    data-parking-vehicle-id="${escapeHtml(item.vehicleId || "")}"
                    aria-label="${escapeHtml(item.ownerName || "등록")} 차량 삭제"
                    title="등록 차량 삭제"
                  >삭제</button>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">등록된 차량이 없습니다. 회원·강사는 이름 또는 연락처를, 방문 차량은 차량번호를 입력하세요.</div>`;
  }

  if (jobList) {
    jobList.innerHTML = jobs.length
      ? jobs
          .slice(0, 20)
          .map((item) => {
            const name = item.memberName || item.staffName || item.ownerName || item.visitorName || "대상";
            const result = item.result || {};
            const hours =
              result.totalSatisfiedHours || result.appliedHours || item.requestedDiscountHours
                ? `${result.totalSatisfiedHours || result.appliedHours || 0}/${item.requestedDiscountHours || 4}시간`
                : "4시간 요청";
            const reason = item.lastError || item.reason || item.jobId || item.id;
            return `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(name)} · 끝자리 ${escapeHtml(item.carNumberLast4 || "")}</strong>
                  <p>${escapeHtml(hours)} · ${escapeHtml(formatDate(item.updatedAt || item.createdAt))}${reason ? ` · ${escapeHtml(reason)}` : ""}</p>
                </div>
                ${pill(item.status || "pending")}
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state">최근 주차권 작업이 없습니다. 오늘 자동적용 실행 후 상태가 표시됩니다.</div>`;
  }
}

async function loadParkingDashboard(runtime) {
  if (!qs("parkingRegistrationForm")) return;
  try {
    const getParkingDashboard = runtime.httpsCallable(runtime.functionsClient, "getParkingDashboard");
    const result = await getParkingDashboard({});
    const data = result?.data || {};
    state.parkingVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    state.parkingJobs = Array.isArray(data.jobs) ? data.jobs : [];
    state.parkingConfig = data.config || null;
    const config = state.parkingConfig;
    if (config?.discountUnitHours && config?.maxAutoDiscountHours) {
      setText("parkingPolicyPill", `${config.discountUnitHours}시간 × ${Math.floor(config.maxAutoDiscountHours / config.discountUnitHours)}계정`);
    }
  } catch (error) {
    state.readWarnings.push({ label: "parkingDashboard", message: error?.message || String(error) });
    state.parkingVehicles = [];
    state.parkingJobs = [];
    setParkingStatus("주차등록 데이터를 불러오지 못했습니다. 운영자 권한 또는 Functions 배포 상태를 확인하세요.", "danger");
  }
  renderParkingDashboard();
}

function syncParkingVisitorFields() {
  const isVisitor = String(qs("parkingOwnerType")?.value || "member") === "visitor";
  const fields = [
    {
      field: qs("parkingOwnerNameField"),
      input: qs("parkingOwnerName"),
      placeholder: "회원명 또는 강사명",
    },
    {
      field: qs("parkingOwnerPhoneField"),
      input: qs("parkingOwnerPhone"),
      placeholder: "010-0000-0000",
    },
  ];

  fields.forEach(({ field, input, placeholder }) => {
    if (!input) return;
    if (isVisitor) input.value = "";
    input.disabled = isVisitor;
    input.placeholder = isVisitor ? "방문 차량은 입력하지 않음" : placeholder;
    field?.classList.toggle("is-disabled", isVisitor);
  });
}

async function handleParkingVehicleListClick(event) {
  const button = event.target?.closest?.("[data-parking-vehicle-id]");
  if (!button) return;
  const vehicleId = String(button.dataset.parkingVehicleId || "");
  const vehicle = (state.parkingVehicles || []).find((item) => item.vehicleId === vehicleId);
  if (!vehicle) {
    setParkingStatus("삭제할 차량을 목록에서 다시 확인하세요.", "danger");
    return;
  }
  const label = `${vehicle.ownerName || "이름 없음"} · ${vehicle.carNumber || vehicle.label || ""}`;
  if (!window.confirm(`${label} 차량을 삭제할까요?\n향후 자동 주차권 적용 대상에서 제외됩니다.`)) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "삭제 중";
  setParkingStatus(`${label} 차량을 삭제하고 회원/강사 카드 연결을 정리하고 있습니다.`, "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("등록 차량 삭제는 운영자 로그인이 필요합니다.");
      setParkingStatus("운영자 로그인 후 다시 시도하세요.", "danger");
      return;
    }
    const removeParkingVehicle = runtime.httpsCallable(runtime.functionsClient, "removeParkingVehicle");
    await removeParkingVehicle({ vehicleId });
    state.parkingVehicles = (state.parkingVehicles || []).filter((item) => item.vehicleId !== vehicleId);
    renderParkingDashboard();
    setParkingStatus(`${label} 차량을 삭제했습니다. 앞으로 자동 주차권을 적용하지 않습니다.`, "good");
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("등록 차량 삭제는 운영자 권한이 필요합니다.");
    setParkingStatus(error?.message || "등록 차량 삭제 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function handleParkingVehicleSubmit(event) {
  event.preventDefault();
  const ownerType = String(qs("parkingOwnerType")?.value || "member");
  const isVisitor = ownerType === "visitor";
  const ownerName = isVisitor ? "" : String(qs("parkingOwnerName")?.value || "").trim();
  const ownerPhone = isVisitor ? "" : normalizePhone(qs("parkingOwnerPhone")?.value || "");
  const carNumber = normalizeCarNumber(qs("parkingCarNumber")?.value || "");
  const note = String(qs("parkingNote")?.value || "").trim();
  const button = qs("parkingRegisterButton");
  if (ownerType !== "visitor" && !ownerName && !ownerPhone) {
    setParkingStatus("이름 또는 연락처를 입력하세요.", "danger");
    return;
  }
  if (!/\d{4}$/.test(carNumber) || carNumber.length < 6) {
    setParkingStatus("차량번호를 다시 확인하세요. 예: 241고2299", "danger");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "등록 중";
  }
  setParkingStatus(
    ownerType === "visitor" ? "오늘 방문 차량으로 등록하고 있습니다." : "회원/강사 매칭 후 차량을 등록하고 있습니다.",
    "warn",
  );
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("주차등록은 운영자 로그인이 필요합니다.");
      setParkingStatus("운영자 로그인 후 다시 시도하세요.", "danger");
      return;
    }
    const registerParkingVehicle = runtime.httpsCallable(runtime.functionsClient, "registerParkingVehicle");
    const result = await registerParkingVehicle({ ownerType, ownerName, ownerPhone, carNumber, note });
    const data = result?.data || {};
    const vehicle = data.vehicle || {};
    const matchStatus = String(data.matchStatus || "");
    setParkingStatus(
      isVisitor
        ? `${vehicle.ownerName || ownerName || "방문객"} 방문 차량 등록 완료. 오늘 자동적용 실행을 누르면 주차권 작업이 생성됩니다.`
        : matchStatus === "matched"
        ? `${vehicle.ownerName || ownerName} 차량 등록 완료. 오늘 수업 10분 뒤 자동 적용 대상이 됩니다.`
        : "차량은 등록했지만 회원/강사 매칭은 확인 필요입니다. 이름/연락처를 다시 확인하세요.",
      isVisitor || matchStatus === "matched" ? "good" : "warn",
    );
    qs("parkingCarNumber").value = "";
    qs("parkingNote").value = "";
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("주차등록은 운영자 권한이 필요합니다.");
    setParkingStatus(error?.message || "차량 등록 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "차량 등록";
    }
  }
}

async function handleParkingAutoApplyClick() {
  const button = qs("parkingAutoApplyButton");
  if (button) {
    button.disabled = true;
    button.textContent = "작업 생성 중";
  }
  setParkingStatus("오늘 예약과 오늘 방문 차량을 비교해 주차권 작업을 만들고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("주차권 자동적용은 운영자 로그인이 필요합니다.");
      setParkingStatus("운영자 로그인 후 다시 시도하세요.", "danger");
      return;
    }
    const runParkingAutoApplyNow = runtime.httpsCallable(runtime.functionsClient, "runParkingAutoApplyNow");
    const result = await runParkingAutoApplyNow({});
    const data = result?.data || {};
    const visitorText = data.visitorCandidates ? `, 방문 ${data.visitorCandidates || 0}건` : "";
    setParkingStatus(
      `오늘 후보 ${data.candidates || 0}건${visitorText} 중 새 작업 ${data.created || 0}건, 기존 작업 ${data.existing || 0}건입니다.`,
      "good",
    );
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("주차권 자동적용은 운영자 권한이 필요합니다.");
    setParkingStatus(error?.message || "주차권 자동적용 작업 생성 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "오늘 자동적용 실행";
    }
  }
}

async function handlePricingInquiryAlimtalkSubmit(event) {
  event.preventDefault();
  const phone = normalizePhone(qs("pricingInquiryPhone")?.value || "");
  const memberName = String(qs("pricingInquiryName")?.value || "").trim();
  const note = String(qs("pricingInquiryNote")?.value || "").trim();
  const button = qs("pricingInquirySendButton");
  if (!/^010\d{8}$/.test(phone)) {
    setPricingInquiryStatus("휴대폰 번호를 010으로 시작하는 11자리로 입력하세요.", "danger");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "발송 확인 중";
  }
  setPricingInquiryStatus("템플릿 승인, 중복 이력, 전화번호를 확인하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("수강료 안내 발송은 운영자 로그인이 필요합니다.");
      setPricingInquiryStatus("운영자 로그인 후 다시 시도하세요.", "danger");
      return;
    }
    const sendPricingInquiry = runtime.httpsCallable(runtime.functionsClient, "operatorSendPricingInquiryAlimtalk");
    const result = await sendPricingInquiry({ phone, memberName, note });
    const data = result?.data || {};
    const status = String(data.status || "");
    const message = String(data.message || "");
    if (status === "sent") {
      setPricingInquiryStatus("수강료 안내 알림톡 발송 완료.", "good");
      qs("pricingInquiryPhone").value = "";
      qs("pricingInquiryName").value = "";
      qs("pricingInquiryNote").value = "";
      await refresh();
      return;
    }
    if (status === "template_pending") {
      setPricingInquiryStatus(`SOLAPI 템플릿 승인 대기 상태입니다. 승인 후 다시 발송하세요. ${message}`, "warn");
      await refresh();
      return;
    }
    if (status === "skipped") {
      setPricingInquiryStatus(message || "중복 발송 차단으로 실제 발송하지 않았습니다.", "warn");
      await refresh();
      return;
    }
    setPricingInquiryStatus(message || "수강료 안내 발송을 완료하지 못했습니다.", "danger");
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("수강료 안내 발송은 운영자 권한이 필요합니다.");
    setPricingInquiryStatus(error?.message || "수강료 안내 발송 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "수강료 안내 발송";
    }
  }
}

async function handleRecommendedMealProgramSubmit(event) {
  event.preventDefault();
  const phone = normalizePhone(qs("recommendedMealPhone")?.value || "");
  const memberName = String(qs("recommendedMealName")?.value || "").trim();
  const note = String(qs("recommendedMealNote")?.value || "").trim();
  const button = qs("recommendedMealSendButton");
  if (!/^010\d{8}$/.test(phone)) {
    setRecommendedMealStatus("회원 휴대폰 번호를 010으로 시작하는 11자리로 입력하세요.", "danger");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "회원·InBody 확인 중";
  }
  setRecommendedMealStatus("회원카드, 최신 InBody 기록, 템플릿 승인과 중복 이력을 확인하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("추천식단 설문 발송은 운영자 로그인이 필요합니다.");
      setRecommendedMealStatus("운영자 로그인 후 다시 시도하세요.", "danger");
      return;
    }
    const sendRecommendedMeal = runtime.httpsCallable(
      runtime.functionsClient,
      "operatorSendRecommendedMealProgramAlimtalk",
    );
    const result = await sendRecommendedMeal({ phone, memberName, note });
    const data = result?.data || {};
    const status = String(data.status || "");
    const detail = String(data.message || "");
    if (status === "sent") {
      setRecommendedMealStatus("추천식단 프로그램 설문 알림톡을 발송했습니다.", "good");
      qs("recommendedMealPhone").value = "";
      qs("recommendedMealName").value = "";
      qs("recommendedMealNote").value = "";
      await refresh();
      return;
    }
    if (status === "template_pending") {
      setRecommendedMealStatus(
        "설문 링크 준비는 완료됐지만 SOLAPI 템플릿이 심사 중이라 실제 발송하지 않았습니다.",
        "warn",
      );
      await refresh();
      return;
    }
    if (status === "skipped") {
      setRecommendedMealStatus(detail || "최근 30일 동일 설문 발송 이력이 있어 중복 발송을 차단했습니다.", "warn");
      await refresh();
      return;
    }
    setRecommendedMealStatus(detail || "추천식단 설문 발송을 완료하지 못했습니다.", "danger");
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("추천식단 설문 발송은 운영자 권한이 필요합니다.");
    setRecommendedMealStatus(error?.message || "추천식단 설문 준비 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "추천식단 설문 발송";
    }
  }
}

function setRefundStatus(id, message, tone = "") {
  const element = qs(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-status${tone ? ` ${tone}` : ""}`;
}

function setRefundStep(step) {
  document.querySelectorAll("[data-refund-step]").forEach((item) => {
    const value = Number(item.dataset.refundStep || 0);
    item.classList.toggle("is-active", value === step);
    item.classList.toggle("is-complete", value < step);
  });
}

function refundRequestDate() {
  return qs("refundRequestedAt")?.value || new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function refundPayload() {
  const paidAmount = qs("refundPaidAmount")?.value;
  const money = (id) => {
    const value = qs(id)?.value;
    return value === "" || value == null ? null : Number(value);
  };
  return {
    memberName: refundFlow.member?.memberName || String(qs("refundMemberName")?.value || "").trim(),
    memberPhone: refundFlow.member?.memberPhone || normalizePhone(qs("refundMemberPhone")?.value || ""),
    ticketKey: refundFlow.selectedTicket?.ticketKey || "",
    requestedAt: `${refundRequestDate()}T00:00:00+09:00`,
    paidAmount: paidAmount === "" ? null : Number(paidAmount),
    ticketKind: qs("refundTicketKind")?.value || "count",
    normalUnitAmount: money("refundNormalUnitAmount"),
    usedCount: money("refundUsedCount"),
    totalContractWeeks: money("refundTotalContractWeeks"),
    usedWeeks: money("refundUsedWeeks"),
    giftDeductionAmount: money("refundGiftDeductionAmount"),
    manualReason: String(qs("refundManualReason")?.value || "").trim(),
    paymentSourceNote: String(qs("refundPaymentSourceNote")?.value || "").trim(),
    eligibilityReviewConfirmed: Boolean(qs("refundEligibilityCheck")?.checked),
  };
}

function updateRefundKindFields() {
  const kind = qs("refundTicketKind")?.value || "count";
  if (qs("refundCountFields")) qs("refundCountFields").hidden = kind !== "count";
  if (qs("refundPeriodFields")) qs("refundPeriodFields").hidden = kind !== "period";
  if (qs("refundNormalUnitAmount")) qs("refundNormalUnitAmount").required = kind === "count";
  if (qs("refundUsedCount")) qs("refundUsedCount").required = kind === "count";
  if (qs("refundTotalContractWeeks")) qs("refundTotalContractWeeks").required = kind === "period";
  if (qs("refundUsedWeeks")) qs("refundUsedWeeks").required = kind === "period";
}

function resetRefundPreview() {
  refundFlow.preview = null;
  if (qs("refundResult")) qs("refundResult").hidden = true;
  if (qs("refundSendPanel")) qs("refundSendPanel").hidden = true;
  if (qs("refundConfirmCheck")) qs("refundConfirmCheck").checked = false;
  if (qs("refundSendButton")) qs("refundSendButton").disabled = true;
  setRefundStatus("refundCalculationStatus", "");
  setRefundStatus("refundSendStatus", "");
}

function renderRefundTickets(tickets) {
  const list = qs("refundTicketList");
  if (!list) return;
  const legend = `<legend>환불할 수강권</legend>`;
  if (!tickets.length) {
    list.innerHTML = `${legend}<div class="empty-state">현재 환불 검토 가능한 수강권이 없습니다.</div>`;
    list.hidden = false;
    return;
  }
  list.innerHTML =
    legend +
    tickets
      .map((ticket, index) => {
        const countText =
          ticket.totalCount == null || ticket.remainingCount == null
            ? "기간권·횟수 확인 필요"
            : `잔여 ${ticket.remainingCount} / 총 ${ticket.totalCount} · 사용 ${ticket.usedCount}`;
        const amountText = ticket.expiredNow
          ? "유효기간 만료"
          : ticket.paymentAmount
            ? formatWon(ticket.paymentAmount)
            : "결제금액 확인 필요";
        const eligibilityWarnings = Array.isArray(ticket.eligibilityWarnings) ? ticket.eligibilityWarnings : [];
        return `
          <label class="refund-ticket-option">
            <input type="radio" name="refundTicket" value="${escapeHtml(ticket.ticketKey)}" ${index === 0 ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(ticket.ticketName)}</strong>
              <small>${escapeHtml(countText)} · ${escapeHtml(shortDate(ticket.expiresAt))}</small>
              ${eligibilityWarnings.length ? `<small class="refund-ticket-warning">${escapeHtml(eligibilityWarnings.join(" · "))}</small>` : ""}
            </span>
            <span class="pill ${ticket.expiredNow ? "danger" : ticket.calculationReady ? "success" : "warning"}">${escapeHtml(amountText)}</span>
          </label>
        `;
      })
      .join("");
  list.hidden = false;
  selectRefundTicket(tickets[0]?.ticketKey || "");
}

function selectRefundTicket(ticketKey) {
  const ticket = refundFlow.tickets.find((item) => item.ticketKey === ticketKey) || null;
  refundFlow.selectedTicket = ticket;
  resetRefundPreview();
  if (!ticket) {
    if (qs("refundCalculationPanel")) qs("refundCalculationPanel").hidden = true;
    return;
  }
  if (qs("refundCalculationPanel")) qs("refundCalculationPanel").hidden = false;
  if (qs("refundPaidAmount")) qs("refundPaidAmount").value = ticket.paymentAmount || "";
  if (qs("refundTicketKind")) qs("refundTicketKind").value = ticket.suggestedTicketKind || "count";
  if (qs("refundNormalUnitAmount")) qs("refundNormalUnitAmount").value = "";
  if (qs("refundUsedCount")) qs("refundUsedCount").value = ticket.usedCount ?? "";
  if (qs("refundTotalContractWeeks")) qs("refundTotalContractWeeks").value = ticket.suggestedContractWeeks ?? "";
  if (qs("refundUsedWeeks")) qs("refundUsedWeeks").value = "";
  if (qs("refundGiftDeductionAmount")) qs("refundGiftDeductionAmount").value = "0";
  if (qs("refundManualReason")) qs("refundManualReason").value = "";
  if (qs("refundPaymentSourceNote")) qs("refundPaymentSourceNote").value = "";
  if (qs("refundEligibilityCheck")) qs("refundEligibilityCheck").checked = false;
  updateRefundKindFields();
  setRefundStep(2);
  setRefundStatus(
    "refundCalculationStatus",
    ticket.expiredNow
      ? "유효기간이 지난 수강권은 환불할 수 없습니다."
      : ticket.suggestedTicketKind === "count"
        ? "정상 1회 단가를 확인한 뒤 계산하세요."
        : "홀딩을 제외한 실제 사용 주수와 근거를 확인하세요.",
    ticket.expiredNow ? "danger" : "warn",
  );
}

async function handleRefundLookup(event) {
  event.preventDefault();
  const memberName = String(qs("refundMemberName")?.value || "").trim();
  const memberPhone = normalizePhone(qs("refundMemberPhone")?.value || "");
  const button = qs("refundLookupButton");
  if (memberName.length < 2 || !/^010\d{8}$/.test(memberPhone)) {
    setRefundStatus("refundLookupStatus", "회원 이름과 010으로 시작하는 11자리 연락처를 확인하세요.", "danger");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "회원 확인 중";
  }
  setRefundStatus("refundLookupStatus", "회원카드와 현재 수강권을 확인하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("환불 처리는 운영자 로그인이 필요합니다.");
      throw new Error("운영자 로그인 후 다시 시도하세요.");
    }
    const callable = runtime.httpsCallable(runtime.functionsClient, "getRefundMemberTickets");
    const result = await callable({ memberName, memberPhone });
    const data = result?.data || {};
    refundFlow = { member: data.member || null, tickets: data.tickets || [], selectedTicket: null, preview: null };
    if (qs("refundMemberSummary")) {
      qs("refundMemberSummary").hidden = false;
      qs("refundMemberSummary").innerHTML = `
        <strong>${escapeHtml(data.member?.memberName || memberName)} · ${escapeHtml(formatPhoneForDisplay(memberPhone))}</strong>
        <span>보유 수강권 ${(data.tickets || []).length}개 · 원천 ${escapeHtml(formatDate(data.member?.sourceUpdatedAt))}</span>
      `;
    }
    renderRefundTickets(refundFlow.tickets);
    setRefundStatus("refundLookupStatus", "회원과 보유 수강권을 확인했습니다.", "good");
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("환불 처리는 운영자 권한이 필요합니다.");
    setRefundStatus("refundLookupStatus", error?.message || "회원 조회 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "보유 수강권 확인";
    }
  }
}

async function handleRefundPreview(event) {
  event.preventDefault();
  const button = qs("refundPreviewButton");
  resetRefundPreview();
  if (button) {
    button.disabled = true;
    button.textContent = "계산 중";
  }
  setRefundStatus("refundCalculationStatus", "서버에서 원천과 산식을 다시 확인하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const callable = runtime.httpsCallable(runtime.functionsClient, "previewRefund");
    const result = await callable(refundPayload());
    const data = result?.data || {};
    refundFlow.preview = data;
    const calculation = data.calculation || {};
    setText("refundResultPaid", formatWon(calculation.paidAmount));
    setText("refundResultPenalty", formatWon(calculation.penaltyAmount));
    setText("refundResultUsed", formatWon(calculation.usedAmount));
    setText("refundResultGift", formatWon(calculation.giftDeductionAmount));
    setText("refundResultAmount", formatWon(calculation.refundAmount));
    setText("refundFormula", `산정식 · ${calculation.formula || "-"}`);
    if (qs("refundMessage")) qs("refundMessage").value = calculation.message || "";
    if (qs("refundResult")) qs("refundResult").hidden = false;
    if (qs("refundSendPanel")) qs("refundSendPanel").hidden = false;
    setRefundStep(3);
    setRefundStatus(
      "refundCalculationStatus",
      calculation.requiresReview ? "직접 확인 값이 포함되어 있습니다. 근거와 금액을 한 번 더 확인하세요." : "환불 예상액을 계산했습니다.",
      calculation.requiresReview ? "warn" : "good",
    );
  } catch (error) {
    setRefundStep(2);
    setRefundStatus("refundCalculationStatus", error?.message || "환불 계산 중 오류가 발생했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "환불금액 계산";
    }
  }
}

async function handleRefundCopy() {
  const text = qs("refundMessage")?.value || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setRefundStatus("refundCalculationStatus", "회원 안내 문구를 복사했습니다.", "good");
  } catch {
    qs("refundMessage")?.select();
    setRefundStatus("refundCalculationStatus", "안내 문구를 선택했습니다. 복사해 사용하세요.", "warn");
  }
}

async function handleRefundSend() {
  const button = qs("refundSendButton");
  const confirmed = Boolean(qs("refundConfirmCheck")?.checked);
  const calculationHash = refundFlow.preview?.calculation?.calculationHash || "";
  if (!confirmed || !calculationHash) {
    setRefundStatus("refundSendStatus", "환불금액을 계산하고 확인란을 선택하세요.", "danger");
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "발송 작업 등록 중";
  }
  setRefundStatus("refundSendStatus", "이폼싸인 환불동의서 발송 작업을 등록하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const callable = runtime.httpsCallable(runtime.functionsClient, "sendRefundAgreement");
    const result = await callable({ ...refundPayload(), calculationHash, confirmed: true });
    const data = result?.data || {};
    const duplicate = data.status === "duplicate_blocked";
    const queued = data.status === "agreement_queued";
    setRefundStatus(
      "refundSendStatus",
      duplicate
        ? "동일 계산값의 환불동의서 작업이 이미 있어 중복 등록을 차단했습니다."
        : queued
          ? "환불동의서 발송 대기에 등록했습니다. 발송 결과는 최근 처리에서 확인할 수 있습니다."
          : "이폼싸인 환불동의서 발송을 완료했습니다.",
      duplicate ? "warn" : "good",
    );
    if (!duplicate) {
      setText("refundSendButton", queued ? "발송 대기" : "발송 완료");
      await refresh();
    }
  } catch (error) {
    setRefundStatus("refundSendStatus", error?.message || "이폼싸인 발송 작업 등록 중 오류가 발생했습니다.", "danger");
    if (button) button.disabled = false;
  } finally {
    if (button && !["발송 완료", "발송 대기"].includes(button.textContent)) {
      button.textContent = "이폼싸인 환불동의서 발송 요청";
      button.disabled = !confirmed;
    }
  }
}

function renderRefundCases() {
  const list = qs("refundCaseList");
  if (!list) return;
  const cases = state.refundCases || [];
  setText("refundCaseCount", `${cases.length.toLocaleString("ko-KR")}건`);
  list.innerHTML = cases.length
    ? cases
        .slice(0, 20)
        .map((item) => {
          const status = String(item.status || "");
          const tone = status === "agreement_sent" ? "success" : status === "send_review_required" ? "danger" : "warning";
          const label =
            status === "agreement_sent"
              ? "동의서 발송"
              : status === "send_review_required"
                ? "발송 결과 확인"
                : status === "sending"
                  ? "발송 중"
                  : status === "agreement_queued"
                    ? "발송 대기"
                  : "검토";
          return `
            <div class="status-row">
              <div>
                <strong>${escapeHtml(item.memberName || "회원")} · ${escapeHtml(item.ticketName || "수강권")}</strong>
                <p>끝자리 ${escapeHtml(item.memberPhoneLast4 || "-")} · 예상 환불 ${escapeHtml(formatWon(item.calculation?.refundAmount))} · ${escapeHtml(formatDate(item.updatedAt))}</p>
              </div>
              <span class="pill ${tone}">${label}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-state">처리 이력이 없습니다.</div>`;
}

function formatPhoneForDisplay(value) {
  return normalizePhone(value).replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
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

function activeBookingForLesson(item) {
  const status = String(item.appStatus || item.bookingStatus || item.status || "").toLowerCase();
  const sourceStatus = String(item.sourceStatus || item.reconcileStatus || "").toLowerCase();
  if (["cancel", "canceled", "cancelled", "deleted", "inactive", "wait", "waiting", "취소", "대기"].includes(status)) return false;
  if (
    [
      "missing_from_latest_reservation_import",
      "superseded_by_latest_reservation_import",
      "duplicate",
      "취소",
      "대기",
    ].includes(sourceStatus)
  ) {
    return false;
  }
  return item.active !== false;
}

function lessonBookingStart(item) {
  return item.lectureStartAt || item.startsAt || item.startAt || `${item.lectureDate || item.date || ""} ${item.startTime || "00:00"}`;
}

function lessonOccurrenceKey(item) {
  const lectureId = String(item.lectureId || "").trim();
  const lessonDate = dateKey(lessonBookingStart(item)) || item.lectureDate || item.date;
  const lessonTime = item.startTime || compactDateTime(lessonBookingStart(item));
  return [
    lectureId ? `lecture:${lectureId}` : "lecture:unknown",
    lessonDate,
    lessonTime,
    item.staffId || item.staffName || item.instructorName,
    item.lectureTitle || item.lessonTitle || item.title,
  ]
    .filter(Boolean)
    .join("|");
}

function deriveLessonOccurrencesFromBookings(bookings = []) {
  const grouped = new Map();
  for (const booking of studioItems(bookings).filter(activeBookingForLesson)) {
    const key = lessonOccurrenceKey(booking);
    if (!key) continue;
    const current = grouped.get(key) || {
      id: key,
      studioId: booking.studioId || STUDIO_ID,
      startsAt: lessonBookingStart(booking),
      lessonDate: booking.lectureDate || booking.lessonDate || booking.date,
      lessonTitle: booking.lectureTitle || booking.lessonTitle || booking.title || "수업명 없음",
      staffId: booking.staffId || "",
      staffName: booking.staffName || booking.instructorName || "강사 미지정",
      lessonType: booking.lessonType || booking.ticketClassType || normalizedLessonKind(booking),
      roomName: booking.roomName || booking.room || "",
      capacity: toNumber(booking.capacity || booking.maxCapacity || booking.lectureCapacity),
      reservationCount: 0,
      sourceKind: "bookings",
      sourceUpdatedAt: booking.sourceUpdatedAt || booking.syncedAt || booking.updatedAt,
    };
    current.reservationCount += 1;
    if (timestampMs(booking.sourceUpdatedAt || booking.syncedAt || booking.updatedAt) > timestampMs(current.sourceUpdatedAt)) {
      current.sourceUpdatedAt = booking.sourceUpdatedAt || booking.syncedAt || booking.updatedAt;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function normalizedLessonKind(item) {
  const text = [
    item?.lessonType,
    item?.ticketClassType,
    item?.ticketType,
    item?.lectureTitle,
    item?.lessonTitle,
    item?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (["private", "semi", "프라이빗", "세미", "개인", "1:1"].some((token) => text.includes(token))) return "private";
  if (["group", "그룹"].some((token) => text.includes(token))) return "group";
  return "other";
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
  const bookingsState = readState("bookings");
  if (readUnavailable("bookings")) {
    ["lessonsTodayCount", "lessonsWeekCount", "lessonsGroupCount", "lessonsPrivateCount"].forEach((id) => setText(id, "-"));
    setPillText("lessonsTodayStatus", "blocked");
    setPillText("lessonsInstructorStatus", "blocked");
    qs("lessonsTodayList").innerHTML = `<div class="empty-state error-state">예약 원본을 읽지 못했습니다. 0건으로 판단하지 말고 권한과 동기화 상태를 확인하세요.</div>`;
    qs("lessonsInstructorList").innerHTML = `<div class="empty-state error-state">예약 원본 연결 후 강사별 수업을 표시합니다.</div>`;
    qs("lessonsSourceList").innerHTML = `<div class="empty-state error-state">${escapeHtml(bookingsState.message || "bookings 읽기 실패")}</div>`;
    return;
  }
  const bookingLessons = deriveLessonOccurrencesFromBookings(reservations);
  const items = bookingLessons
    .filter((item) => timestampMs(item.startsAt || item.lessonDate || item.startAt))
    .sort((a, b) => timestampMs(a.startsAt || a.lessonDate || a.startAt) - timestampMs(b.startsAt || b.lessonDate || b.startAt));
  const now = new Date();
  const todayLessons = items.filter((item) => dateKey(item.startsAt || item.lessonDate || item.startAt) === dateKey(now));
  const weekLessons = items.filter((item) => isWithinDays(item.startsAt || item.lessonDate || item.startAt, now, 7));
  const groupLessons = todayLessons.filter((item) => normalizedLessonKind(item) === "group");
  const privateLessons = todayLessons.filter((item) => normalizedLessonKind(item) === "private");
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
      : `<div class="empty-state">오늘 기준 수업이 없습니다. 가져온 데이터 기간 또는 처리 상태를 확인하세요.</div>`;
  }

  const byInstructor = new Map();
  weekLessons.forEach((item) => {
    const staff = item.staffName || item.instructorName || "강사 미지정";
    const current = byInstructor.get(staff) || { count: 0, reservations: 0, group: 0, private: 0 };
    current.count += 1;
    current.reservations += toNumber(item.reservationCount);
    const type = normalizedLessonKind(item);
    if (type === "private") current.private += 1;
    else if (type === "group") current.group += 1;
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
    const sourceUpdatedAt = Math.max(...items.map((item) => timestampMs(item.sourceUpdatedAt || item.updatedAt)), 0);
    sourceList.innerHTML = `
      <div class="status-row">
        <div>
          <strong>예약 원본에서 수업 ${items.length.toLocaleString("ko-KR")}개 구성</strong>
          <p>이번주 ${weekLessons.length.toLocaleString("ko-KR")}개 · 예약 행 ${reservationItems.length.toLocaleString("ko-KR")}개 · ${escapeHtml(sourceAgeText(sourceUpdatedAt))}</p>
          <p>${escapeHtml(sourceKinds.join(", ") || "bookings")}</p>
        </div>
        ${pill(items.length ? "success" : "warning")}
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
            <p>삭제 수업 로그가 비어 있어 인원미달 폐강과 시간표 조정을 자동 분류하지 않습니다.</p>
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
    setText("memberDetailSubtitle", "Members 목록에서 회원을 선택하면 상세 정보를 표시합니다.");
    return;
  }
  if (detail?.missing) {
    setText("memberDetailName", "회원 문서 없음");
    setText("memberDetailSubtitle", `${detail.id} 회원 문서를 찾지 못했습니다.`);
    return;
  }

  const profile = detail?.profile || {};
  const member = { ...(detail?.card || {}), ...(detail?.member || {}), ...profile };
  const summary = detail?.summary || {};
  const merged = {
    ...detail?.card,
    ...(detail?.member || {}),
    ...summary,
    ...profile,
    currentTicketsSummary: hasProfileActiveTicketsField(profile)
      ? profileActiveTickets(profile)
      : summary.currentTicketsSummary || detail?.card?.currentTicketsSummary || detail?.member?.currentTicketsSummary || [],
  };
  const signals = merged.signals || detail?.card?.signals || [];
  const tickets = hasProfileActiveTicketsField(profile) ? profileActiveTickets(profile) : detail?.tickets?.length ? detail.tickets : merged.currentTicketsSummary || [];
  const activeTicketCount = hasProfileActiveTicketsField(profile) ? tickets.length : toNumber(member.activeTicketCount || tickets.length);
  const purchases = purchaseRowsWithProfileTickets(detail?.purchases?.length ? detail.purchases : merged.recentPurchases || [], profile);
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
  setText("memberDetailTickets", formatCount(activeTicketCount, "개"));
  setText("memberDetailBookings", formatCount(member.bookingCount || bookings.length));
  setText("memberDetailRecentVisit", compactDateTime(member.recentVisitAt));
  setText("memberDetailRegisteredAt", shortDate(member.registeredAt));
  setText("memberDetailUpdatedAt", formatDate(member.updatedAt || summary.updatedAt));
  setText("memberDetailMemoCount", formatCount(memos.length));
  setText("memberDetailAlimtalkCount", formatCount(alimtalkLogs.length));
  setText("memberDetailQualityCount", formatCount(relatedIssues.length));

  const lastVisitText = member.recentVisitAt ? compactDateTime(member.recentVisitAt) : "최근 방문 없음";
  if (relatedIssues.length) {
    setPillText("memberDetailPrimaryActionTone", "warning");
    setText("memberDetailPrimaryAction", "품질 이슈 먼저 확인");
    setText("memberDetailPrimaryActionNote", "전화번호, 임시 ID, 중복 기록 여부를 확인하기 전에는 외부 실행으로 넘기지 않습니다.");
  } else if (openSignals.length) {
    setPillText("memberDetailPrimaryActionTone", "warning");
    setText("memberDetailPrimaryAction", "주의 신호 확인");
    setText("memberDetailPrimaryActionNote", "수강권, 메모, 알림톡 상태를 먼저 확인하고 필요하면 운영자가 직접 판단합니다.");
  } else {
    setPillText("memberDetailPrimaryActionTone", "success");
    setText("memberDetailPrimaryAction", "긴급 신호 낮음");
    setText("memberDetailPrimaryActionNote", "현재 기준으로 즉시 멈춰야 할 품질/주의 신호는 보이지 않습니다.");
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
  setText("memberDetailGuardrail", "검토용");
  setText("memberDetailGuardrailNote", "알림톡, 연락처, StudioMate 반영 전에는 회원 매칭 상태를 다시 확인합니다.");

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
          : "현재 기준 긴급 신호는 보이지 않습니다.",
        status: openSignals.length ? "warning" : "success",
      },
      {
        title: activeTicketCount ? "수강권 보유" : "수강권 확인 필요",
        detail: activeTicketCount
          ? "현재 수강권 요약이 있어 최근 예약/출석과 함께 보면 됩니다."
          : "활성 수강권 요약이 없으므로 상담/미등록/만료 상태를 확인하세요.",
        status: activeTicketCount ? "active" : "warning",
      },
      {
        title: relatedIssues.length ? "데이터 품질 이슈 있음" : "품질 이슈 없음",
        detail: relatedIssues.length
          ? "전화번호, 임시 ID, 중복 기록 등 외부 실행 전 확인이 필요합니다."
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
    detail: (item) => {
      const amount = toNumber(item.amountTotal ?? item.price ?? item.amount ?? item.revenue);
      return [shortDate(item.paymentDate || item.purchasedAt || item.createdAt), amount ? formatManwon(amount) : ""].filter(Boolean).join(" · ");
    },
    status: (item) => item.status || item.ticketStatus || item.paymentMethod || item.category,
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
    title: (item) => alimtalkTemplateTitle(item),
    detail: (item) =>
      [shortDate(item.sentAt || item.createdAt), humanizeAlimtalkTemplateText(item.reason || item.message || item.managementNumber)]
        .filter(Boolean)
        .join(" · "),
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

function privateProgressStatus(value) {
  const status = String(value || "").toLowerCase();
  if (timestampMs(value) && status.includes("t")) return "success";
  if (["submitted", "done", "completed", "success", "draft_created"].includes(status)) return "success";
  if (["failed", "error", "blocked"].includes(status)) return "failed";
  if (["pending", "pre_submitted", "reviewing"].includes(status)) return "warning";
  return status || "pending";
}

function privateStepPill(label, value) {
  const status = privateProgressStatus(value);
  const tone = normalizeStatus(status);
  return `<span class="pill ${tone}">${escapeHtml(label)} ${escapeHtml(statusLabel(status))}</span>`;
}

function privateKeySet(item) {
  return [
    item.id,
    item.requestId,
    item.recordId,
    item.bookingId,
    item.candidateId,
    item.sendId,
    item.ledgerId,
    item.usageEventId,
    item.dedupeKey,
  ]
    .filter(Boolean)
    .map((value) => String(value));
}

function matchesPrivateProgress(source, target) {
  const keys = privateKeySet(source);
  const targetText = privateKeySet(target).join(" ");
  return keys.some((key) => targetText.includes(key));
}

function findPrivateReportSend(row, candidates, sends) {
  const related = [...candidates, ...sends].filter((item) => {
    const typeText = [item.type, item.title, item.templateCode, item.candidateId, item.dedupeKey, item.id].filter(Boolean).join(" ").toLowerCase();
    const looksLikeReport = typeText.includes("private_lesson_report") || typeText.includes("manual_private_chart") || typeText.includes("리포트");
    const looksLikeStaffInput = typeText.includes("staff_private_lesson_chart") || typeText.includes("instructor");
    return looksLikeReport && !looksLikeStaffInput && matchesPrivateProgress(row, item);
  });
  return related.sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt))[0] || null;
}

function privateProgressRows(requests, records, ledgerEntries, candidates = [], sends = []) {
  const recordById = new Map(records.flatMap((record) => privateKeySet(record).map((key) => [key, record])));
  return requests
    .map((request) => {
      const record = privateKeySet(request).map((key) => recordById.get(key)).find(Boolean) || null;
      const merged = { ...record, ...request };
      const ledger =
        ledgerEntries.find((item) => {
          const sameMember = item.memberId && item.memberId === merged.memberId;
          const sameRound =
            String(item.cumulativePrivateRound || item.currentTicketRound || "") === String(merged.sessionNumber || "");
          const sameDate = dateKey(item.startsAt) && dateKey(item.startsAt) === dateKey(merged.lessonStartAt || merged.lessonDate);
          return sameMember && (sameRound || sameDate);
        }) || null;
      const send = findPrivateReportSend({ ...merged, ...record }, candidates, sends);
      return { request, record, ledger, send, merged };
    })
    .sort(
      (a, b) =>
        (privateProgressTimeMs(b) || timestampMs(b.merged.createdAt)) -
        (privateProgressTimeMs(a) || timestampMs(a.merged.createdAt)),
    );
}

function privateProgressTimeMs(row) {
  return [
    row.merged?.lessonStartAt,
    row.merged?.lessonDate,
    row.merged?.startsAt,
    row.merged?.startAt,
    row.merged?.scheduledAt,
    row.request?.lessonStartAt,
    row.request?.lessonDate,
    row.request?.startsAt,
    row.request?.startAt,
    row.request?.scheduledAt,
    row.ledger?.startsAt,
  ]
    .map(timestampMs)
    .find(Boolean) || 0;
}

function currentPrivateProgressRows(rows, referenceDate = new Date()) {
  const start = todayStartMs(referenceDate);
  return rows.filter((row) => {
    const ms = privateProgressTimeMs(row);
    return ms && ms >= start;
  });
}

function privateStage(row) {
  const preDone = privateProgressStatus(row.request.preStatus || row.record?.preSubmittedAt) === "success";
  const postDone = privateProgressStatus(row.request.postStatus || row.record?.postSubmittedAt) === "success";
  const reportDone = privateReportReady(row);
  const sendDone = ["done", "sent", "success", "completed"].includes(String(row.send?.status || "").toLowerCase());
  if (!preDone) return "pre";
  if (!postDone) return "post";
  if (!reportDone) return "report";
  if (!sendDone) return "send";
  return "complete";
}

function privateReportReady(row) {
  const record = row.record || {};
  const gptStatus = String(record.gptStatus || "").toLowerCase();
  return Boolean(
    record.postSubmittedAt &&
      ["draft_created", "approved", "published"].includes(gptStatus) &&
      (record.publicReportUrl || record.publicReportCanonicalUrl),
  );
}

function pendingPrivateProgressRows() {
  if ((state.privateSessions || []).length) {
    return currentPrivateSessionRows(state.privateSessions).filter(
      (session) => !["delivered", "cancelled"].includes(String(session.workflowStage || "")),
    );
  }
  const rows = privateProgressRows(
    state.privateRequests || [],
    state.privateRecords || [],
    state.privateLedgerEntries || [],
    state.alimtalkCandidates || [],
    state.alimtalkSends || [],
  );
  return currentPrivateProgressRows(rows).filter((row) => privateStage(row) !== "complete");
}

function currentPrivateSessionRows(sessions, referenceDate = new Date()) {
  const start = todayStartMs(referenceDate);
  return [...sessions]
    .filter((session) => {
      const ms = timestampMs(session.lessonStartAt || session.lessonDate);
      return ms && ms >= start;
    })
    .sort((a, b) => timestampMs(a.lessonStartAt || a.lessonDate) - timestampMs(b.lessonStartAt || b.lessonDate));
}

function privateSessionLine(session) {
  const round = Number(session.sessionNumber || 0) > 0 ? `${session.sessionNumber}회차` : "회차 확인";
  const ms = timestampMs(session.lessonStartAt || session.lessonDate);
  const date = new Date(ms);
  const dateText = Number.isNaN(date.getTime())
    ? "-"
    : `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${session.memberName || session.memberId || session.sessionId} ${round} ${dateText} ${session.staffName || "강사 미지정"}`;
}

function renderPrivateSessionCard(session) {
  return `
    <div class="stage-card">
      <strong>${escapeHtml(privateSessionLine(session))}</strong>
      <p>${escapeHtml(session.nextAction || "상태 확인")}</p>
      <div class="tag-row">
        <span class="pill ${session.roundVerified === false ? "warn" : "good"}">${session.roundVerified === false ? "회차 확인" : "회차 확인됨"}</span>
        ${session.lastError ? `<span class="pill warn">오류 확인</span>` : ""}
      </div>
    </div>
  `;
}

function renderPrivateSessions(sessions) {
  const list = qs("privateProgressList");
  if (!list) return;
  const rows = currentPrivateSessionRows(sessions);
  const activeRows = rows.filter((row) => row.workflowStage !== "cancelled");
  const groups = {
    preparation: activeRows.filter((row) => ["preparation", "needs_review"].includes(row.workflowStage)),
    recording: activeRows.filter((row) => row.workflowStage === "recording"),
    report_review: activeRows.filter((row) => row.workflowStage === "report_review"),
    delivered: activeRows.filter((row) => row.workflowStage === "delivered"),
  };
  const pendingRows = activeRows.filter((row) => row.workflowStage !== "delivered");
  setText("privatePendingCount", formatCount(pendingRows.length));
  setText("privatePreStageCount", formatCount(groups.preparation.length));
  setText("privatePostStageCount", formatCount(groups.recording.length));
  setText("privateCompleteStageCount", formatCount(groups.delivered.length));
  setPillText("privateProgressStatus", pendingRows.length ? "warning" : "success");

  const byStaff = new Map();
  pendingRows.forEach((row) => {
    const staff = row.staffName || "강사 미지정";
    if (!byStaff.has(staff)) byStaff.set(staff, []);
    byStaff.get(staff).push(row);
  });
  setPillText("privateInstructorPendingStatus", pendingRows.length ? "warning" : "success");
  const staffList = qs("privateInstructorPendingList");
  if (staffList) {
    staffList.innerHTML = pendingRows.length
      ? [...byStaff.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(
            ([staff, staffRows]) => `
              <div class="status-row">
                <div><strong>${escapeHtml(staff)} · ${staffRows.length.toLocaleString("ko-KR")}건</strong><p>${escapeHtml(staffRows.slice(0, 4).map(privateSessionLine).join(" / "))}</p></div>
                ${pill("warning")}
              </div>
            `,
          )
          .join("")
      : `<div class="empty-state">진행 안 된 프라이빗 수업이 없습니다.</div>`;
  }

  list.innerHTML = [
    ["preparation", "수업 준비", groups.preparation],
    ["recording", "수업 기록", groups.recording],
    ["report_review", "리포트 확인", groups.report_review],
    ["delivered", "전달 완료", groups.delivered],
  ]
    .map(
      ([key, title, stageRows]) => `
        <article class="stage-column stage-${key}">
          <div class="stage-column-header"><strong>${escapeHtml(title)}</strong><span>${stageRows.length.toLocaleString("ko-KR")}건</span></div>
          <div class="stage-card-list">
            ${stageRows.length ? stageRows.slice(0, 20).map(renderPrivateSessionCard).join("") : `<div class="empty-state">해당 단계 수업 없음</div>`}
          </div>
        </article>
      `,
    )
    .join("");
}

function privatePendingBreakdown(rows) {
  return rows.reduce(
    (acc, row) => {
      acc[privateStage(row)] += 1;
      return acc;
    },
    { pre: 0, post: 0, report: 0, send: 0 },
  );
}

function formatPrivateClassLine(row) {
  const round = row.merged.sessionNumber || row.ledger?.cumulativePrivateRound || row.ledger?.currentTicketRound || "-";
  const date = new Date(privateProgressTimeMs(row));
  const dateText = Number.isNaN(date.getTime())
    ? "-"
    : `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${row.merged.memberName || row.merged.memberId || row.request.id} ${round}회차 ${dateText} ${row.merged.staffName || "강사 미지정"}`;
}

function renderPrivateStageCard(row) {
  const stage = privateStage(row);
  const reportReady = privateReportReady(row);
  const sendStatus = row.send?.status || "pending";
  return `
    <div class="stage-card">
      <strong>${escapeHtml(formatPrivateClassLine(row))}</strong>
      <p>${escapeHtml(row.merged.bookingId || row.merged.requestId || row.request.id)}</p>
      <div class="tag-row">
        ${privateStepPill("사전", row.request.preStatus || row.record?.preSubmittedAt)}
        ${privateStepPill("사후", row.request.postStatus || row.record?.postSubmittedAt)}
        ${privateStepPill("리포트", reportReady ? "success" : row.record?.gptStatus || "pending")}
        ${privateStepPill("전송", sendStatus)}
      </div>
      ${stage === "complete" ? `<p>완료</p>` : ""}
    </div>
  `;
}

function renderPrivateInstructorPending(rows) {
  const list = qs("privateInstructorPendingList");
  if (!list) return;
  const pendingRows = rows.filter((row) => privateStage(row) !== "complete");
  const byStaff = new Map();
  pendingRows.forEach((row) => {
    const staff = row.merged.staffName || "강사 미지정";
    if (!byStaff.has(staff)) byStaff.set(staff, []);
    byStaff.get(staff).push(row);
  });
  setPillText("privateInstructorPendingStatus", pendingRows.length ? "warning" : "success");
  list.innerHTML = pendingRows.length
    ? [...byStaff.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(
          ([staff, staffRows]) => `
            <div class="status-row">
              <div>
                <strong>${escapeHtml(staff)} · ${staffRows.length.toLocaleString("ko-KR")}건</strong>
                <p>${escapeHtml(staffRows.slice(0, 4).map(formatPrivateClassLine).join(" / "))}</p>
              </div>
              ${pill("warning")}
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">진행 안 된 프라이빗 차트가 없습니다.</div>`;
}

function renderPrivateProgress(requests, records, ledgerEntries, candidates = [], sends = []) {
  const list = qs("privateProgressList");
  if (!list) return;
  const allRows = privateProgressRows(requests, records, ledgerEntries, candidates, sends);
  const rows = currentPrivateProgressRows(allRows);
  renderPrivateInstructorPending(rows);

  const groups = {
    pre: rows.filter((row) => privateStage(row) === "pre"),
    post: rows.filter((row) => privateStage(row) === "post"),
    report: rows.filter((row) => privateStage(row) === "report"),
    send: rows.filter((row) => privateStage(row) === "send"),
    complete: rows.filter((row) => privateStage(row) === "complete"),
  };
  setText("privatePendingCount", formatCount(rows.length - groups.complete.length));
  setText("privatePreStageCount", formatCount(groups.pre.length));
  setText("privatePostStageCount", formatCount(groups.post.length));
  setText("privateCompleteStageCount", formatCount(groups.complete.length));
  setPillText("privateProgressStatus", rows.length && rows.length === groups.complete.length ? "success" : "warning");

  list.innerHTML = rows.length
    ? [
        ["pre", "수업전 설문 단계", groups.pre],
        ["post", "수업후 설문 단계", groups.post],
        ["report", "리포트 완성 단계", groups.report],
        ["send", "리포트 전송 단계", groups.send],
        ["complete", "완료 단계", groups.complete],
      ]
        .map(
          ([key, title, stageRows]) => `
            <article class="stage-column stage-${key}">
              <div class="stage-column-header"><strong>${escapeHtml(title)}</strong><span>${stageRows.length.toLocaleString("ko-KR")}건</span></div>
              <div class="stage-card-list">
                ${stageRows.length ? stageRows.slice(0, 12).map(renderPrivateStageCard).join("") : `<div class="empty-state">해당 단계 수업 없음</div>`}
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">오늘 이후 진행 대상 프라이빗 차트가 없습니다.</div>`;
}

function renderPrivate(requests, records, ledgerEntries, candidates = [], sends = [], sessions = []) {
  if (!qs("privateProgressList")) return;
  if (sessions.length) {
    setText("privateRequestCount", String(sessions.length));
    setText("privateRecordCount", String(sessions.filter((item) => item.postStatus === "submitted").length));
    setText("privateUsageCount", String(sessions.filter((item) => item.bookingId).length));
    setText("privateLedgerCount", String(sessions.filter((item) => item.roundVerified).length));
    setText("privateRecordHealth", sessions.some((item) => item.lastError) ? "확인할 오류 있음" : "진행 데이터 정상");
    setText("privateSubmittedCount", formatCount(sessions.filter((item) => item.preStatus === "submitted").length));
    setText("privateCorrectionCount", formatCount(sessions.filter((item) => item.roundVerified === false).length));
    renderPrivateSessions(sessions);
    return;
  }
  setText("privateRequestCount", String(requests.length));
  setText("privateRecordCount", String(records.length));
  setText("privateUsageCount", String(requests.filter((item) => item.bookingId).length));
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
  renderPrivateProgress(requests, records, ledgerEntries, candidates, sends);
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
      pretaxAmount: toNumber(row.세전총액),
      payoutAmount: toNumber(row.실지급액),
    }))
    .filter((row) => row.month && row.name);

  const instructorStats = (data?.강사통계 || [])
    .map((row) => ({
      month: normMonth(row.월),
      name: String(row.강사 || ""),
      reservationRate: toNumber(row.그룹예약률),
      attendanceRate: toNumber(row.그룹출석률),
      averageGroupMembers: toNumber(row.그룹평균인원),
      groupLessonCount: (() => {
        const source = row.그룹수업수 ?? row.그룹수업 ?? row.그룹횟수 ?? row.월수업수 ?? row.수업수;
        return source === undefined || source === null || source === "" ? null : toNumber(source);
      })(),
    }))
    .filter((row) => row.month && row.name)
    .sort((a, b) => a.month.localeCompare(b.month));

  const ticketTop = (data?.수강권TOP5 || [])
    .map((row) => ({
      month: normMonth(row.월),
      label: String(row.라벨 || row.수강권명 || ""),
      value: toNumber(row.값),
      hiddenKinds: toNumber(row.종류수),
    }))
    .filter((row) => row.month && row.label);

  const memberMetrics = (data?.월별회원지표 || [])
    .map((row) => ({
      month: normMonth(row.월),
      ticketMembers: toNumber(row.수강권보유회원수),
      bookingMembers: toNumber(row.예약이용회원수),
      attendedMembers: toNumber(row.출석회원수),
      activeReservationRows: toNumber(row.유효예약행수),
      normalizedReservationRows: toNumber(row.정규화예약건수),
      source: String(row.산출원천 || "bookings"),
      rule: String(row.산출기준 || ""),
    }))
    .filter((row) => row.month)
    .sort((a, b) => a.month.localeCompare(b.month));

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
    instructorStats,
    ticketTop,
    memberMetrics,
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
    container.innerHTML = `<div class="empty-state">월별 요약 데이터가 없습니다.</div>`;
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
  const currentMember = snapshot.memberMetrics.find((row) => row.month === current.month);
  const previousYearMonth = `${Number(current.month.slice(0, 4)) - 1}-${current.month.slice(5, 7)}`;
  const previousYearMember = snapshot.memberMetrics.find((row) => row.month === previousYearMonth);
  const daily = latestDailyForMonth(snapshot, current.month);

  setText("businessMonthLabel", `${formatMonth(current.month)} 기준`);
  setText("businessHeroValue", `${formatManwon(current.totalRevenue)} 총매출`);
  setText(
    "businessHeroNote",
    daily ? `${daily.date} 누적 기준` : "월 요약 기준",
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
  setText("businessTicketMembers", currentMember ? formatCount(currentMember.ticketMembers, "명") : "-");
  setText("businessBookingMembers", currentMember ? formatCount(currentMember.bookingMembers, "명") : "-");
  setText("businessAttendedMembers", currentMember ? formatCount(currentMember.attendedMembers, "명") : "-");
  setText(
    "businessTicketMembersNote",
    currentMember ? memberCountDeltaText(currentMember.ticketMembers, previousYearMember?.ticketMembers, "전년동월") : "정산 시트 기준",
  );
  setText(
    "businessBookingMembersNote",
    currentMember ? memberCountDeltaText(currentMember.bookingMembers, previousYearMember?.bookingMembers, "전년동월") : "예약 원천 기준",
  );
  setText(
    "businessAttendedMembersNote",
    currentMember ? memberCountDeltaText(currentMember.attendedMembers, previousYearMember?.attendedMembers, "전년동월") : "출석 완료 기준",
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

function formatWon(value) {
  const amount = toNumber(value);
  if (!Number.isFinite(amount)) return "-";
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

function ticketLiabilityMonths(items) {
  const byMonth = new Map();
  for (const item of items || []) {
    if (item.reportKind !== "studiomate_ticket_liability" || item.status !== "ready") continue;
    const month = normMonth(item.reportMonth || item.asOfDate);
    if (!month) continue;
    const existing = byMonth.get(month);
    if (!existing || (existing.id === "current" && item.id !== "current")) byMonth.set(month, item);
  }
  return [...byMonth.entries()]
    .map(([month, report]) => ({ month, report }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function previousMonthKey(month) {
  const [year, monthNumber] = String(month || "").split("-").map(Number);
  if (!year || !monthNumber) return "";
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function renderTicketLiabilityMonth(month) {
  const reports = ticketLiabilityMonths(state.ticketLiabilityReports);
  const selected = reports.find((item) => item.month === month) || reports[0];
  const table = qs("ticketLiabilityTableBody");
  if (!selected || !table) return renderTicketLiabilityFallback();
  const report = selected.report;
  const totals = report.totals || {};
  const coverage = report.coverage || {};
  const unitPriceAverages = report.unitPriceAverages || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const previous = reports.find((item) => item.month === previousMonthKey(selected.month));
  const currentValue = toNumber(totals.estimatedResidualValue);
  const previousValue = toNumber(previous?.report?.totals?.estimatedResidualValue);

  setText("ticketLiabilityHolders", formatCount(totals.activeHolders, "명"));
  setText("ticketLiabilityRemaining", formatCount(toNumber(totals.remainingCountEquivalent).toFixed(1), "회"));
  setText("ticketLiabilityValue", formatWon(currentValue));
  if (previous && previousValue > 0) {
    const delta = currentValue - previousValue;
    const deltaRate = (delta / previousValue) * 100;
    const direction = delta > 0 ? "▲" : delta < 0 ? "▼" : "―";
    const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
    setText("ticketLiabilityDelta", `${direction} ${sign}${formatWon(Math.abs(delta))}`);
    setText("ticketLiabilityDeltaRate", `${deltaRate > 0 ? "+" : ""}${deltaRate.toFixed(1)}% · ${formatMonth(previous.month)} 대비`);
  } else {
    setText("ticketLiabilityDelta", "비교 대기");
    setText("ticketLiabilityDeltaRate", `${formatMonth(previousMonthKey(selected.month))} 스냅샷 없음`);
  }
  setText("ticketLiabilityCoverage", `${(toNumber(coverage.directPriceCoverage) * 100).toFixed(1)}%`);
  for (const [key, id, basisId] of [
    ["group", "ticketLiabilityGroupAverage", "ticketLiabilityGroupAverageBasis"],
    ["private", "ticketLiabilityPrivateAverage", "ticketLiabilityPrivateAverageBasis"],
    ["duet", "ticketLiabilityDuetAverage", "ticketLiabilityDuetAverageBasis"],
  ]) {
    const average = unitPriceAverages[key] || {};
    const value = Number(average.averageUnitPrice);
    const adjustedRows = toNumber(average.adjustedPriceRows);
    const estimatedRows = toNumber(average.estimatedPriceRows);
    const correctionParts = [];
    if (adjustedRows > 0) correctionParts.push(`보정 ${formatCount(adjustedRows, "건")}`);
    if (estimatedRows > 0) correctionParts.push(`기준가 ${formatCount(estimatedRows, "건")}`);
    const correctionText = correctionParts.length ? `${correctionParts.join(" · ")} · ` : "";
    setText(id, Number.isFinite(value) && value > 0 ? formatWon(value) : "산정 대기");
    setText(
      basisId,
      Number.isFinite(value) && value > 0
        ? `${correctionText}0원 제외 · ${formatCount(average.pricedTicketRows, "건")} / ${formatCount(average.purchasedSessionCount, "회")}`
        : "0원 제외 · 집계 없음",
    );
  }
  setText(
    "ticketLiabilityMeta",
    `${formatMonth(selected.month)} · ${formatDate(report.asOfDate)} 기준 · ${report.source?.sourceFileName || "StudioMate 회원목록"}`,
  );
  const status = qs("ticketLiabilityStatus");
  if (status) {
    status.textContent = report.id === "current" ? "최신" : "월말 확정";
    status.className = "pill good";
  }

  table.innerHTML = rows.length
    ? rows
        .map((row) => {
          const remaining = row.kind === "기간권"
            ? `${formatCount(row.remainingDays, "일")} / ${formatCount(toNumber(row.remainingCount).toFixed(1), "회 환산")}`
            : formatCount(row.remainingCount, "회");
          const share = Number.isFinite(Number(row.residualValueShare))
            ? Number(row.residualValueShare)
            : (toNumber(totals.estimatedResidualValue) > 0 ? toNumber(row.estimatedResidualValue) / toNumber(totals.estimatedResidualValue) : 0);
          return `
            <tr>
              <td><strong>${escapeHtml(row.name || "수강권")}</strong><span>${escapeHtml(row.kind || "-")} · ${escapeHtml((row.classTypes || []).join(", ") || "구분 없음")}</span></td>
              <td>${escapeHtml(formatCount(row.holderCount, "명"))}<span>${escapeHtml(formatCount(row.ticketCount, "개"))}</span></td>
              <td>${escapeHtml(remaining)}</td>
              <td>${escapeHtml(formatWon(row.unitPrice))}<span>${escapeHtml(row.representativePriceSource || "대표값")}</span></td>
              <td><strong>${escapeHtml(formatWon(row.estimatedResidualValue))}</strong></td>
              <td><strong>${escapeHtml(`${(share * 100).toFixed(1)}%`)}</strong></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6"><div class="empty-state">선택 월 수강권 집계가 없습니다.</div></td></tr>`;
}

function renderTicketLiabilityReports(items) {
  const select = qs("ticketLiabilityMonthSelect");
  if (!select) return;
  state.ticketLiabilityReports = studioItems(items || []);
  const reports = ticketLiabilityMonths(state.ticketLiabilityReports);
  if (!reports.length) return renderTicketLiabilityFallback();
  select.innerHTML = reports
    .map(({ month }) => `<option value="${escapeHtml(month)}">${escapeHtml(formatMonth(month))}</option>`)
    .join("");
  select.value = reports[0].month;
  renderTicketLiabilityMonth(reports[0].month);
}

function renderTicketLiabilityFallback(error) {
  const table = qs("ticketLiabilityTableBody");
  if (!table) return;
  const status = qs("ticketLiabilityStatus");
  if (status) {
    status.textContent = error ? "확인 필요" : "집계 대기";
    status.className = "pill warn";
  }
  setText("ticketLiabilityMeta", error?.message || "첫 월말 자동 집계 후 표시됩니다.");
  setText("ticketLiabilityGroupAverage", "산정 대기");
  setText("ticketLiabilityPrivateAverage", "산정 대기");
  setText("ticketLiabilityGroupAverageBasis", "0원 제외 · 집계 없음");
  setText("ticketLiabilityPrivateAverageBasis", "0원 제외 · 집계 없음");
  table.innerHTML = `<tr><td colspan="5"><div class="empty-state">월말 집계 데이터가 아직 없습니다.</div></td></tr>`;
}

function renderBusinessMemberInsights(items) {
  const list = qs("businessMemberInsightList");
  if (!list) return;
  setText("businessMemberSummary", items.length ? `${items.length}명` : "회원 지표 대기");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">회원 누적 매출 요약을 읽지 못했습니다.</div>`;
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

function failedAutomationItems() {
  return uniqueOperatorItems(
    state.automationItems.filter((item) => ["failed", "blocked"].includes(operatorLifecycle(item))),
    "automation",
  );
}

function pendingAlimtalkCandidates() {
  return uniqueOperatorItems(
    state.alimtalkCandidates.filter((item) => isPendingStatus(item.status) && !isNonActionableCommunicationItem(item)),
    "alimtalk-candidate",
  );
}

function communicationProblemSummary() {
  const failedCandidates = failedAlimtalkCandidates();
  const failedSends = failedAlimtalkSends();
  const flowProblems = problemRequestRows();
  const pendingCandidates = pendingAlimtalkCandidates();
  return { failedCandidates, failedSends, flowProblems, pendingCandidates };
}

function renderHomeDecisions() {
  const list = qs("homeDecisionList");
  if (!list) return;
  const failedAutomation = failedAutomationItems();
  const { failedCandidates, failedSends, flowProblems, pendingCandidates } = communicationProblemSummary();
  const renewalRows = renewalCandidateRows();
  const renewalUrgent = renewalRows.filter((row) => row.priority === "urgent").length;
  const sendFailures = failedCandidates.length + failedSends.length;
  const rows = [];

  if (renewalRows.length) {
    rows.push({
      title: "재등록 관리",
      detail: renewalUrgent
        ? `오늘 확인 ${renewalUrgent}명, 전체 후보 ${renewalRows.length}명입니다. 현장 상담과 복귀 연락을 먼저 처리하세요.`
        : `30일 내 만료/잔여 부족/재등록 대기 ${renewalRows.length}명을 관리합니다.`,
      status: renewalUrgent ? "critical" : "warning",
      href: "#renewalPipeline",
    });
  }
  if (flowProblems.length) {
    rows.push({
      title: "회원 응대 후속 처리",
      detail: `현장 웰컴/회원가입서/수강료 흐름에서 ${flowProblems.length}건을 확인해야 합니다.`,
      status: "failed",
      href: "./messages/",
    });
  }
  if (sendFailures) {
    rows.push({
      title: "알림톡 실패",
      detail: `후보 실패 ${failedCandidates.length}건, 발송 실패 ${failedSends.length}건입니다. 실패 원인을 먼저 확인하세요.`,
      status: "failed",
      href: "./messages/",
    });
  }
  if (pendingCandidates.length) {
    rows.push({
      title: "알림톡 승인/대기",
      detail: `${pendingCandidates.length}건이 대기/검토/처리중입니다. 실제 발송 전 중복과 템플릿을 확인하세요.`,
      status: "warning",
      href: "./messages/",
    });
  }
  if (failedAutomation.length) {
    rows.push({
      title: "자동화 실패/중단",
      detail: `${failedAutomation.length}개 자동화 상태가 실패/중단입니다. 실패한 작업만 확인하면 됩니다.`,
      status: "failed",
      href: "./automation/",
    });
  }
  if (!rows.length) {
    list.innerHTML = `
      <div class="status-row">
        <div>
          <strong>오늘 처리할 일이 없습니다.</strong>
          <p>새 업무가 생기면 여기에 표시됩니다.</p>
        </div>
        ${pill("success")}
      </div>
    `;
    return;
  }

  list.innerHTML = rows
    .map(
      (row) => `
        <a class="status-row status-link home-action-card" href="${row.href}">
          <div><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.detail)}</p></div>
          ${pill(row.status)}
        </a>
      `,
    )
    .join("");
}

function renderHomeSummary() {
  if (!qs("commandQueueStatus")) return;
  const failedAutomation = failedAutomationItems();
  const renewalRows = renewalCandidateRows();
  const renewalUrgent = renewalRows.filter((row) => row.priority === "urgent").length;
  const renewalSoon = renewalRows.filter((row) => row.priority === "warning" || row.priority === "follow").length;
  const renewalWaiting = renewalRows.filter((row) => row.priority === "waiting").length;
  const { failedCandidates, failedSends, flowProblems, pendingCandidates } = communicationProblemSummary();
  const communicationProblems = failedCandidates.length + failedSends.length + flowProblems.length;
  const actionTotal = communicationProblems + pendingCandidates.length + failedAutomation.length + renewalUrgent;
  setText("commandQueueStatus", actionTotal ? `${actionTotal}건 확인 필요` : "오늘 처리할 큐 없음");
  setText(
    "commandQueueNote",
    actionTotal
      ? "회원 응대, 알림톡, 자동화 중 확인할 항목입니다."
      : "오늘 확인할 문제가 없습니다.",
  );
  renderRenewalPipeline(renewalRows, { urgent: renewalUrgent, soon: renewalSoon, waiting: renewalWaiting });
}

function renderRenewalPipeline(rows = renewalCandidateRows(), counts = null) {
  const list = qs("renewalPipelineList");
  if (!list) return;
  const computedCounts =
    counts || {
      urgent: rows.filter((row) => row.priority === "urgent").length,
      soon: rows.filter((row) => row.priority === "warning" || row.priority === "follow").length,
      waiting: rows.filter((row) => row.priority === "waiting").length,
    };
  setText("renewalUrgentCount", formatCount(computedCounts.urgent, "명"));
  setText("renewalSoonCount", formatCount(computedCounts.soon, "명"));
  setText("renewalWaitingCount", formatCount(computedCounts.waiting, "명"));
  setText("renewalPipelineCount", formatCount(rows.length, "명"));
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">현재 30일 내 만료, 잔여 부족, 재등록 대기 후보가 없습니다.</div>`;
    return;
  }
  list.innerHTML = rows
    .map((row) => {
      const phone = row.phone ? formatPhoneNumber(row.phone) : "전화번호 없음";
      const visit = row.member.recentVisitAt ? `최근 방문 ${compactDateTime(row.member.recentVisitAt)}` : "최근 방문 없음";
      const pace = row.weeklyUsagePace ? `주 ${row.weeklyUsagePace}회` : "이용속도 확인 전";
      const depletion = row.predictedDepletionDate ? `예상 소진 ${row.predictedDepletionDate}` : "예상 소진일 없음";
      const nextBooking = row.nextBookingDate ? `다음 예약 ${row.nextBookingDate}` : visit;
      const detail = `${row.reason} · ${row.ticketName} · ${pace} · ${depletion} · ${nextBooking} · ${row.action}`;
      const actions = row.renewalCaseId
        ? `<div class="renewal-actions" aria-label="${escapeHtml(row.name)} 재등록 상태 변경">
            <button type="button" data-renewal-action="contacted" data-renewal-case-id="${escapeHtml(row.renewalCaseId)}">연락완료</button>
            <button type="button" data-renewal-action="considering" data-renewal-case-id="${escapeHtml(row.renewalCaseId)}">고민중</button>
            <button type="button" data-renewal-action="snoozed" data-renewal-case-id="${escapeHtml(row.renewalCaseId)}">7일 후</button>
            <button type="button" data-renewal-action="resolved" data-renewal-case-id="${escapeHtml(row.renewalCaseId)}">재등록완료</button>
            <button type="button" data-renewal-action="excluded" data-renewal-case-id="${escapeHtml(row.renewalCaseId)}">재등록 의사 없음</button>
          </div>`
        : "";
      return `
        <article class="status-row renewal-row ${row.priority}">
          <div>
            <strong><a class="renewal-member-link" href="${escapeHtml(row.href)}">${escapeHtml(row.name)}</a><small>${escapeHtml(phone)}</small></strong>
            <p>${escapeHtml(detail)}</p>
            ${actions}
          </div>
          ${pill(row.workflowStatus ? renewalWorkflowStatusLabel(row.workflowStatus) : renewalStatusValue(row.priority))}
        </article>
      `;
    })
    .join("");
}

function renewalWorkflowStatusLabel(status) {
  return (
    {
      open: "확인",
      contacted: "연락완료",
      considering: "고민중",
      snoozed: "재확인예약",
      resolved: "재등록완료",
      excluded: "재등록 의사 없음",
    }[status] || "확인"
  );
}

async function handleRenewalActionClick(event) {
  const button = event.target.closest("[data-renewal-action]");
  if (!button) return;
  const caseId = String(button.dataset.renewalCaseId || "");
  const workflowStatus = String(button.dataset.renewalAction || "");
  if (!caseId || !["contacted", "considering", "snoozed", "resolved", "excluded"].includes(workflowStatus)) return;
  if (workflowStatus === "excluded" && !window.confirm("재등록 의사 없음으로 처리할까요? 현재 재등록 목록에서 숨겨집니다.")) return;
  button.disabled = true;
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) throw new Error("운영자 로그인이 필요합니다.");
    const now = new Date();
    const update = {
      workflowStatus,
      operatorUpdatedAt: runtime.serverTimestamp(),
      operatorUpdatedByUid: user.uid,
      updatedAt: runtime.serverTimestamp(),
    };
    if (workflowStatus === "snoozed") {
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      update.nextActionAt = runtime.Timestamp.fromDate(next);
    } else {
      update.nextActionAt = null;
    }
    await runtime.updateDoc(runtime.doc(runtime.db, "renewalCases", caseId), update);
    await refresh();
  } catch (error) {
    window.alert(error?.message || "재등록 상태를 저장하지 못했습니다.");
  } finally {
    button.disabled = false;
  }
}

function renderBusinessFallback(error) {
  if (!qs("businessMonthSelect")) return;
  qs("businessSnapshotStatus").textContent = error ? "권한 확인" : "대기";
  qs("businessSnapshotStatus").className = "pill warn";
  setText("businessHeroValue", "데이터 연결 대기");
  setText("businessHeroNote", error?.message || "데이터 권한 또는 월별 요약 확인이 필요합니다.");
  renderBusinessMemberInsights([]);
}

function staffHrCardFor(staffId) {
  return (state.staffHrCards || []).find((card) => String(card.staffId || card.id) === String(staffId)) || null;
}

function staffLatestSubmission(staffId) {
  return (
    (state.staffEvaluationSubmissions || [])
      .filter((item) => String(item.staffId || "") === String(staffId))
      .sort((a, b) => timestampMs(b.submittedAt || b.updatedAt) - timestampMs(a.submittedAt || a.updatedAt))[0] || null
  );
}

function staffEvaluationRows() {
  const rows = new Map();
  for (const staff of state.staffItems || []) {
    const key = String(staff.staffId || staff.id || staff.name || "");
    if (!key) continue;
    const applicantEvaluation = Boolean(staff.applicantEvaluation || staff.role === "applicant");
    const role = staff.role || "instructor";
    const isTeachingRole = ["instructor", "owner"].includes(String(role));
    const isCurrentStaff = staff.active !== false && !applicantEvaluation && isTeachingRole;
    rows.set(key, {
      key,
      staffId: staff.staffId || staff.id || "",
      name: staff.name || "이름 없음",
      role,
      submissions: [],
      card: null,
      applicantEvaluation,
      staffActive: staff.active !== false,
      isCurrentStaff,
      employmentSource: "staffs",
    });
  }

  for (const card of state.staffHrCards || []) {
    const key = String(card.staffId || card.id || card.staffName || "");
    if (!key) continue;
    const applicantEvaluation = Boolean(card.applicantEvaluation || card.staffRole === "applicant");
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        staffId: card.staffId || card.id || "",
        name: card.staffName || "강사",
        role: card.staffRole || "instructor",
        submissions: [],
        card,
        applicantEvaluation,
        staffActive: false,
        isCurrentStaff: false,
        employmentSource: "hrCard",
      });
    } else {
      const row = rows.get(key);
      row.card = card;
      row.applicantEvaluation = Boolean(row.applicantEvaluation || applicantEvaluation);
      if (applicantEvaluation) {
        row.isCurrentStaff = false;
        row.role = "applicant";
      }
    }
  }

  for (const submission of state.staffEvaluationSubmissions || []) {
    const key = String(submission.staffId || submission.staffName || submission.id || "");
    if (!key) continue;
    const applicantEvaluation = Boolean(submission.applicantEvaluation || submission.staffRole === "applicant");
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        staffId: submission.staffId || "",
        name: submission.staffName || "강사",
        role: submission.staffRole || "instructor",
        submissions: [],
        card: null,
        applicantEvaluation,
        staffActive: false,
        isCurrentStaff: false,
        employmentSource: "submission",
      });
    }
    rows.get(key).submissions.push(submission);
    if (applicantEvaluation) {
      const row = rows.get(key);
      row.applicantEvaluation = true;
      row.isCurrentStaff = false;
      row.role = "applicant";
    }
  }

  return [...rows.values()].map((row) => {
    const cardLatest =
      row.card?.latestQuiz && Number.isFinite(Number(row.card.latestQuiz.scorePercent))
        ? {
            ...row.card.latestQuiz,
            staffId: row.staffId,
            staffName: row.name,
            staffRole: row.role,
          }
        : null;
    const candidates = cardLatest ? [...row.submissions, cardLatest] : row.submissions;
    const seen = new Set();
    const submissions = candidates
      .filter((item) => Number.isFinite(Number(item.scorePercent)))
      .filter((item) => {
        const key = String(item.submissionId || `${item.staffId || row.staffId}_${item.submittedAt || item.updatedAt || item.scorePercent}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => timestampMs(b.submittedAt || b.updatedAt) - timestampMs(a.submittedAt || a.updatedAt));
    const scores = submissions.map((item) => toNumber(item.scorePercent));
    const bestFromCard = Number(row.card?.quizSummary?.bestScorePercent);
    const latest = submissions[0] || null;
    return {
      ...row,
      submissions,
      latest,
      latestScore: latest ? Math.round(toNumber(latest.scorePercent)) : null,
      bestScore: scores.length || Number.isFinite(bestFromCard) ? Math.round(Math.max(...scores, Number.isFinite(bestFromCard) ? bestFromCard : 0)) : null,
      attempts: Math.max(submissions.length, toNumber(row.card?.quizSummary?.attempts)),
      status: latest?.status || "pending",
      employmentState: staffEmploymentState(row),
    };
  });
}

function staffEmploymentState(row) {
  if (row.applicantEvaluation || row.role === "applicant") return "applicant";
  if (row.isCurrentStaff) return "current";
  if (["manager", "viewer"].includes(String(row.role || ""))) return "operator";
  return "inactive";
}

function staffEmploymentLabel(row) {
  const state = row.employmentState || staffEmploymentState(row);
  if (state === "current") return "현재 근무중";
  if (state === "operator") return "운영자 계정";
  if (state === "applicant") return "지원자/시험 기록";
  return "비근무/퇴사 기록";
}

function staffEmploymentPill(row) {
  const state = row.employmentState || staffEmploymentState(row);
  const tone = state === "current" ? "good" : state === "applicant" ? "warn" : "muted";
  return `<span class="pill ${tone}">${escapeHtml(staffEmploymentLabel(row))}</span>`;
}

function normalizeStaffMatchName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

function sameStaffName(left, right) {
  const a = normalizeStaffMatchName(left);
  const b = normalizeStaffMatchName(right);
  return Boolean(a && b && a === b);
}

function staffMonthlyMetrics(row) {
  const snapshot = state.businessSnapshot || {};
  const stats = (snapshot.instructorStats || []).filter((item) => sameStaffName(item.name, row.name));
  const sales = (snapshot.instructorRevenue || []).filter((item) => sameStaffName(item.name, row.name));
  const byMonth = new Map();
  for (const item of stats) {
    byMonth.set(item.month, {
      month: item.month,
      reservationRate: item.reservationRate,
      attendanceRate: item.attendanceRate,
      averageGroupMembers: item.averageGroupMembers,
      groupLessonCount: item.groupLessonCount,
    });
  }
  for (const item of sales) {
    const current = byMonth.get(item.month) || { month: item.month };
    byMonth.set(item.month, {
      ...current,
      revenue: item.revenue,
      pretaxAmount: item.pretaxAmount,
      payoutAmount: item.payoutAmount,
    });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function metricMonthAge(value, referenceDate = new Date()) {
  const month = normMonth(value);
  if (!month) return Number.POSITIVE_INFINITY;
  const [year, monthNumber] = month.split("-").map(Number);
  return (referenceDate.getFullYear() - year) * 12 + (referenceDate.getMonth() + 1 - monthNumber);
}

function currentStaffMetric(metrics = []) {
  const latest = metrics.at(-1) || null;
  return latest && metricMonthAge(latest.month) <= 2 ? latest : null;
}

function validMetricRate(value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = toNumber(value);
  return numeric >= 0 && numeric <= 100 ? numeric : null;
}

function formatMetricRate(value) {
  const numeric = validMetricRate(value);
  return numeric === null ? (Number.isFinite(Number(value)) ? "원본 확인" : "연결 대기") : `${numeric.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatMetricNumber(value, suffix = "") {
  return Number.isFinite(Number(value)) ? `${toNumber(value).toLocaleString("ko-KR")}${suffix}` : "연결 대기";
}

function scoreBand(score) {
  if (!Number.isFinite(Number(score))) return { label: "산출 대기", tone: "muted" };
  if (score >= 85) return { label: "우수", tone: "good" };
  if (score >= 75) return { label: "안정", tone: "good" };
  if (score >= 65) return { label: "관찰", tone: "warn" };
  return { label: "개선필요", tone: "danger" };
}

function normalizeGroupAverageScore(value) {
  if (!Number.isFinite(Number(value))) return null;
  const targetAverage = 4.5;
  return Math.max(0, Math.min(100, Math.round((toNumber(value) / targetAverage) * 100)));
}

function staffCompositeScore(row, metrics, latestQuiz) {
  const latestMetric = currentStaffMetric(metrics);
  const definitions = [
    {
      key: "quiz",
      label: "평가 퀴즈",
      weight: 35,
      value: latestQuiz ? Math.max(0, Math.min(100, toNumber(latestQuiz.scorePercent))) : null,
      display: latestQuiz ? `${Math.round(toNumber(latestQuiz.scorePercent))}점` : "미응시",
    },
    {
      key: "reservation",
      label: "그룹 예약률",
      weight: 30,
      value: latestMetric ? validMetricRate(latestMetric.reservationRate) : null,
      display: latestMetric ? formatMetricRate(latestMetric.reservationRate) : "연결 대기",
    },
    {
      key: "averageMembers",
      label: "그룹 평균인원",
      weight: 25,
      value: latestMetric ? normalizeGroupAverageScore(latestMetric.averageGroupMembers) : null,
      display: latestMetric ? formatMetricNumber(latestMetric.averageGroupMembers, "명") : "연결 대기",
    },
    {
      key: "attendance",
      label: "그룹 출석률",
      weight: 10,
      value: latestMetric ? validMetricRate(latestMetric.attendanceRate) : null,
      display: latestMetric ? formatMetricRate(latestMetric.attendanceRate) : "연결 대기",
    },
  ];
  const active = definitions.filter((item) => Number.isFinite(Number(item.value)));
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
  const score = latestQuiz && latestMetric && active.length >= 3 && totalWeight >= 65
    ? Math.round(active.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight)
    : null;
  return {
    score,
    band: scoreBand(score),
    components: definitions,
    activeCount: active.length,
    totalCount: definitions.length,
    coverage: totalWeight,
    note:
      row.employmentState === "current"
        ? "현재 연결된 항목만 100점으로 환산합니다."
        : "비근무/지원자/운영자 기록은 참고 점수로만 표시합니다.",
  };
}

function renderStaffDetail(row) {
  const container = qs("staffDetailCard");
  if (!container) return;
  if (!row) {
    setText("staffDetailTitle", "강사 세부 지표");
    setText("staffDetailSubtitle", "강사 이름을 선택하면 퀴즈 답변과 월별 운영 지표가 표시됩니다.");
    container.innerHTML = `<div class="empty-state">강사 리스트에서 이름을 선택해 주세요.</div>`;
    return;
  }

  const metrics = staffMonthlyMetrics(row);
  const historicalLatestMetric = metrics.at(-1) || null;
  const latestMetric = currentStaffMetric(metrics);
  const latestQuiz = row.latest || row.card?.latestQuiz || null;
  const q19 = latestQuiz ? staffEssayScoreInfo(latestQuiz) : null;
  const recentSubmissions = row.submissions.slice(0, 5);
  const lastUpdated = latestMetric?.month
    ? `${formatMonth(latestMetric.month)} 운영 지표`
    : historicalLatestMetric?.month
      ? `${formatMonth(historicalLatestMetric.month)} 이후 지표 지연`
      : "운영 지표 연결 대기";
  const composite = staffCompositeScore(row, metrics, latestQuiz);

  setText("staffDetailTitle", `${row.name || "강사"} 세부 지표`);
  setText(
    "staffDetailSubtitle",
    [
      staffEmploymentLabel(row),
      row.role || "instructor",
      latestQuiz ? `최근 평가 ${Math.round(toNumber(latestQuiz.scorePercent))}점` : "평가 기록 없음",
      lastUpdated,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const metricCards = [
    {
      label: "최근 평가 점수",
      value: latestQuiz ? `${Math.round(toNumber(latestQuiz.scorePercent))}점` : "미응시",
      note: latestQuiz?.submittedAt ? formatDate(latestQuiz.submittedAt) : "퀴즈 제출 대기",
    },
    {
      label: "월별 그룹 예약률",
      value: latestMetric ? formatMetricRate(latestMetric.reservationRate) : "연결 대기",
      note: latestMetric?.month ? formatMonth(latestMetric.month) : "월별 강사 지표",
    },
    {
      label: "월별 그룹 평균인원",
      value: latestMetric ? formatMetricNumber(latestMetric.averageGroupMembers, "명") : "연결 대기",
      note: latestMetric?.month ? "강사통계 기준" : "강사통계 연결 대기",
    },
    {
      label: "월 수업 개수",
      value: latestMetric?.groupLessonCount === null || latestMetric?.groupLessonCount === undefined ? "연결 대기" : formatMetricNumber(latestMetric.groupLessonCount, "개"),
      note: latestMetric?.groupLessonCount === null || latestMetric?.groupLessonCount === undefined ? "수업수 연결 필요" : "강사통계 기준",
    },
  ];

  const metricRows = metrics.slice(-6).reverse();
  container.innerHTML = `
    <div class="staff-composite-card">
      <div class="staff-composite-head">
        <div>
          <span>강사 평가 종합 점수</span>
          <strong>${composite.score === null ? "산출 대기" : `${composite.score}점`}</strong>
          <em>v1 산식 · 연결 항목 ${composite.activeCount}/${composite.totalCount} · 가중치 ${composite.coverage}%</em>
        </div>
        <span class="pill ${escapeHtml(composite.band.tone)}">${escapeHtml(composite.band.label)}</span>
      </div>
      <p>${escapeHtml(composite.note)}</p>
      <div class="staff-score-rules">
        ${composite.components
          .map(
            (item) => `
              <div>
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(`${item.weight}%`)}</strong>
                <em>${escapeHtml(item.display)}</em>
              </div>
            `,
          )
          .join("")}
      </div>
      <p class="meta-line">추후 월 수업수, 회원만족도, 클레임 현황이 연결되면 산식 v2에 반영합니다.</p>
    </div>

    <div class="staff-detail-kpis">
      <div class="staff-detail-kpi staff-detail-kpi-status">
        <span>근무 상태</span>
        <strong>${escapeHtml(staffEmploymentLabel(row))}</strong>
        <em>${escapeHtml(row.employmentSource === "staffs" ? "staffs active 기준" : "기록 보존 기준")}</em>
      </div>
      ${metricCards
        .map(
          (item) => `
            <div class="staff-detail-kpi">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
              <em>${escapeHtml(item.note)}</em>
            </div>
          `,
        )
        .join("")}
    </div>

    <div class="staff-detail-section">
      <h3>최근 퀴즈 답변</h3>
      ${
        latestQuiz
          ? `
            <div class="staff-detail-quiz">
              <div>
                <strong>${escapeHtml(`${Math.round(toNumber(latestQuiz.scorePercent))}점`)}</strong>
                <span>${escapeHtml(
                  [
                    latestQuiz.scoredPointTotal ? `${toNumber(latestQuiz.earnedPointTotal)}/${toNumber(latestQuiz.scoredPointTotal)}점` : "",
                    `${toNumber(latestQuiz.correctCount)}/${toNumber(latestQuiz.scoredQuestionCount)}문항`,
                    formatDate(latestQuiz.submittedAt || latestQuiz.updatedAt),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                )}</span>
              </div>
              ${pill(latestQuiz.status || "unknown")}
            </div>
            ${
              q19
                ? `<div class="essay-answer-preview staff-detail-answer"><strong>Q19 서술형</strong><br />${escapeHtml(q19.text || "답변 없음")}</div>`
                : ""
            }
          `
          : `<div class="empty-state">아직 퀴즈 제출 기록이 없습니다.</div>`
      }
    </div>

    <div class="staff-detail-section">
      <h3>월별 그룹 운영 지표</h3>
      ${
        metricRows.length
          ? `
            <div class="staff-metric-table" role="table" aria-label="${escapeHtml(row.name)} 월별 그룹 운영 지표">
              <div role="row">
                <span role="columnheader">월</span>
                <span role="columnheader">예약률</span>
                <span role="columnheader">출석률</span>
                <span role="columnheader">평균인원</span>
                <span role="columnheader">수업수</span>
              </div>
              ${metricRows
                .map(
                  (item) => `
                    <div role="row">
                      <strong role="cell">${escapeHtml(formatMonth(item.month))}</strong>
                      <span role="cell">${escapeHtml(formatMetricRate(item.reservationRate))}</span>
                      <span role="cell">${escapeHtml(formatMetricRate(item.attendanceRate))}</span>
                      <span role="cell">${escapeHtml(formatMetricNumber(item.averageGroupMembers, "명"))}</span>
                      <span role="cell">${escapeHtml(
                        item.groupLessonCount === null || item.groupLessonCount === undefined
                          ? "연결 대기"
                          : formatMetricNumber(item.groupLessonCount, "개"),
                      )}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          `
          : `<div class="empty-state">이 강사의 월별 그룹 지표가 아직 연결되지 않았습니다.</div>`
      }
    </div>

    <div class="staff-detail-section">
      <h3>평가 제출 이력</h3>
      ${
        recentSubmissions.length
          ? recentSubmissions
              .map(
                (item) => `
                  <div class="staff-detail-history">
                    <strong>${escapeHtml(`${Math.round(toNumber(item.scorePercent))}점`)}</strong>
                    <span>${escapeHtml(formatDate(item.submittedAt || item.updatedAt))}</span>
                    ${pill(item.status || "unknown")}
                  </div>
                `,
              )
              .join("")
          : `<div class="empty-state">평가 제출 이력이 없습니다.</div>`
      }
    </div>

    <div class="staff-detail-section">
      <h3>만족도 · 클레임</h3>
      <div class="staff-signal-grid">
        <div><strong>회원만족도</strong><span>설문 연결 대기</span></div>
        <div><strong>클레임 현황</strong><span>클레임 기록 연결 대기</span></div>
      </div>
    </div>
  `;
}

function renderStaffEvaluationChart() {
  const chart = qs("staffEvaluationChart");
  if (!chart) return;
  const rows = staffEvaluationRows()
    .filter((row) => row.latest && row.employmentState === "current")
    .sort((a, b) => (b.latestScore || 0) - (a.latestScore || 0) || String(a.name).localeCompare(String(b.name), "ko"));

  if (!rows.length) {
    chart.innerHTML = `<div class="empty-state">현재 근무중 강사의 평가 제출 기록이 생기면 점수 차트가 표시됩니다.</div>`;
    return;
  }

  chart.innerHTML = rows
    .map((row) => {
      const latestScore = Math.max(0, Math.min(100, row.latestScore || 0));
      const bestScore = Math.max(0, Math.min(100, row.bestScore || 0));
      const points =
        row.latest?.scoredPointTotal && row.latest?.earnedPointTotal !== undefined
          ? `${toNumber(row.latest.earnedPointTotal)}/${toNumber(row.latest.scoredPointTotal)}점 자동채점`
          : `${row.latest?.correctCount || 0}/${row.latest?.scoredQuestionCount || 0}문항`;
      const note = [formatDate(row.latest.submittedAt || row.latest.updatedAt), `${row.attempts}회 제출`, points]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="staff-chart-row">
          <div class="staff-chart-copy">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(note)}</span>
          </div>
          <div class="staff-chart-bars" aria-label="${escapeHtml(row.name)} 평가 점수">
            <div class="staff-chart-track">
              <span class="staff-chart-fill" style="width: ${latestScore}%"></span>
            </div>
            <div class="staff-chart-best" style="left: ${bestScore}%"></div>
          </div>
          <div class="staff-chart-score">
            <strong>${latestScore}점</strong>
            <span>최고 ${bestScore}점</span>
          </div>
          ${pill(row.status)}
        </article>
      `;
    })
    .join("");
}

function renderStaffHr() {
  const list = qs("staffHrList");
  if (!list) return;
  if (readUnavailable("staffs")) {
    ["staffTotal", "staffPassedCount", "staffReviewCount", "staffLatestScore"].forEach((id) => setText(id, "-"));
    list.innerHTML = `<div class="empty-state error-state">강사 명단 원본을 읽지 못했습니다. 0명으로 판단하지 않습니다.</div>`;
    renderStaffDetail(null);
    renderStaffSubmissionHistory();
    renderStaffEvaluationChart();
    return;
  }
  const staffRows = staffEvaluationRows().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  const staffs = staffRows;
  state.staffEvaluationRows = staffRows;
  const submissions = state.staffEvaluationSubmissions || [];
  const reviewCount = submissions.filter((item) => item.status === "review_needed").length;
  const passedCount = submissions.filter((item) => item.status === "passed").length;
  const activeStaffCount = staffs.filter((item) => item.employmentState === "current").length;
  const latest = submissions
    .filter((item) => Number.isFinite(Number(item.scorePercent)))
    .sort((a, b) => timestampMs(b.submittedAt || b.updatedAt) - timestampMs(a.submittedAt || a.updatedAt))[0];

  setText("staffTotal", formatCount(activeStaffCount, "명"));
  setText("staffPassedCount", formatCount(passedCount, "건"));
  setText("staffReviewCount", formatCount(reviewCount, "건"));
  setText("staffLatestScore", latest ? `${Math.round(toNumber(latest.scorePercent))}점` : "-");

  if (!staffs.length) {
    list.innerHTML = `<div class="empty-state">강사 데이터를 불러오면 인사기록카드가 표시됩니다.</div>`;
    renderStaffDetail(null);
    renderStaffSubmissionHistory();
    renderStaffEvaluationChart();
    return;
  }

  const currentStaffs = staffs.filter((staff) => staff.employmentState === "current");
  const inactiveStaffs = staffs.filter((staff) => staff.employmentState !== "current");
  const defaultStaff = currentStaffs[0] || staffs[0];
  if (!selectedStaffKey || !staffs.some((staff) => staff.key === selectedStaffKey)) selectedStaffKey = defaultStaff.key;

  const renderStaffRows = (groupRows) =>
    groupRows
      .map((staff) => {
        const card = staff.card || staffHrCardFor(staff.staffId);
        const latestQuiz = card?.latestQuiz || staff.latest || staffLatestSubmission(staff.staffId) || null;
        const score = latestQuiz ? `${Math.round(toNumber(latestQuiz.scorePercent))}점` : "미응시";
        const bestScore = Number(card?.quizSummary?.bestScorePercent);
        const status = latestQuiz?.status || "pending";
        const roleLabel = staff.applicantEvaluation || staff.role === "applicant" ? "지원자" : staff.role || "instructor";
        const meta = [
          staffEmploymentLabel(staff),
          roleLabel,
          staff.phoneLast4 ? `끝자리 ${staff.phoneLast4}` : "",
          latestQuiz?.submittedAt ? `최근 ${formatDate(latestQuiz.submittedAt)}` : "퀴즈 기록 없음",
        ]
          .filter(Boolean)
          .join(" · ");
        const active = staff.key === selectedStaffKey ? " is-active" : "";
        return `
        <article class="status-row staff-card-row${active}">
          <button class="staff-card-button" type="button" data-staff-detail-key="${escapeHtml(staff.key)}" aria-label="${escapeHtml(staff.name || "강사")} 세부 지표 보기">
            <strong>${escapeHtml(staff.name || "이름 없음")}</strong>
            <p class="meta-line">${escapeHtml(meta)}</p>
            <p class="note-line">최근 평가: ${escapeHtml(score)} · 최고 ${Number.isFinite(bestScore) && bestScore > 0 ? Math.round(bestScore) : "-"}점</p>
          </button>
          <div class="staff-card-badges">
            ${staffEmploymentPill(staff)}
            ${pill(status)}
          </div>
        </article>
      `;
      })
      .join("");

  const renderStaffGroup = (title, description, groupRows, tone = "", open = false) => `
    <details class="staff-card-group ${tone}" ${open ? "open" : ""}>
      <summary class="staff-card-group-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)} · ${groupRows.length}명</span>
      </summary>
      <div class="staff-card-group-body">
        ${groupRows.length ? renderStaffRows(groupRows) : `<div class="empty-state">해당 기록이 없습니다.</div>`}
      </div>
    </details>
  `;

  const inactiveContainsSelected = inactiveStaffs.some((staff) => staff.key === selectedStaffKey);
  list.innerHTML = [
    renderStaffGroup("현재 근무중", "staffs active 기준으로 현재 운영 중인 강사입니다.", currentStaffs, "is-current", true),
    renderStaffGroup(
      "비근무 · 지원자 · 운영자 기록",
      "입사시험 제출자, 퇴사/비활성 강사, 운영자 계정, 기록만 남은 대상을 분리 보관합니다.",
      inactiveStaffs,
      "is-archived",
      inactiveContainsSelected,
    ),
  ].join("");
  renderStaffDetail(staffs.find((staff) => staff.key === selectedStaffKey) || staffs[0]);
  renderStaffSubmissionHistory();
  renderStaffEvaluationChart();
}

function staffEssayScoreInfo(item) {
  const answer = (item.answers || []).find((entry) => entry?.questionId === "q19_imprint_description");
  if (!answer) return null;
  const points = toNumber(answer.points || 10);
  const earnedPoints = Number.isFinite(Number(answer.earnedPoints)) ? toNumber(answer.earnedPoints) : 0;
  const manual = answer.manualOverride || item.manualScoreOverrides?.q19_imprint_description || null;
  const text = item.openResponses?.q19_imprint_description || answer.answerText || "";
  const feedback = answer.rubricScore?.feedback || "";
  return {
    questionId: "q19_imprint_description",
    points,
    earnedPoints,
    text,
    feedback,
    manual,
  };
}

function renderStaffSubmissionHistory() {
  const list = qs("staffEvaluationSubmissionList");
  if (!list) return;
  const items = [...(state.staffEvaluationSubmissions || [])]
    .sort((a, b) => timestampMs(b.submittedAt || b.updatedAt) - timestampMs(a.submittedAt || a.updatedAt))
    .slice(0, 20);
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">최근 강사 평가 퀴즈 제출 이력이 없습니다.</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const essay = staffEssayScoreInfo(item);
      const detail = [
        `${Math.round(toNumber(item.scorePercent))}점`,
        item.scoredPointTotal ? `${toNumber(item.earnedPointTotal)}/${toNumber(item.scoredPointTotal)}점 채점` : "",
        `${toNumber(item.correctCount)}/${toNumber(item.scoredQuestionCount)}문항`,
        formatDate(item.submittedAt || item.updatedAt),
        item.submittedByName ? `제출 ${item.submittedByName}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(item.staffName || "강사")}</strong>
            <p class="meta-line">${escapeHtml(detail)}</p>
            ${
              item.incorrectQuestionIds?.length
                ? `<p class="note-line">확인 문항: ${escapeHtml(item.incorrectQuestionIds.join(", "))}</p>`
                : `<p class="meta-line">확인 필요한 오답 없음</p>`
            }
            ${
              essay
                ? `
                  <form class="staff-score-adjust" data-staff-essay-score-form data-submission-id="${escapeHtml(item.submissionId || item.id || "")}" data-question-id="${escapeHtml(essay.questionId)}">
                    <div class="staff-score-adjust-copy">
                      <span>서술형 Q19</span>
                      <strong>${escapeHtml(`${essay.earnedPoints}/${essay.points}점`)}</strong>
                      ${essay.manual ? `<em>관리자 수정됨 · ${escapeHtml(essay.manual.adjustedByName || "")}</em>` : `<em>1차 자동채점</em>`}
                    </div>
                    ${essay.feedback ? `<p class="note-line">${escapeHtml(essay.feedback)}</p>` : ""}
                    ${essay.text ? `<p class="essay-answer-preview">${escapeHtml(essay.text)}</p>` : `<p class="meta-line">서술형 답변 없음</p>`}
                    <label>
                      <span>수정 점수</span>
                      <input type="number" name="earnedPoints" min="0" max="${escapeHtml(essay.points)}" step="0.5" value="${escapeHtml(essay.earnedPoints)}" />
                    </label>
                    <label>
                      <span>수정 메모</span>
                      <input type="text" name="note" maxlength="120" placeholder="예: 핵심 정의 보완 인정" />
                    </label>
                    <button class="secondary-action" type="submit">서술형 점수 저장</button>
                    <p class="form-status" data-staff-essay-score-status></p>
                  </form>
                `
                : ""
            }
          </div>
          ${pill(item.status || "unknown")}
        </div>
      `;
    })
    .join("");
}

async function handleStaffEssayScoreAdjustSubmit(event, form) {
  event.preventDefault();
  const button = form.querySelector("button[type='submit']");
  const status = form.querySelector("[data-staff-essay-score-status]");
  const submissionId = form.dataset.submissionId || "";
  const questionId = form.dataset.questionId || "q19_imprint_description";
  const earnedPoints = Number(form.elements.earnedPoints?.value || "");
  const note = String(form.elements.note?.value || "").trim();
  if (!submissionId || !Number.isFinite(earnedPoints)) {
    if (status) status.textContent = "제출 기록과 점수를 확인해 주세요.";
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "저장 중";
  }
  if (status) status.textContent = "서술형 점수를 저장하고 인사기록카드를 갱신합니다.";
  try {
    const runtime = await initFirebase();
    const adjustScore = runtime.httpsCallable(runtime.functionsClient, "adjustInstructorEvaluationEssayScore");
    const result = await adjustScore({ submissionId, questionId, earnedPoints, note });
    const data = result?.data || {};
    if (status) {
      status.textContent = `저장 완료 · 총점 ${Math.round(toNumber(data.scorePercent))}점 · ${statusLabel(data.status)}`;
      status.className = "form-status good";
    }
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("서술형 점수 수정은 운영자 권한이 필요합니다.");
    if (status) {
      status.textContent = error?.message || "서술형 점수를 저장하지 못했습니다.";
      status.className = "form-status danger";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "서술형 점수 저장";
    }
  }
}

function setEvaluationQuizStatus(message, tone = "") {
  const element = qs("evaluationQuizStatus");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function cssNameSelector(value) {
  const text = String(value || "");
  if (window.CSS?.escape) return CSS.escape(text);
  return text.replace(/["\\]/g, "\\$&");
}

async function loadInstructorEvaluationQuiz() {
  const form = qs("instructorEvaluationQuizForm");
  if (!form) return;
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("강사 평가 퀴즈는 로그인 후 작성할 수 있습니다.");
      return;
    }
    const getQuiz = runtime.httpsCallable(runtime.functionsClient, "getInstructorEvaluationQuiz");
    const result = await getQuiz({});
    const data = result?.data || {};
    state.instructorEvaluationQuiz = data.quiz || null;
    state.instructorEvaluationTargets = data.targetStaffs || [];
    renderInstructorEvaluationQuiz();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("강사 평가 퀴즈는 사용 가능한 강사 계정이 필요합니다.");
    setEvaluationQuizStatus(error?.message || "퀴즈를 불러오지 못했습니다.", "danger");
  }
}

function renderInstructorEvaluationQuiz() {
  const quiz = state.instructorEvaluationQuiz;
  const questionList = qs("evaluationQuizQuestions");
  const targetSelect = qs("evaluationTargetStaff");
  if (!quiz || !questionList) return;
  setText("evaluationQuizTitle", quiz.title || "강사 평가 퀴즈");
  setText("evaluationQuizDescription", quiz.description || "ARCHIVE PILATES 운영 기준을 확인합니다.");
  if (targetSelect) {
    targetSelect.innerHTML = (state.instructorEvaluationTargets || [])
      .map((staff) => `<option value="${escapeHtml(staff.staffId)}">${escapeHtml(staff.name)} · ${escapeHtml(staff.role || "instructor")}</option>`)
      .join("");
  }
  questionList.innerHTML = (quiz.questions || [])
    .map((question, index) => {
      const label = `${index + 1}. ${escapeHtml(question.title)}`;
      if (question.type === "short_text") {
        return `
          <fieldset class="quiz-question">
            <legend>${label}</legend>
            ${question.description ? `<p>${escapeHtml(question.description)}</p>` : ""}
            <textarea name="${escapeHtml(question.questionId)}" rows="4" placeholder="짧게 작성해 주세요."></textarea>
          </fieldset>
        `;
      }
      if (question.type === "fill_blank") {
        return `
          <fieldset class="quiz-question">
            <legend>${label}</legend>
            ${question.description ? `<p>${escapeHtml(question.description)}</p>` : ""}
            <input type="text" name="${escapeHtml(question.questionId)}" placeholder="정답을 입력해 주세요." ${question.required ? "required" : ""} />
          </fieldset>
        `;
      }
      return `
        <fieldset class="quiz-question">
          <legend>${label}</legend>
          ${question.description ? `<p>${escapeHtml(question.description)}</p>` : ""}
          <div class="quiz-options">
            ${(question.options || [])
              .map(
                (option) => `
                  <label>
                    <input type="radio" name="${escapeHtml(question.questionId)}" value="${escapeHtml(option.optionId)}" ${question.required ? "required" : ""} />
                    <span>${escapeHtml(option.label)}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </fieldset>
      `;
    })
    .join("");
  setEvaluationQuizStatus(`합격 기준 ${toNumber(quiz.passScore)}점입니다. 제출 결과는 강사별 인사기록카드에 저장됩니다.`);
}

async function handleInstructorEvaluationQuizSubmit(event) {
  event.preventDefault();
  const quiz = state.instructorEvaluationQuiz;
  const button = qs("evaluationQuizSubmit");
  if (!quiz) {
    setEvaluationQuizStatus("퀴즈를 먼저 불러와 주세요.", "danger");
    return;
  }
  const form = qs("instructorEvaluationQuizForm");
  const answers = {};
  for (const question of quiz.questions || []) {
    if (question.type === "short_text" || question.type === "fill_blank") {
      answers[question.questionId] = String(form?.elements?.[question.questionId]?.value || "").trim();
    } else {
      const checked = document.querySelector(`input[name="${cssNameSelector(question.questionId)}"]:checked`);
      answers[question.questionId] = checked?.value || "";
    }
  }
  if (button) {
    button.disabled = true;
    button.textContent = "제출 중";
  }
  setEvaluationQuizStatus("정답 채점과 인사기록카드 반영을 진행합니다.", "warn");
  try {
    const runtime = await initFirebase();
    const submitQuiz = runtime.httpsCallable(runtime.functionsClient, "submitInstructorEvaluationQuiz");
    const result = await submitQuiz({
      staffId: qs("evaluationTargetStaff")?.value || "",
      answers,
    });
    const data = result?.data || {};
    const passed = Boolean(data.passed);
    setEvaluationQuizStatus(
      `${data.staffName || "강사"} 평가 퀴즈 저장 완료 · ${Math.round(toNumber(data.scorePercent))}점 · ${passed ? "합격" : "검토 필요"}`,
      passed ? "good" : "warn",
    );
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("강사 평가 퀴즈 제출 권한을 확인해 주세요.");
    setEvaluationQuizStatus(error?.message || "퀴즈 제출에 실패했습니다.", "danger");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "평가 퀴즈 제출";
    }
  }
}

const INSTAGRAM_CONTENT_TYPE_LABELS = {
  image: "이미지",
  carousel: "캐러셀",
  reel: "릴스",
};

const INSTAGRAM_PILLAR_LABELS = {
  brand_method: "브랜드·메소드",
  local_operations: "명지점·현장",
  promotion: "프로모션·전환",
  people_community: "사람·커뮤니티",
};

function instagramItemTime(item) {
  return item.publishedAt || item.publishAt || item.updatedAt || item.createdAt;
}

function instagramContentTypeLabel(value) {
  return INSTAGRAM_CONTENT_TYPE_LABELS[String(value || "")] || "게시물";
}

function instagramPillarLabel(value) {
  return INSTAGRAM_PILLAR_LABELS[String(value || "")] || "콘텐츠";
}

function instagramHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function instagramMediaRowsFromForm() {
  const contentType = String(qs("instagramContentType")?.value || "image");
  const altText = String(qs("instagramAltText")?.value || "").trim();
  return String(qs("instagramMediaInput")?.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const explicitVideo = /^(video|영상)\s*[:|]\s*/i.test(line);
      const explicitImage = /^(image|이미지)\s*[:|]\s*/i.test(line);
      const url = line.replace(/^(video|영상|image|이미지)\s*[:|]\s*/i, "").trim();
      const path = url.split(/[?#]/)[0].toLowerCase();
      const inferredVideo = /\.(mp4|mov|m4v|webm)$/.test(path);
      return {
        type: contentType === "reel" || explicitVideo || (!explicitImage && inferredVideo) ? "video" : "image",
        url,
        altText: index === 0 ? altText : "",
      };
    });
}

function instagramDraftPayload(intent = "draft") {
  return {
    contentId: String(qs("instagramContentId")?.value || "").trim(),
    contentType: String(qs("instagramContentType")?.value || "image"),
    pillar: String(qs("instagramPillar")?.value || "brand_method"),
    publishAt: String(qs("instagramPublishAt")?.value || ""),
    location: String(qs("instagramLocation")?.value || "").trim(),
    media: instagramMediaRowsFromForm(),
    altText: String(qs("instagramAltText")?.value || "").trim(),
    caption: String(qs("instagramCaption")?.value || "").trim(),
    cta: String(qs("instagramCta")?.value || "").trim(),
    intent,
  };
}

function setInstagramFormStatus(message, tone = "") {
  const element = qs("instagramFormStatus");
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${tone}`.trim();
}

function setDefaultInstagramPublishAt() {
  const input = qs("instagramPublishAt");
  if (!input || input.value) return;
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  input.value = localDateTimeInputValue(date);
}

function localDateTimeInputValue(value) {
  const date = value instanceof Date ? value : new Date(timestampMs(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function instagramContentById(contentId) {
  return (state.instagramDashboard?.items || []).find((item) => item.contentId === contentId) || null;
}

function instagramMediaInputValue(item) {
  return (item.media || [])
    .map((asset) => `${asset.type === "video" ? "영상" : "이미지"}: ${asset.url || ""}`)
    .join("\n");
}

function editInstagramContent(item) {
  if (!item) return;
  const composer = qs("instagramComposer");
  if (composer) composer.open = true;
  if (qs("instagramContentId")) qs("instagramContentId").value = item.contentId || "";
  if (qs("instagramContentType")) qs("instagramContentType").value = item.contentType || "image";
  if (qs("instagramPillar")) qs("instagramPillar").value = item.pillar || "brand_method";
  if (qs("instagramPublishAt")) qs("instagramPublishAt").value = localDateTimeInputValue(item.publishAt);
  if (qs("instagramLocation")) qs("instagramLocation").value = item.location || "부산 명지";
  if (qs("instagramMediaInput")) qs("instagramMediaInput").value = instagramMediaInputValue(item);
  if (qs("instagramAltText")) qs("instagramAltText").value = item.media?.[0]?.altText || "";
  if (qs("instagramCaption")) qs("instagramCaption").value = item.caption || "";
  if (qs("instagramCta")) qs("instagramCta").value = item.cta || "";
  setInstagramFormStatus("내용을 수정한 뒤 초안 저장 또는 검토 요청을 선택하세요.", "warn");
  composer?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function instagramItemActions(item, connectionConfigured) {
  const actions = [];
  const permalink = instagramHttpsUrl(item.permalink);
  if (["draft", "review", "held", "failed"].includes(item.status)) {
    actions.push(
      `<button class="secondary-action" type="button" data-instagram-action="edit" data-content-id="${escapeHtml(item.contentId)}">수정</button>`,
    );
  }
  if (item.status === "review") {
    actions.push(
      `<button class="primary-action" type="button" data-instagram-action="approve" data-content-id="${escapeHtml(item.contentId)}" ${
        connectionConfigured ? "" : 'disabled aria-disabled="true" title="Meta 연결 후 승인할 수 있습니다."'
      }>승인·예약</button>`,
    );
  }
  if (["review", "queued"].includes(item.status)) {
    actions.push(
      `<button class="secondary-action" type="button" data-instagram-action="hold" data-content-id="${escapeHtml(item.contentId)}">보류</button>`,
    );
  }
  if (item.status === "published" && permalink) {
    actions.push(
      `<a class="secondary-action" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Instagram 열기</a>`,
    );
  }
  return actions.join("");
}

function instagramItemMarkup(item, connectionConfigured, options = {}) {
  const media = item.media?.[0] || null;
  const mediaUrl = instagramHttpsUrl(media?.url);
  const description = item.caption || "캡션 없음";
  const error = item.lastError || item.holdReason || "";
  return `
    <article class="social-item">
      <div class="social-item-media" aria-hidden="true">
        ${
          mediaUrl
            ? media.type === "video"
              ? `<video src="${escapeHtml(mediaUrl)}" muted preload="metadata"></video>`
              : `<img src="${escapeHtml(mediaUrl)}" alt="" loading="lazy" />`
            : `<span>${escapeHtml(instagramContentTypeLabel(item.contentType))}</span>`
        }
      </div>
      <div class="social-item-main">
        <div class="social-item-meta">
          ${pill(item.status)}
          <span>${escapeHtml(instagramContentTypeLabel(item.contentType))}</span>
          <span>${escapeHtml(instagramPillarLabel(item.pillar))}</span>
        </div>
        <strong>${escapeHtml(formatDate(instagramItemTime(item)))}</strong>
        <p class="social-caption-clamp">${escapeHtml(description)}</p>
        ${error ? `<p class="social-item-error">${escapeHtml(error)}</p>` : ""}
      </div>
      ${
        options.showActions === false
          ? ""
          : `<div class="social-item-actions">${instagramItemActions(item, connectionConfigured)}</div>`
      }
    </article>
  `;
}

function renderInstagramApprovalList(items, connectionConfigured) {
  const list = qs("instagramApprovalList");
  if (!list) return;
  const reviewItems = items.filter((item) => item.status === "review");
  list.innerHTML = reviewItems.length
    ? reviewItems.map((item) => instagramItemMarkup(item, connectionConfigured)).join("")
    : `<div class="empty-state">지금 승인할 콘텐츠가 없습니다.</div>`;
}

function renderInstagramScheduleList(items, connectionConfigured) {
  const list = qs("instagramScheduleList");
  if (!list) return;
  const scheduledItems = items
    .filter((item) => ["queued", "publishing"].includes(item.status))
    .sort((a, b) => timestampMs(a.publishAt) - timestampMs(b.publishAt));
  list.innerHTML = scheduledItems.length
    ? scheduledItems.map((item) => instagramItemMarkup(item, connectionConfigured)).join("")
    : `<div class="empty-state">예약된 발행 일정이 없습니다.</div>`;
}

function renderInstagramHistoryList(items, connectionConfigured) {
  const list = qs("instagramHistoryList");
  if (!list) return;
  const filter = String(qs("instagramStatusFilter")?.value || "all");
  const visible = items
    .filter((item) => filter === "all" || item.status === filter)
    .sort((a, b) => timestampMs(instagramItemTime(b)) - timestampMs(instagramItemTime(a)));
  list.innerHTML = visible.length
    ? visible.map((item) => instagramItemMarkup(item, connectionConfigured)).join("")
    : `<div class="empty-state">선택한 상태의 발행 기록이 없습니다.</div>`;
}

function renderInstagramContentDashboard(dashboard) {
  const items = Array.isArray(dashboard?.items) ? dashboard.items : [];
  const counts = dashboard?.counts || {};
  const connection = dashboard?.connection || {};
  const configured = Boolean(connection.configured);
  setText("instagramApprovalCount", `${toNumber(counts.review)}건`);
  setText("instagramScheduledCount", `${toNumber(counts.scheduled)}건`);
  setText("instagramPublishedCount", `${toNumber(counts.published)}건`);
  setText("instagramAttentionCount", `${toNumber(counts.attention)}건`);
  setText(
    "instagramConnectionTitle",
    !dashboard
      ? "콘텐츠 API 연결을 확인하세요."
      : configured
      ? `@${connection.username || connection.accountHandle || "archivepilates_official"} 연결됨`
      : connection.message || "Meta 연결이 필요합니다.",
  );
  setPillText("instagramConnectionPill", configured ? "active" : "blocked_config");
  renderInstagramApprovalList(items, configured);
  renderInstagramScheduleList(items, configured);
  renderInstagramHistoryList(items, configured);
  setDefaultInstagramPublishAt();
}

async function loadInstagramContentDashboard(runtime, verifyConnection = false) {
  const getDashboard = runtime.httpsCallable(runtime.functionsClient, "getInstagramContentDashboard");
  const response = await getDashboard({ limit: 120, verifyConnection });
  return response?.data || null;
}

async function handleInstagramDraftSubmit(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const intent = submitter?.dataset?.socialIntent === "review" ? "review" : "draft";
  const buttons = [qs("instagramSaveButton"), qs("instagramReviewButton")].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setInstagramFormStatus(intent === "review" ? "검토 요청을 저장하고 있습니다." : "초안을 저장하고 있습니다.", "warn");
  try {
    const runtime = await initFirebase();
    const user = await waitForAuth(runtime);
    if (!user) {
      showLoginGate("Instagram 콘텐츠를 저장하려면 운영자 로그인이 필요합니다.");
      throw new Error("운영자 로그인이 필요합니다.");
    }
    const saveDraft = runtime.httpsCallable(runtime.functionsClient, "saveInstagramContentDraft");
    const response = await saveDraft(instagramDraftPayload(intent));
    const item = response?.data?.item || null;
    setInstagramFormStatus(intent === "review" ? "검토 요청으로 저장했습니다." : "초안을 저장했습니다.", "good");
    if (qs("instagramContentId") && item?.contentId) qs("instagramContentId").value = item.contentId;
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("Instagram 콘텐츠 운영 권한을 확인해 주세요.");
    setInstagramFormStatus(error?.message || "콘텐츠 저장에 실패했습니다.", "danger");
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function openInstagramPreview() {
  const payload = instagramDraftPayload("draft");
  const media = payload.media[0];
  const mediaUrl = instagramHttpsUrl(media?.url);
  const mediaContainer = qs("instagramPreviewMedia");
  if (mediaContainer) {
    mediaContainer.innerHTML = mediaUrl
      ? media.type === "video"
        ? `<video src="${escapeHtml(mediaUrl)}" controls playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(media.altText || "")}" />`
      : `<div class="empty-state">미디어 URL을 입력하세요.</div>`;
  }
  setText("instagramPreviewCaption", [payload.caption, payload.cta].filter(Boolean).join("\n\n"));
  const dialog = qs("instagramPreviewDialog");
  if (dialog?.showModal) dialog.showModal();
}

function closeInstagramPreview() {
  qs("instagramPreviewDialog")?.close?.();
}

async function handleInstagramListAction(event) {
  const button = event.target.closest?.("[data-instagram-action]");
  if (!button || button.disabled) return;
  const contentId = button.getAttribute("data-content-id") || "";
  const item = instagramContentById(contentId);
  const action = button.getAttribute("data-instagram-action");
  if (action === "edit") {
    editInstagramContent(item);
    return;
  }
  if (!item || !["approve", "hold"].includes(action)) return;
  button.disabled = true;
  try {
    const runtime = await initFirebase();
    const callableName = action === "approve" ? "approveInstagramContent" : "holdInstagramContent";
    const callable = runtime.httpsCallable(runtime.functionsClient, callableName);
    await callable(
      action === "approve"
        ? { contentId }
        : { contentId, reason: "운영자 보류" },
    );
    setInstagramFormStatus(action === "approve" ? "발행 예약을 승인했습니다." : "콘텐츠를 보류했습니다.", "good");
    await refresh();
  } catch (error) {
    if (isPermissionDenied(error)) showLoginGate("Instagram 콘텐츠 승인 권한을 확인해 주세요.");
    setInstagramFormStatus(error?.message || "콘텐츠 상태 변경에 실패했습니다.", "danger");
  } finally {
    button.disabled = false;
  }
}

function renderFallback(error, options = {}) {
  const reason = isPermissionDenied(error)
    ? options.requireLogin
      ? "로그인 권한 필요"
      : "데이터 권한 확인 필요"
    : "데이터 읽기 실패";
  setConnection(reason, error?.message || "정적 화면으로 표시합니다.");
  renderLane({ status: "active" });
  renderAutomation([]);
  renderImports([]);
  renderQualityIssues([]);
  renderMembers([]);
  state.alimtalkCandidates = [];
  state.alimtalkSends = [];
  state.onsiteWelcomeRequests = [];
  state.memberSignupContracts = [];
  state.pricingInquiryAlimtalkRequests = [];
  state.recommendedMealProgramRequests = [];
  state.recommendedMealReview = null;
  state.refundCases = [];
  state.parkingVehicles = [];
  state.parkingJobs = [];
  state.parkingConfig = null;
  state.staffItems = [];
  state.staffHrCards = [];
  state.staffEvaluationSubmissions = [];
  state.instagramDashboard = null;
  renderPricingInquiryRecentList();
  renderRecommendedMealRecentList();
  renderRecommendedMealQueue();
  renderRecommendedMealReview(null);
  renderRefundCases();
  renderMessages([], []);
  renderStaffHr();
  renderLessons([], [], []);
  renderHomeSummary();
  renderHomeDecisions();
  renderParkingDashboard();
  renderInstagramContentDashboard(null);
  renderMemberDetail(null);
  renderPrivate([], [], [], []);
  renderBusinessFallback(error);
  document.querySelectorAll(".metric-value").forEach((element) => {
    element.textContent = "-";
  });
  document.querySelectorAll(".empty-state").forEach((element) => {
    if (!element.textContent.includes("로그인")) {
      element.classList.add("error-state");
    }
  });
  if (options.requireLogin) showLoginGate();
}

async function refresh() {
  const refreshButton = qs("refreshButton");
  if (refreshButton) refreshButton.disabled = true;
  setConnection("연결 중", "데이터 읽기 확인 중");

  try {
    const runtime = await initFirebase();
    state.readWarnings = [];
    state.readStates = {};
    const user = await waitForAuth(runtime);
    if (!user) {
      const error = new Error("운영자 로그인이 필요합니다.");
      error.code = "permission-denied";
      throw error;
    }
    hideLoginGate();
    const { db, doc, getDoc } = runtime;
    const shouldLoadBusiness = Boolean(qs("businessMonthSelect"));
    const shouldLoadTicketLiability = Boolean(qs("ticketLiabilityTableBody"));
    const shouldLoadHome = Boolean(qs("homeDecisionList"));
    const shouldLoadRecommendedMeals = Boolean(qs("recommendedMealQueue"));
    const shouldLoadRefunds = Boolean(qs("refundCaseList"));
    const shouldLoadMembers = Boolean(qs("membersTable"));
    const shouldLoadMessages = Boolean(qs("messagesCandidateList"));
    const shouldLoadParking = Boolean(qs("parkingRegistrationForm"));
    const shouldLoadMemberDetail = Boolean(qs("memberDetailName"));
    const shouldLoadPrivate = Boolean(qs("privateProgressList")) || shouldLoadHome;
    const shouldLoadLessons = Boolean(qs("lessonsTodayList"));
    const shouldLoadStaffDashboard = Boolean(qs("staffHrList"));
    const shouldLoadInstagram = Boolean(qs("instagramApprovalList"));
    const shouldLoadBusinessSnapshot = shouldLoadBusiness || shouldLoadStaffDashboard;
    const [
      laneSnapshot,
      automationItems,
      sourceImports,
      qualityIssues,
      dashboardSnapshot,
      members,
      memberProfiles,
      renewalCases,
      alimtalkCandidates,
      alimtalkSends,
      onsiteWelcomeRequests,
      memberSignupContracts,
      pricingInquiryAlimtalkRequests,
      recommendedMealProgramRequests,
      memberDetail,
      businessMembers,
      ticketLiabilityReports,
      privateSessions,
      privateRequests,
      privateRecords,
      privateLedgerEntries,
      lessonOccurrences,
      bookings,
      deletedClassLogs,
      deletedLessons,
      staffItems,
      staffHrCards,
      staffEvaluationSubmissions,
    ] = await Promise.all([
      safeRead("workLanes", () => getDoc(doc(db, "workLanes", WORK_LANE_ID)), null),
      safeRead("automationStatus", () => getRecentCollection(db, runtime, "automationStatus"), []),
      safeRead("sourceImports", () => getCollectionBy(db, runtime, "sourceImports", "updatedAt", 50), []),
      safeRead("dataQualityIssues", () => getCollectionBy(db, runtime, "dataQualityIssues", "updatedAt", 100), []),
      shouldLoadBusinessSnapshot
        ? safeRead("dashboardSnapshots/current", () => getDoc(doc(db, "dashboardSnapshots", "current")), null)
        : Promise.resolve(null),
      shouldLoadMembers || shouldLoadHome
        ? safeRead("member360Cards", () => getCollectionBy(db, runtime, "member360Cards", "totalRevenue", 2000), [])
        : Promise.resolve([]),
      shouldLoadMembers || shouldLoadHome
        ? safeRead("memberProfiles", () => getCollectionBy(db, runtime, "memberProfiles", "updatedAt", 2000), [])
        : Promise.resolve([]),
      shouldLoadHome
        ? safeRead("renewalCases", () => getOptionalCollectionBy(db, runtime, "renewalCases", "updatedAt", 1000), [])
        : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome || shouldLoadPrivate
        ? safeRead(
            "alimtalkCandidates",
            () => getRecentCollectionBy(db, runtime, "alimtalkCandidates", "updatedAt", shouldLoadPrivate ? 500 : 12),
            [],
          )
        : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome || shouldLoadPrivate
        ? safeRead(
            "alimtalkSends",
            () => getRecentCollectionBy(db, runtime, "alimtalkSends", "updatedAt", shouldLoadPrivate ? 500 : 12),
            [],
          )
        : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome
        ? safeRead(
            "onsiteWelcomeRequests",
            () => getOptionalCollectionBy(db, runtime, "onsiteWelcomeRequests", "updatedAt", 20),
            [],
          )
        : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome
        ? safeRead(
            "memberSignupContracts",
            () => getOptionalCollectionBy(db, runtime, "memberSignupContracts", "updatedAt", 20),
            [],
          )
        : Promise.resolve([]),
      shouldLoadMessages || shouldLoadHome
        ? safeRead(
            "pricingInquiryAlimtalkRequests",
            () => getOptionalCollectionBy(db, runtime, "pricingInquiryAlimtalkRequests", "updatedAt", 20),
            [],
          )
        : Promise.resolve([]),
      shouldLoadHome || shouldLoadRecommendedMeals
        ? safeRead(
            "recommendedMealProgramRequests",
            () => getOptionalCollectionBy(db, runtime, "recommendedMealProgramRequests", "updatedAt", shouldLoadRecommendedMeals ? 100 : 20),
            [],
          )
        : Promise.resolve([]),
      shouldLoadMemberDetail ? safeRead("memberDetail", () => loadMemberDetail(runtime, memberDetailId()), null) : Promise.resolve(null),
      shouldLoadBusiness
        ? safeRead("businessMembers", () => getRecentCollectionBy(db, runtime, "member360Cards", "totalRevenue", 8), [])
        : Promise.resolve([]),
      shouldLoadTicketLiability
        ? safeRead("ticketLiabilityReports", () => getStudioCollectionBy(db, runtime, "ticketLiabilityReports", "asOfDate", 24), [])
        : Promise.resolve([]),
      shouldLoadPrivate
        ? safeRead(
            "privateLessonSessions",
            () => getCurrentPrivateLessonSessions(db, runtime, 500),
            [],
          )
        : Promise.resolve([]),
      shouldLoadPrivate
        ? safeRead(
            "privateLessonChartRequests",
            () => getRecentCollectionBy(db, runtime, "privateLessonChartRequests", "createdAt", 100),
            [],
          )
        : Promise.resolve([]),
      shouldLoadPrivate
        ? safeRead(
            "privateLessonChartRecords",
            () => getRecentCollectionBy(db, runtime, "privateLessonChartRecords", "createdAt", 100),
            [],
          )
        : Promise.resolve([]),
      shouldLoadPrivate
        ? safeRead("privateSessionLedger", () => getRecentCollectionBy(db, runtime, "privateSessionLedger", "updatedAt", 8), [])
        : Promise.resolve([]),
      shouldLoadLessons
        ? safeRead("lessonOccurrences", () => getOptionalCollectionBy(db, runtime, "lessonOccurrences", "startsAt", 1000), [])
        : Promise.resolve([]),
      shouldLoadLessons ? safeRead("bookings", () => getBookingsForLessonWindow(db, runtime), []) : Promise.resolve([]),
      shouldLoadLessons
        ? safeRead("deletedClassLogs", () => getOptionalCollectionBy(db, runtime, "deletedClassLogs", "updatedAt", 100), [])
        : Promise.resolve([]),
      shouldLoadLessons
        ? safeRead("deletedLessons", () => getOptionalCollectionBy(db, runtime, "deletedLessons", "updatedAt", 100), [])
        : Promise.resolve([]),
      shouldLoadStaffDashboard ? safeRead("staffs", () => getCollectionBy(db, runtime, "staffs", "updatedAt", 200), []) : Promise.resolve([]),
      shouldLoadStaffDashboard
        ? safeRead("staffHrCards", () => getOptionalCollectionBy(db, runtime, "staffHrCards", "updatedAt", 200), [])
        : Promise.resolve([]),
      shouldLoadStaffDashboard
        ? safeRead("staffEvaluationSubmissions", () => getOptionalCollectionBy(db, runtime, "staffEvaluationSubmissions", "submittedAt", 100), [])
        : Promise.resolve([]),
    ]);

    state.lane = laneSnapshot?.exists?.() ? laneSnapshot.data() : { status: "active" };
    state.automationItems = automationItems;
    state.sourceImports = studioItems(sourceImports);
    state.qualityIssues = studioItems(qualityIssues);
    state.memberCards = studioItems(members);
    state.memberProfiles = studioItems(memberProfiles);
    state.members = mergeMemberCardsWithProfiles(state.memberCards, state.memberProfiles);
    state.renewalCases = studioItems(renewalCases);
    state.alimtalkCandidates = alimtalkCandidates;
    state.alimtalkSends = alimtalkSends;
    state.onsiteWelcomeRequests = studioItems(onsiteWelcomeRequests);
    state.memberSignupContracts = studioItems(memberSignupContracts);
    state.pricingInquiryAlimtalkRequests = studioItems(pricingInquiryAlimtalkRequests);
    state.recommendedMealProgramRequests = studioItems(recommendedMealProgramRequests);
    state.memberDetail = memberDetail;
    state.businessMembers = businessMembers;
    state.ticketLiabilityReports = studioItems(ticketLiabilityReports);
    state.privateSessions = privateSessions;
    state.privateRequests = privateRequests;
    state.privateRecords = privateRecords;
    state.privateLedgerEntries = privateLedgerEntries;
    state.lessonOccurrences = lessonOccurrences;
    state.bookings = bookings;
    state.reservations = bookings;
    state.deletedClassLogs = deletedClassLogs;
    state.deletedLessons = deletedLessons;
    state.staffItems = studioItems(staffItems);
    state.staffHrCards = studioItems(staffHrCards);
    state.staffEvaluationSubmissions = studioItems(staffEvaluationSubmissions);
    state.businessSnapshot = dashboardSnapshot?.exists?.() ? normalizeBusinessSnapshot(dashboardSnapshot.data()) : null;
    state.refundCases = shouldLoadRefunds
      ? studioItems(
          await safeRead(
            "refundCases",
            () => getStudioCollectionBy(db, runtime, "refundCases", "updatedAt", 50),
            [],
          ),
        )
      : [];
    if (shouldLoadParking) await loadParkingDashboard(runtime);
    if (shouldLoadInstagram) {
      state.instagramDashboard = await safeRead(
        "socialContent",
        () => loadInstagramContentDashboard(runtime, true),
        null,
      );
    }
    renderLane(state.lane);
    renderAutomation(automationItems);
    renderImports(state.sourceImports);
    renderQualityIssues(state.qualityIssues);
    renderMembers(state.members);
    renderMessages(alimtalkCandidates, alimtalkSends);
    renderStaffHr();
    renderHomeSummary();
    renderHomeDecisions();
    renderParkingDashboard();
    renderInstagramContentDashboard(state.instagramDashboard);
    renderPricingInquiryRecentList();
    renderRecommendedMealRecentList();
    renderRecommendedMealQueue();
    renderRefundCases();
    renderMemberDetail(memberDetail);
    renderPrivate(
      privateRequests,
      privateRecords,
      privateLedgerEntries,
      alimtalkCandidates,
      alimtalkSends,
      privateSessions,
    );
    renderLessons(lessonOccurrences, bookings, [...deletedClassLogs, ...deletedLessons]);
    if (shouldLoadBusiness) {
      if (state.businessSnapshot) renderBusiness(state.businessSnapshot);
      else renderBusinessFallback(new Error("월별 요약 데이터가 없습니다."));
      renderBusinessMemberInsights(businessMembers);
      renderTicketLiabilityReports(state.ticketLiabilityReports);
    }
    if (qs("instructorEvaluationQuizForm")) await loadInstructorEvaluationQuiz();
    renderReadHealth();
  } catch (error) {
    renderFallback(error, { requireLogin: !state.firebaseRuntime?.authClient?.currentUser });
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

enhanceNav();
activateNav();
enhanceRuleSections();
revealHashTarget();
window.addEventListener("hashchange", revealHashTarget);
qs("refreshButton")?.addEventListener("click", refresh);
qs("pricingInquiryForm")?.addEventListener("submit", handlePricingInquiryAlimtalkSubmit);
qs("pricingInquiryHistoryToggle")?.addEventListener("click", togglePricingInquiryHistory);
qs("recommendedMealProgramForm")?.addEventListener("submit", handleRecommendedMealProgramSubmit);
qs("recommendedMealHistoryToggle")?.addEventListener("click", toggleRecommendedMealHistory);
qs("recommendedMealQueue")?.addEventListener("click", handleMealQueueClick);
qs("refundLookupForm")?.addEventListener("submit", handleRefundLookup);
qs("refundCalculationForm")?.addEventListener("submit", handleRefundPreview);
qs("refundTicketList")?.addEventListener("change", (event) => {
  const input = event.target.closest?.('input[name="refundTicket"]');
  if (input) selectRefundTicket(input.value);
});
qs("refundCalculationForm")?.addEventListener("input", () => {
  if (refundFlow.preview) {
    resetRefundPreview();
    setRefundStep(2);
    setRefundStatus("refundCalculationStatus", "입력값이 변경되었습니다. 환불금액을 다시 계산하세요.", "warn");
  }
});
qs("refundTicketKind")?.addEventListener("change", updateRefundKindFields);
qs("refundCopyButton")?.addEventListener("click", handleRefundCopy);
qs("refundConfirmCheck")?.addEventListener("change", (event) => {
  if (qs("refundSendButton")) qs("refundSendButton").disabled = !event.target.checked || !refundFlow.preview;
});
qs("refundSendButton")?.addEventListener("click", handleRefundSend);
qs("mealFilterBar")?.addEventListener("click", handleMealFilterClick);
qs("mealGenerateButton")?.addEventListener("click", handleMealGenerate);
qs("mealDraftForm")?.addEventListener("submit", handleMealDraftSubmit);
qs("mealSendButton")?.addEventListener("click", handleMealApproveAndSend);
qs("parkingRegistrationForm")?.addEventListener("submit", handleParkingVehicleSubmit);
qs("parkingOwnerType")?.addEventListener("change", syncParkingVisitorFields);
qs("parkingAutoApplyButton")?.addEventListener("click", handleParkingAutoApplyClick);
qs("parkingVehicleList")?.addEventListener("click", handleParkingVehicleListClick);
qs("renewalPipelineList")?.addEventListener("click", handleRenewalActionClick);
qs("commandPaletteOpen")?.addEventListener("click", openCommandPalette);
qs("commandPaletteInput")?.addEventListener("input", renderCommandPaletteResults);
qs("commandPalette")?.addEventListener("click", (event) => {
  if (event.target === qs("commandPalette")) closeCommandPalette();
  if (event.target.closest?.(".command-palette-results a")) closeCommandPalette();
});
qs("instructorEvaluationQuizForm")?.addEventListener("submit", handleInstructorEvaluationQuizSubmit);
qs("instagramDraftForm")?.addEventListener("submit", handleInstagramDraftSubmit);
qs("instagramPreviewButton")?.addEventListener("click", openInstagramPreview);
qs("instagramPreviewClose")?.addEventListener("click", closeInstagramPreview);
qs("instagramPreviewDialog")?.addEventListener("click", (event) => {
  if (event.target === qs("instagramPreviewDialog")) closeInstagramPreview();
});
qs("instagramApprovalList")?.addEventListener("click", handleInstagramListAction);
qs("instagramScheduleList")?.addEventListener("click", handleInstagramListAction);
qs("instagramHistoryList")?.addEventListener("click", handleInstagramListAction);
qs("instagramStatusFilter")?.addEventListener("change", () =>
  renderInstagramHistoryList(
    state.instagramDashboard?.items || [],
    Boolean(state.instagramDashboard?.connection?.configured),
  ),
);
qs("businessMonthSelect")?.addEventListener("change", (event) => renderBusinessMonth(event.target.value));
qs("ticketLiabilityMonthSelect")?.addEventListener("change", (event) => renderTicketLiabilityMonth(event.target.value));
document.addEventListener("submit", (event) => {
  const form = event.target.closest?.("[data-staff-essay-score-form]");
  if (!form) return;
  handleStaffEssayScoreAdjustSubmit(event, form);
});
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-staff-detail-key]");
  if (!button) return;
  selectedStaffKey = button.getAttribute("data-staff-detail-key") || "";
  renderStaffHr();
});
window.addEventListener("keydown", (event) => {
  const isCommandSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
  if (isCommandSearch) {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "Escape") closeCommandPalette();
});
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
syncParkingVisitorFields();
if (qs("refundRequestedAt") && !qs("refundRequestedAt").value) {
  qs("refundRequestedAt").value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
if (document.querySelector("[data-firestore-dashboard]")) refresh();
