import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const config = window.KANGSAIN_FIREBASE_CONFIG;
const loginGate = document.getElementById("loginGate");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const board = document.getElementById("board");
const instructorChips = document.getElementById("instructorChips");
const instructorDropdown = document.getElementById("instructorDropdown");
const instructorDropdownBtn = document.getElementById("instructorDropdownBtn");
const instructorDropdownLabel = document.getElementById("instructorDropdownLabel");
const timeFilter = document.getElementById("timeFilter");
const operatorBtn = document.getElementById("operatorBtn");
const sourceText = document.getElementById("sourceText");
const details = document.getElementById("details");
const toast = document.getElementById("toast");

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const TIME_ROWS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const SAMPLE_NAMES = ["김아름", "이서윤", "박지민", "최민정", "정하늘"];
const EXCLUDED_INSTRUCTOR_NAMES = ["운영자", "김기효"];
const FALLBACK_STAFF_COLORS = ["#6d7d58", "#426b8f", "#9b5148", "#a8742a", "#6f5f91", "#2f6fa3", "#7b6f46", "#8b5d5d"];
const state = {
  app: null,
  auth: null,
  db: null,
  functions: null,
  user: null,
  weekStart: startOfWeek(new Date()),
  instructors: [],
  lectures: [],
  otherSchedules: [],
  availability: [],
  selectedInstructorIds: [],
  timeFilter: "all",
  operatorMode: false,
  usingSample: false,
  preview: false,
};

function setLoginVisible(visible, message = "") {
  loginGate.classList.toggle("on", visible);
  loginError.textContent = message;
}

function friendlyAuthError(err) {
  const code = String(err?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "로그인 정보를 확인하세요";
  }
  if (code.includes("too-many-requests")) return "요청이 많습니다. 잠시 후 다시 시도하세요";
  return err?.message || "로그인에 실패했습니다";
}

function ymd(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function timeToMin(time) {
  const [h, m] = String(time || "00:00").slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function timestampToTime(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function overlaps(rowTime, start, end) {
  const rowStart = timeToMin(rowTime);
  const rowEnd = rowStart + 60;
  const busyStart = timeToMin(start);
  const busyEnd = timeToMin(end || start) || busyStart + 60;
  return busyStart < rowEnd && busyEnd > rowStart;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("on");
  setTimeout(() => toast.classList.remove("on"), 1700);
}

function weekDates() {
  return DAYS.map((_, index) => addDays(state.weekStart, index));
}

function currentRange() {
  const dates = weekDates();
  return { start: ymd(dates[0]), end: ymd(dates[6]) };
}

function fallbackInstructors() {
  return SAMPLE_NAMES.filter((name) => !isExcludedInstructorName(name)).map((name, index) => ({
    staffId: `sample-${index + 1}`,
    name,
    role: "instructor",
    active: true,
    color: FALLBACK_STAFF_COLORS[index % FALLBACK_STAFF_COLORS.length],
    sample: true,
  }));
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function isExcludedInstructorName(name) {
  const normalized = normalizeName(name);
  return EXCLUDED_INSTRUCTOR_NAMES.some((blocked) => normalizeName(blocked) === normalized);
}

function buildDefaultAvailability(instructors) {
  const dayPatterns = {
    0: ["10:00", "11:00", "15:00", "16:00", "19:00"],
    1: ["09:00", "13:00", "14:00", "18:00", "20:00"],
    2: ["10:00", "12:00", "15:00", "17:00", "19:00"],
    3: ["09:00", "11:00", "14:00", "16:00", "20:00"],
    4: ["10:00", "13:00", "15:00", "18:00"],
    5: ["09:00", "10:00", "12:00", "14:00"],
    6: [],
  };
  const dates = weekDates();
  return instructors.flatMap((instructor, instructorIndex) =>
    dates.flatMap((date, dayIndex) => {
      const times = (dayPatterns[dayIndex] || []).filter((_, idx) => (idx + instructorIndex + dayIndex) % 3 !== 1);
      return times.map((time, slotIndex) => ({
        staffId: instructor.staffId,
        staffName: instructor.name,
        date: ymd(date),
        time,
        endTime: nextHour(time),
        status: slotIndex % 4 === 0 ? "confirm" : "available",
        source: instructor.sample ? "기본 가능 시간" : "강사 기본 가능 시간",
        checkedAt: slotIndex % 4 === 0 ? "확인 필요" : "월간 확인",
      }));
    }),
  );
}

function nextHour(value) {
  const next = timeToMin(value) + 60;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function normalizeStaff(doc) {
  const data = doc.data();
  return {
    staffId: String(data.staffId || doc.id),
    name: String(data.name || data.staffName || doc.id),
    role: data.role || "instructor",
    active: data.active !== false,
    color: staffColorFromData(data, doc.id),
  };
}

function staffColorFromData(data, fallbackKey = "") {
  const candidates = [
    data.privateScheduleColor,
    data.archiveInColor,
    data.scheduleColor,
    data.calendarColor,
    data.lessonColor,
    data.color,
    data.themeColor,
    data.backgroundColor,
    data.hexColor,
  ];
  const value = candidates.find((item) => isHexColor(item));
  return value || colorFromKey(data.staffId || data.name || fallbackKey);
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function colorFromKey(value) {
  const key = String(value || "");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return FALLBACK_STAFF_COLORS[hash % FALLBACK_STAFF_COLORS.length];
}

function normalizeBusy(doc, kind) {
  const data = doc.data();
  const names = Array.isArray(data.staffNames) && data.staffNames.length ? data.staffNames : [data.staffName];
  const ids = Array.isArray(data.staffIds) && data.staffIds.length ? data.staffIds : [data.staffId];
  return {
    id: doc.id,
    kind,
    date: data.date,
    start: timestampToTime(data.startAt),
    end: timestampToTime(data.endAt),
    title: data.title || data.divisionName || data.category || (kind === "lecture" ? "ARCHIVE PILATES 수업" : "기타 일정"),
    status: data.status || "scheduled",
    lessonType: data.lessonType || "unknown",
    staffIds: ids.filter(Boolean).map(String),
    staffNames: names.filter(Boolean).map(String),
  };
}

function normalizeAvailability(doc) {
  const data = doc.data();
  return normalizeAvailabilityData(data, doc.id);
}

function normalizeAvailabilityData(data, fallbackId = "") {
  return {
    slotId: String(data.slotId || fallbackId),
    staffId: String(data.staffId || ""),
    staffName: String(data.staffName || ""),
    date: String(data.date || ""),
    time: String(data.startTime || ""),
    endTime: String(data.endTime || nextHour(data.startTime || "")),
    status: String(data.status || "available"),
    source: sourceLabel(data.source),
    sourceKey: String(data.source || "manual"),
    memo: String(data.memo || ""),
    checkedAt: checkedAtLabel(data.checkedAt),
  };
}

function checkedAtLabel(value) {
  if (value?.toDate) return formatDateTime(value.toDate()) || "수동 확인";
  if (typeof value === "string" && value) return formatDateTime(new Date(value)) || "수동 확인";
  return "수동 확인";
}

function sourceLabel(source) {
  if (source === "monthly_alimtalk") return "월간 알림톡";
  if (source === "weekly_check") return "주간 확인";
  if (source === "import") return "가져오기";
  return "수동 입력";
}

function formatDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${ymd(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function readQuerySafely(q) {
  try {
    return await getDocs(q);
  } catch (err) {
    console.warn("Firestore query failed:", err.message);
    return null;
  }
}

async function loadLiveData() {
  if (!state.db || !state.user) throw new Error("로그인이 필요합니다");
  const { start, end } = currentRange();
  const [staffSnap, lectureSnap, otherSnap, availabilityRows] = await Promise.all([
    readQuerySafely(query(collection(state.db, "staffs"), limit(120))),
    readQuerySafely(query(collection(state.db, "lectures"), where("date", ">=", start), where("date", "<=", end), orderBy("date"), limit(500))),
    readQuerySafely(query(collection(state.db, "otherSchedules"), where("date", ">=", start), where("date", "<=", end), orderBy("date"), limit(500))),
    loadPrivateAvailabilitySlots(start, end),
  ]);

  const staffRows = staffSnap
    ? staffSnap.docs.map(normalizeStaff).filter((s) => s.active && s.role !== "viewer" && !isExcludedInstructorName(s.name))
    : [];
  state.instructors = staffRows;
  state.lectures = lectureSnap ? lectureSnap.docs.map((doc) => normalizeBusy(doc, "lecture")).filter((row) => row.status !== "deleted") : [];
  state.otherSchedules = otherSnap ? otherSnap.docs.map((doc) => normalizeBusy(doc, "other")).filter((row) => row.status !== "deleted") : [];
  state.availability = availabilityRows;
  state.usingSample = false;
}

async function loadPrivateAvailabilitySlots(startDate, endDate) {
  if (state.functions) {
    try {
      const listSlots = httpsCallable(state.functions, "adminSavePrivateAvailabilitySlot");
      const result = await listSlots({ action: "list", startDate, endDate });
      const slots = Array.isArray(result.data?.slots) ? result.data.slots : [];
      return slots.map((slot) => normalizeAvailabilityData(slot, slot.slotId)).filter((row) => row.staffId && row.date && row.time);
    } catch (err) {
      console.warn("Callable availability query failed:", err.message);
    }
  }

  const snap = await readQuerySafely(query(
    collection(state.db, "privateAvailabilitySlots"),
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date"),
    limit(800),
  ));
  return snap ? snap.docs.map(normalizeAvailability).filter((row) => row.staffId && row.date && row.time) : [];
}

function getFilteredInstructors() {
  const all = state.instructors;
  if (!state.selectedInstructorIds.length) return all;
  return all.filter((item) => state.selectedInstructorIds.includes(item.staffId));
}

function selectedInstructorLabel() {
  if (!state.selectedInstructorIds.length) return "전체 강사";
  const names = state.instructors
    .filter((item) => state.selectedInstructorIds.includes(item.staffId))
    .map((item) => item.name)
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`;
}

function selectedStaffIdsForForm(fallbackStaffId = "") {
  if (fallbackStaffId) return [fallbackStaffId];
  return state.selectedInstructorIds.length ? state.selectedInstructorIds : [];
}

function isTimeVisible(time) {
  const hour = Number(time.slice(0, 2));
  if (state.timeFilter === "morning") return hour < 12;
  if (state.timeFilter === "afternoon") return hour >= 12 && hour < 18;
  if (state.timeFilter === "evening") return hour >= 18;
  return true;
}

function busyFor(instructor, date, time) {
  return busyForRange(instructor, date, time, nextHour(time));
}

function busyForRange(instructor, date, startTime, endTime) {
  const allBusy = [...state.lectures, ...state.otherSchedules];
  return allBusy.filter((item) => {
    if (item.date !== date || !rangesOverlap(startTime, endTime, item.start, item.end)) return false;
    const byId = item.staffIds.includes(instructor.staffId);
    const byName = item.staffNames.includes(instructor.name);
    return byId || byName;
  });
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = timeToMin(startA);
  const aEnd = timeToMin(endA || startA);
  const bStart = timeToMin(startB);
  const bEnd = timeToMin(endB || startB);
  return aStart < bEnd && bStart < aEnd;
}

function slotFor(instructor, date, time) {
  const busy = busyFor(instructor, date, time);
  const archiveBusy = busy.filter((item) => item.kind === "lecture");
  const available = state.availability.find(
    (item) => item.staffId === instructor.staffId && item.date === date && item.time === time,
  );
  if (archiveBusy.length) {
    return {
      type: "busy",
      lockedByLecture: true,
      instructor,
      date,
      time,
      reason: archiveBusy.map((item) => `ARCHIVE PILATES 수업 · ${item.title}`).join(" / "),
    };
  }
  if (available && available.status !== "unavailable") {
    return {
      type: ["confirm", "request"].includes(available.status) ? available.status : "available",
      slotId: available.slotId,
      instructor,
      date,
      time,
      endTime: available.endTime || nextHour(time),
      memo: available.memo || "",
      sourceKey: available.sourceKey || "manual",
      source: busy.length ? `${available.source} · 운영자 예외` : available.source,
      checkedAt: available.checkedAt,
    };
  }
  if (busy.length) {
    return {
      type: "busy",
      instructor,
      date,
      time,
      reason: busy.map((item) => (item.kind === "lecture" ? `ARCHIVE PILATES 수업 · ${item.title}` : `외부/기타 일정 · ${item.title}`)).join(" / "),
    };
  }
  if (!available) {
    return {
      type: "available",
      virtual: true,
      instructor,
      date,
      time,
      endTime: nextHour(time),
      memo: "",
      sourceKey: "manual",
      source: "센터 수업 외 우선 가능",
      checkedAt: "알림톡 확인 전",
    };
  }
  return {
    type: "unavailable",
    slotId: available.slotId,
    instructor,
    date,
    time,
    endTime: available.endTime || nextHour(time),
    memo: available.memo || "",
    sourceKey: available.sourceKey || "manual",
    source: available.source,
    checkedAt: available.checkedAt,
  };
}

function slotHtml(slot) {
  const type = slot.type === "unavailable" ? "busy" : slot.type === "busy" ? "busy" : slot.type;
  const meta = slot.type === "busy" ? slot.reason : `${slot.checkedAt} · ${slot.source}`;
  const staffColor = slot.instructor?.color || colorFromKey(slot.instructor?.staffId || slot.instructor?.name);
  return `
    <button class="slot ${type}" type="button" style="${slotStyle(staffColor)}" data-slot='${encodeURIComponent(JSON.stringify(slot))}'>
      <span class="slot-name">${slot.instructor.name}</span>
      <span class="slot-time">${slot.time}</span>
      <span class="slot-meta">${meta}</span>
    </button>
  `;
}

function slotStyle(color) {
  const safeColor = isHexColor(color) ? color.trim() : FALLBACK_STAFF_COLORS[0];
  return `--staff-color:${safeColor};--staff-ink:${readableInk(safeColor)}`;
}

function readableInk(color) {
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const darkened = [r, g, b].map((value) => Math.max(20, Math.round(value * 0.45)));
  return `rgb(${darkened.join(",")})`;
}

function renderHeaderControls() {
  const dates = weekDates();
  document.getElementById("weekLabel").textContent = `${ymd(dates[0]).slice(5).replace("-", ".")} - ${ymd(dates[6]).slice(5).replace("-", ".")}`;
  instructorChips.innerHTML = [
    `<button class="chip ${state.selectedInstructorIds.length === 0 ? "on" : ""}" data-id="all" type="button">전체</button>`,
    ...state.instructors.map((item) => `<button class="chip ${state.selectedInstructorIds.includes(item.staffId) ? "on" : ""}" data-id="${item.staffId}" type="button">${item.name}</button>`),
  ].join("");
  instructorDropdownLabel.textContent = selectedInstructorLabel();
  operatorBtn.classList.toggle("on", state.operatorMode);
  sourceText.textContent = state.usingSample
    ? "라이브 데이터가 부족한 항목은 기본 가능 시간으로 표시 중입니다. StudioMate 점유 시간은 불러온 범위만 반영됩니다."
    : "센터 수업과 등록된 불가 시간을 제외한 시간은 우선 가능으로 보고, 알림톡 확인 후 안 되는 슬롯만 삭제해 최종 제출합니다.";
}

function renderStats(slots) {
  document.getElementById("availableCount").textContent = slots.filter((s) => s.type === "available").length;
  document.getElementById("confirmCount").textContent = slots.filter((s) => s.type === "confirm").length;
  document.getElementById("instructorCount").textContent = getFilteredInstructors().length;
  document.getElementById("busyCount").textContent = slots.filter((s) => s.type === "busy").length;
}

function renderBoard() {
  renderHeaderControls();
  const dates = weekDates();
  const instructors = getFilteredInstructors();
  const allSlots = [];
  board.innerHTML = `<div class="corner"></div>` + dates.map((date, index) => `
    <div class="day-head">
      <div class="day-name">${DAYS[index]}</div>
      <div class="day-date">${ymd(date).slice(5).replace("-", ".")}</div>
    </div>
  `).join("");

  TIME_ROWS.filter(isTimeVisible).forEach((time) => {
    board.insertAdjacentHTML("beforeend", `<div class="time-cell">${time}</div>`);
    dates.forEach((date) => {
      const dateKey = ymd(date);
      const cellSlots = instructors.map((instructor) => slotFor(instructor, dateKey, time)).filter(Boolean);
      allSlots.push(...cellSlots);
      const visibleSlots = cellSlots.filter((slot) => state.operatorMode || slot.type !== "busy");
      const hiddenBusy = cellSlots.length > 0 && visibleSlots.length === 0;
      board.insertAdjacentHTML("beforeend", `
        <div class="slot-cell">
          ${visibleSlots.length ? `<div class="slot-stack">${visibleSlots.map(slotHtml).join("")}</div>` : emptyCellHtml(dateKey, time, hiddenBusy)}
        </div>
      `);
    });
  });
  renderStats(allSlots);
}

function emptyCellHtml(date, time, hiddenBusy = false) {
  if (hiddenBusy) return `<button class="empty-slot blocked" type="button" data-blocked='${encodeURIComponent(JSON.stringify({ date, time }))}'>불가 시간</button>`;
  const staffIds = selectedStaffIdsForForm();
  if (!state.operatorMode || !staffIds.length) return `<div class="empty-slot"></div>`;
  return `<button class="empty-slot" type="button" data-empty='${encodeURIComponent(JSON.stringify({ date, time, staffIds }))}'>등록</button>`;
}

function defaultDetailHtml() {
  return `
    <div class="detail">
      <b>슬롯을 선택하세요</b>
      상담 중 제안 가능한 시간과 불가 사유를 여기서 확인합니다. 편집은 운영자 모드에서만 가능합니다.
    </div>
  `;
}

function closeDetail() {
  details.innerHTML = defaultDetailHtml();
}

function renderDetail(slot) {
  const label = slot.type === "busy" || slot.type === "unavailable" ? "불가 사유" : slot.type === "confirm" ? "확인 필요 슬롯" : "제안 가능 슬롯";
  const body = slot.type === "busy" ? slot.reason : `${slot.source} · ${slot.checkedAt}`;
  const blocked = slot.type === "busy" || slot.type === "unavailable";
  const canEdit = state.operatorMode && !slot.lockedByLecture;
  details.innerHTML = `
    <div class="detail">
      <div class="detail-head">
        <b>${label}</b>
        <button class="close-btn" type="button" data-close-detail title="닫기">×</button>
      </div>
      <div>${slot.date} ${slot.time} · ${slot.instructor.name}<br>${body}</div>
    </div>
    <div class="detail">
      <b>운영 액션</b>
      ${state.operatorMode
        ? slot.lockedByLecture
          ? "ARCHIVE PILATES 수업과 겹친 시간은 운영자 모드에서도 가능 슬롯으로 변경할 수 없습니다."
          : "운영자 모드입니다. 필요하면 슬롯 상태를 수정하고 저장하세요."
        : blocked
          ? "불가 시간입니다. 가능 시간으로 바꾸는 작업은 운영자 모드에서만 가능합니다."
          : "회원에게 후보로 제안하거나 강사에게 최종 확인 후 StudioMate에 등록하세요."}
    </div>
    ${canEdit ? slotForm(slot) : ""}
  `;
}

function renderBlockedDetail(cell) {
  details.innerHTML = `
    <div class="detail">
      <div class="detail-head">
        <b>불가 시간</b>
        <button class="close-btn" type="button" data-close-detail title="닫기">×</button>
      </div>
      <div>${cell.date} ${cell.time}<br>센터 수업 또는 등록된 불가 일정과 겹쳐 일반 모드에서는 가능 슬롯으로 요청할 수 없습니다.</div>
    </div>
    <div class="detail">
      <b>운영자 모드 필요</b>
      ARCHIVE PILATES 수업과 겹친 시간은 운영자 모드에서도 가능 슬롯으로 변경할 수 없습니다.
    </div>
  `;
  showToast("불가 시간입니다. 운영자 모드에서만 변경할 수 있습니다");
}

function renderEmptyDetail(cell) {
  if (!state.operatorMode) {
    showToast("슬롯 등록은 운영자 모드에서만 가능합니다");
    return;
  }
  const staffIds = Array.isArray(cell.staffIds) ? cell.staffIds : [cell.staffId].filter(Boolean);
  const instructors = state.instructors.filter((item) => staffIds.includes(item.staffId));
  const instructor = instructors[0];
  if (!instructor) return;
  details.innerHTML = `
    <div class="detail">
      <div class="detail-head">
        <b>선택 슬롯</b>
        <button class="close-btn" type="button" data-close-detail title="닫기">×</button>
      </div>
      <div>${cell.date} ${cell.time} · ${instructors.map((item) => item.name).join(", ")}</div>
    </div>
    ${slotForm({
      instructor,
      staffIds,
      date: cell.date,
      time: cell.time,
      endTime: nextHour(cell.time),
      type: "available",
      sourceKey: "manual",
      memo: "",
    })}
  `;
}

function slotForm(slot) {
  const isExisting = Boolean(slot.slotId);
  const status = slot.type === "unavailable" || slot.type === "busy" ? "unavailable" : slot.type || "available";
  const selectedStaffIds = slot.staffIds || selectedStaffIdsForForm(slot.instructor?.staffId);
  const weekday = weekIndexFromDate(slot.date);
  return `
    <form class="detail slot-form" data-slot-form>
      <input type="hidden" name="slotId" value="${slot.slotId || ""}">
      <label>강사
        <select name="staffIds" multiple size="${Math.min(Math.max(state.instructors.length, 3), 7)}">
          ${state.instructors.map((item) => `<option value="${item.staffId}" ${selectedStaffIds.includes(item.staffId) ? "selected" : ""}>${item.name}</option>`).join("")}
        </select>
      </label>
      <div class="row">
        <label>시작일
          <input name="startDate" type="date" value="${slot.date}">
        </label>
        <label>종료일
          <input name="endDate" type="date" value="${slot.date}">
        </label>
      </div>
      <div class="row">
        <label>반복 주기
          <select name="repeatEvery">
            <option value="1">매주</option>
            <option value="2">2주 간격</option>
          </select>
        </label>
        <label>출처
          <select name="source">
            <option value="manual" ${slot.sourceKey === "manual" ? "selected" : ""}>수동 입력</option>
            <option value="monthly_alimtalk" ${slot.sourceKey === "monthly_alimtalk" ? "selected" : ""}>월간 알림톡</option>
            <option value="weekly_check" ${slot.sourceKey === "weekly_check" ? "selected" : ""}>주간 확인</option>
            <option value="import" ${slot.sourceKey === "import" ? "selected" : ""}>가져오기</option>
          </select>
        </label>
      </div>
      <div class="weekday-pick" aria-label="요일 선택">
        ${DAYS.map((day, index) => `
          <label class="weekday ${index === weekday ? "on" : ""}">
            <input type="checkbox" name="repeatWeekdays" value="${index}" ${index === weekday ? "checked" : ""}>
            <span>${day}</span>
          </label>
        `).join("")}
      </div>
      <div class="row">
        <label>시작
          <select name="startTime">${TIME_ROWS.map((time) => `<option value="${time}" ${time === slot.time ? "selected" : ""}>${time}</option>`).join("")}</select>
        </label>
        <label>종료
          <select name="endTime">${TIME_ROWS.concat(["22:00"]).map((time) => `<option value="${time}" ${time === (slot.endTime || nextHour(slot.time)) ? "selected" : ""}>${time}</option>`).join("")}</select>
        </label>
      </div>
      <div class="row">
        <label>상태
          <select name="status">
            <option value="available" ${status === "available" ? "selected" : ""}>가능</option>
            <option value="confirm" ${status === "confirm" ? "selected" : ""}>확인 필요</option>
            <option value="request" ${status === "request" ? "selected" : ""}>회원 요청중</option>
            <option value="unavailable" ${status === "unavailable" ? "selected" : ""}>불가</option>
          </select>
        </label>
      </div>
      <label>메모
        <textarea name="memo" placeholder="예: 6월 월간 확인, 화목 저녁만 가능">${slot.memo || ""}</textarea>
      </label>
      <div class="form-actions">
        <button class="solid-btn" type="button" data-save-slot>저장</button>
        ${isExisting ? `<button class="danger-btn" type="button" data-delete-slot="${slot.slotId}">삭제</button>` : ""}
      </div>
    </form>
  `;
}

function weekIndexFromDate(date) {
  const jsDay = new Date(`${date}T00:00:00`).getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function expandRepeatDates(startDate, endDate, weekdays, repeatEvery) {
  const selectedDays = new Set(weekdays.map(Number));
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const interval = Math.max(Number(repeatEvery) || 1, 1);
  const result = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const weeksFromStart = Math.floor((cursor - startOfWeek(start)) / (7 * 24 * 60 * 60 * 1000));
    const dayIndex = weekIndexFromDate(ymd(cursor));
    if (selectedDays.has(dayIndex) && weeksFromStart % interval === 0) result.push(ymd(cursor));
  }
  return result;
}

function expandTimeSlots(startTime, endTime) {
  const start = timeToMin(startTime);
  const end = timeToMin(endTime);
  if (!startTime || !endTime || end <= start) return [];
  return TIME_ROWS.filter((time) => {
    const value = timeToMin(time);
    return value >= start && value < end;
  }).map((time) => ({
    startTime: time,
    endTime: nextHour(time),
  }));
}

async function refresh() {
  try {
    await loadLiveData();
    renderBoard();
    showToast("스케줄을 새로 불러왔습니다");
  } catch (err) {
    if (!state.preview) {
      state.instructors = [];
      state.lectures = [];
      state.otherSchedules = [];
      state.availability = [];
      state.usingSample = false;
      renderBoard();
      showToast(err.message || "데이터를 불러오지 못했습니다");
      return;
    }
    state.instructors = fallbackInstructors();
    state.lectures = [];
    state.otherSchedules = [];
    state.availability = buildDefaultAvailability(state.instructors);
    state.usingSample = true;
    renderBoard();
    showToast(err.message || "샘플 데이터로 표시합니다");
  }
}

async function saveSlot(form) {
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  const staffIds = formData.getAll("staffIds").map(String).filter(Boolean);
  const repeatWeekdays = formData.getAll("repeatWeekdays");
  const dates = expandRepeatDates(data.startDate, data.endDate, repeatWeekdays, data.repeatEvery);
  const timeSlots = expandTimeSlots(data.startTime, data.endTime);
  if (!staffIds.length) throw new Error("강사를 선택하세요");
  if (!dates.length) throw new Error("등록할 요일과 기간을 확인하세요");
  if (!timeSlots.length) throw new Error("시작/종료 시간을 확인하세요");
  const wantsAvailable = ["available", "confirm", "request"].includes(data.status);
  const wantsUnavailable = data.status === "unavailable";
  if (wantsAvailable) {
    const conflict = findBusyConflict(staffIds, dates, data.startTime, data.endTime, { lectureOnly: state.operatorMode });
    if (conflict) {
      const prefix = conflict.kind === "lecture" ? "ARCHIVE PILATES 수업 시간입니다" : "불가 시간입니다";
      throw new Error(`${conflict.name} ${conflict.date} ${data.startTime}-${data.endTime}은 ${prefix}`);
    }
  }
  if (wantsUnavailable && !data.source) data.source = "manual";
  if (state.preview) {
    staffIds.forEach((staffId) => {
      const instructor = state.instructors.find((item) => item.staffId === staffId);
      dates.forEach((date) => {
        timeSlots.forEach((timeSlot) => {
          const slotId = `preview_${staffId}_${date}_${timeSlot.startTime.replace(":", "")}`;
          const existingIndex = state.availability.findIndex((item) => item.slotId === slotId);
          const row = {
            slotId,
            staffId,
            staffName: instructor?.name || "",
            date,
            time: timeSlot.startTime,
            endTime: timeSlot.endTime,
            status: data.status,
            source: sourceLabel(data.source),
            sourceKey: data.source,
            memo: data.memo,
            checkedAt: "방금 수정",
          };
          if (existingIndex >= 0) state.availability[existingIndex] = row;
          else state.availability.push(row);
        });
      });
    });
    renderBoard();
    closeDetail();
    showToast(`슬롯 ${staffIds.length * dates.length * timeSlots.length}개를 저장했습니다`);
    return;
  }
  const save = httpsCallable(state.functions, "adminSavePrivateAvailabilitySlot");
  await Promise.all(staffIds.flatMap((staffId) =>
    dates.flatMap((date) => timeSlots.map((timeSlot) => save({
      staffId,
      date,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      status: data.status,
      source: data.source,
      memo: data.memo,
    }))),
  ));
  await loadLiveData();
  renderBoard();
  closeDetail();
  showToast(`슬롯 ${staffIds.length * dates.length * timeSlots.length}개를 저장했습니다`);
}

function findBusyConflict(staffIds, dates, startTime, endTime, options = {}) {
  for (const staffId of staffIds) {
    const instructor = state.instructors.find((item) => item.staffId === staffId);
    if (!instructor) continue;
    for (const date of dates) {
      const conflict = busyForRange(instructor, date, startTime, endTime).find((item) => !options.lectureOnly || item.kind === "lecture");
      if (conflict) {
        return { name: instructor.name, date, kind: conflict.kind };
      }
    }
  }
  return null;
}

async function deleteSlot(slotId) {
  if (state.preview) {
    state.availability = state.availability.filter((item) => item.slotId !== slotId);
    renderBoard();
    showToast("미리보기 슬롯을 삭제했습니다");
    return;
  }
  const del = httpsCallable(state.functions, "adminDeletePrivateAvailabilitySlot");
  await del({ slotId });
  await refresh();
}

function bindEvents() {
  window.savePrivateSlotFromButton = async (button) => {
    await saveFromButton(button);
  };
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = document.getElementById("phoneInput").value.replace(/\D/g, "");
    const pin = document.getElementById("pinInput").value.trim();
    if (!phone || !pin) return setLoginVisible(true, "휴대폰번호와 비밀번호를 입력하세요");
    try {
      await signInWithEmailAndPassword(state.auth, `p${phone}@archivepilates.com`, pin);
    } catch (err) {
      setLoginVisible(true, friendlyAuthError(err));
    }
  });
  const signOutBtn = document.getElementById("signOutBtn");
  window.signOutPrivateSchedule = () => signOut(state.auth);
  signOutBtn.addEventListener("click", window.signOutPrivateSchedule);
  document.getElementById("refreshBtn").addEventListener("click", refresh);
  document.getElementById("prevWeek").addEventListener("click", async () => {
    state.weekStart = addDays(state.weekStart, -7);
    await refresh();
  });
  document.getElementById("nextWeek").addEventListener("click", async () => {
    state.weekStart = addDays(state.weekStart, 7);
    await refresh();
  });
  operatorBtn.addEventListener("click", () => {
    state.operatorMode = !state.operatorMode;
    closeDetail();
    renderBoard();
  });
  instructorDropdownBtn.addEventListener("click", () => {
    instructorDropdown.classList.toggle("open");
  });
  document.addEventListener("click", (event) => {
    if (!instructorDropdown.contains(event.target)) instructorDropdown.classList.remove("open");
  });
  timeFilter.addEventListener("change", (event) => {
    state.timeFilter = event.target.value;
    renderBoard();
  });
  instructorChips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    if (button.dataset.id === "all") {
      state.selectedInstructorIds = [];
    } else if (state.selectedInstructorIds.includes(button.dataset.id)) {
      state.selectedInstructorIds = state.selectedInstructorIds.filter((id) => id !== button.dataset.id);
    } else {
      state.selectedInstructorIds = [...state.selectedInstructorIds, button.dataset.id];
    }
    renderBoard();
  });
  board.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slot]");
    const empty = event.target.closest("[data-empty]");
    const blocked = event.target.closest("[data-blocked]");
    if (button) renderDetail(JSON.parse(decodeURIComponent(button.dataset.slot)));
    if (empty) renderEmptyDetail(JSON.parse(decodeURIComponent(empty.dataset.empty)));
    if (blocked) renderBlockedDetail(JSON.parse(decodeURIComponent(blocked.dataset.blocked)));
  });
  details.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-slot-form]");
      if (!form) return;
      event.preventDefault();
      const button = form.querySelector("[data-save-slot]");
      await saveFromButton(button);
  });
  details.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-close-detail]");
    if (closeButton) {
      closeDetail();
      return;
    }
    const saveButton = event.target.closest("[data-save-slot]");
    if (saveButton) {
      event.preventDefault();
      await saveFromButton(saveButton);
      return;
    }
    const button = event.target.closest("[data-delete-slot]");
    if (!button) return;
    try {
      await deleteSlot(button.dataset.deleteSlot);
    } catch (err) {
      showToast(err.message || "삭제 실패");
    }
  });
}

async function saveFromButton(button) {
  const form = button?.closest("[data-slot-form]");
  if (!form || button?.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "저장 중";
  try {
    await saveSlot(form);
  } catch (err) {
    showToast(err.message || "저장 실패");
  } finally {
    button.disabled = false;
    button.textContent = originalText || "저장";
  }
}

function init() {
  bindEvents();
  if (new URLSearchParams(location.search).has("preview")) {
    state.preview = true;
    state.instructors = fallbackInstructors();
    state.availability = buildDefaultAvailability(state.instructors);
    state.usingSample = true;
    setLoginVisible(false);
    renderBoard();
    return;
  }
  if (!config) {
    setLoginVisible(false);
    refresh();
    return;
  }
  state.app = initializeApp(config);
  state.auth = getAuth(state.app);
  state.db = getFirestore(state.app);
  state.functions = getFunctions(state.app, "asia-northeast3");
  onAuthStateChanged(state.auth, async (user) => {
    state.user = user;
    setLoginVisible(!user);
    if (user) await refresh();
    else {
      state.instructors = [];
      state.availability = [];
      state.usingSample = false;
      renderBoard();
    }
  });
}

init();
