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
const instructorSelect = document.getElementById("instructorSelect");
const instructorChips = document.getElementById("instructorChips");
const timeFilter = document.getElementById("timeFilter");
const operatorBtn = document.getElementById("operatorBtn");
const sourceText = document.getElementById("sourceText");
const details = document.getElementById("details");
const toast = document.getElementById("toast");

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const TIME_ROWS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
const SAMPLE_NAMES = ["김아름", "이서윤", "박지민", "최민정", "정하늘"];
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
  selectedInstructor: "all",
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
  return SAMPLE_NAMES.map((name, index) => ({
    staffId: `sample-${index + 1}`,
    name,
    role: "instructor",
    active: true,
    color: ["#6d7d58", "#426b8f", "#9b5148", "#a8742a", "#6f5f91"][index],
    sample: true,
  }));
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
    color: data.color || data.themeColor || data.backgroundColor || "",
  };
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
  return {
    slotId: String(data.slotId || doc.id),
    staffId: String(data.staffId || ""),
    staffName: String(data.staffName || ""),
    date: String(data.date || ""),
    time: String(data.startTime || ""),
    endTime: String(data.endTime || nextHour(data.startTime || "")),
    status: String(data.status || "available"),
    source: sourceLabel(data.source),
    sourceKey: String(data.source || "manual"),
    memo: String(data.memo || ""),
    checkedAt: data.checkedAt?.toDate ? formatDateTime(data.checkedAt.toDate()) : "수동 확인",
  };
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
  const [staffSnap, lectureSnap, otherSnap, availabilitySnap] = await Promise.all([
    readQuerySafely(query(collection(state.db, "staffs"), where("active", "==", true), limit(80))),
    readQuerySafely(query(collection(state.db, "lectures"), where("date", ">=", start), where("date", "<=", end), orderBy("date"), limit(500))),
    readQuerySafely(query(collection(state.db, "otherSchedules"), where("date", ">=", start), where("date", "<=", end), orderBy("date"), limit(500))),
    readQuerySafely(query(collection(state.db, "privateAvailabilitySlots"), where("date", ">=", start), where("date", "<=", end), orderBy("date"), limit(800))),
  ]);

  const staffRows = staffSnap ? staffSnap.docs.map(normalizeStaff).filter((s) => s.active && s.role !== "viewer") : [];
  state.instructors = staffRows;
  state.lectures = lectureSnap ? lectureSnap.docs.map((doc) => normalizeBusy(doc, "lecture")).filter((row) => row.status !== "deleted") : [];
  state.otherSchedules = otherSnap ? otherSnap.docs.map((doc) => normalizeBusy(doc, "other")).filter((row) => row.status !== "deleted") : [];
  state.availability = availabilitySnap ? availabilitySnap.docs.map(normalizeAvailability).filter((row) => row.staffId && row.date && row.time) : [];
  state.usingSample = false;
}

function getFilteredInstructors() {
  const all = state.instructors;
  if (state.selectedInstructor === "all") return all;
  return all.filter((item) => item.staffId === state.selectedInstructor);
}

function isTimeVisible(time) {
  const hour = Number(time.slice(0, 2));
  if (state.timeFilter === "morning") return hour < 12;
  if (state.timeFilter === "afternoon") return hour >= 12 && hour < 18;
  if (state.timeFilter === "evening") return hour >= 18;
  return true;
}

function busyFor(instructor, date, time) {
  const allBusy = [...state.lectures, ...state.otherSchedules];
  return allBusy.filter((item) => {
    if (item.date !== date || !overlaps(time, item.start, item.end)) return false;
    const byId = item.staffIds.includes(instructor.staffId);
    const byName = item.staffNames.includes(instructor.name);
    return byId || byName;
  });
}

function slotFor(instructor, date, time) {
  const busy = busyFor(instructor, date, time);
  const available = state.availability.find(
    (item) => item.staffId === instructor.staffId && item.date === date && item.time === time,
  );
  if (busy.length) {
    return {
      type: "busy",
      instructor,
      date,
      time,
      reason: busy.map((item) => (item.kind === "lecture" ? `ARCHIVE PILATES 수업 · ${item.title}` : `외부/기타 일정 · ${item.title}`)).join(" / "),
    };
  }
  if (!available) return null;
  return {
    type: ["confirm", "request", "unavailable"].includes(available.status) ? available.status : "available",
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
  return `
    <button class="slot ${type}" type="button" data-slot='${encodeURIComponent(JSON.stringify(slot))}'>
      <span class="slot-name">${slot.instructor.name}</span>
      <span class="slot-time">${slot.time}</span>
      <span class="slot-meta">${meta}</span>
    </button>
  `;
}

function renderHeaderControls() {
  const dates = weekDates();
  document.getElementById("weekLabel").textContent = `${ymd(dates[0]).slice(5).replace("-", ".")} - ${ymd(dates[6]).slice(5).replace("-", ".")}`;
  instructorSelect.innerHTML = [
    `<option value="all">전체 강사</option>`,
    ...state.instructors.map((item) => `<option value="${item.staffId}">${item.name}</option>`),
  ].join("");
  instructorSelect.value = state.selectedInstructor;
  instructorChips.innerHTML = [
    `<button class="chip ${state.selectedInstructor === "all" ? "on" : ""}" data-id="all" type="button">전체</button>`,
    ...state.instructors.map((item) => `<button class="chip ${state.selectedInstructor === item.staffId ? "on" : ""}" data-id="${item.staffId}" type="button">${item.name}</button>`),
  ].join("");
  operatorBtn.classList.toggle("on", state.operatorMode);
  sourceText.textContent = state.usingSample
    ? "라이브 데이터가 부족한 항목은 기본 가능 시간으로 표시 중입니다. StudioMate 점유 시간은 불러온 범위만 반영됩니다."
    : "강사명단, 프라이빗 가능 슬롯, StudioMate 수업, 기타 일정을 읽어 제안 가능한 시간만 표시합니다.";
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
      board.insertAdjacentHTML("beforeend", `
        <div class="slot-cell">
          ${visibleSlots.length ? `<div class="slot-stack">${visibleSlots.map(slotHtml).join("")}</div>` : emptyCellHtml(dateKey, time)}
        </div>
      `);
    });
  });
  renderStats(allSlots);
}

function emptyCellHtml(date, time) {
  if (state.selectedInstructor === "all") return `<div class="empty-slot"></div>`;
  return `<button class="empty-slot" type="button" data-empty='${encodeURIComponent(JSON.stringify({ date, time, staffId: state.selectedInstructor }))}'>등록</button>`;
}

function renderDetail(slot) {
  const label = slot.type === "busy" ? "불가 사유" : slot.type === "confirm" ? "확인 필요 슬롯" : "제안 가능 슬롯";
  const body = slot.type === "busy" ? slot.reason : `${slot.source} · ${slot.checkedAt}`;
  details.innerHTML = `
    <div class="detail">
      <b>${label}</b>
      ${slot.date} ${slot.time} · ${slot.instructor.name}<br>${body}
    </div>
    <div class="detail">
      <b>운영 액션</b>
      ${slot.type === "busy" ? "운영자 모드에서만 확인하는 차단 사유입니다." : "회원에게 후보로 제안하거나 강사에게 최종 확인 후 StudioMate에 등록하세요."}
    </div>
    ${slot.type === "busy" ? "" : slotForm(slot)}
  `;
}

function renderEmptyDetail(cell) {
  const instructor = state.instructors.find((item) => item.staffId === cell.staffId);
  if (!instructor) return;
  details.innerHTML = `
    <div class="detail">
      <b>새 가능 슬롯 등록</b>
      ${cell.date} ${cell.time} · ${instructor.name}
    </div>
    ${slotForm({
      instructor,
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
  return `
    <form class="detail slot-form" data-slot-form>
      <input type="hidden" name="slotId" value="${slot.slotId || ""}">
      <input type="hidden" name="staffId" value="${slot.instructor.staffId}">
      <input type="hidden" name="date" value="${slot.date}">
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
        <label>출처
          <select name="source">
            <option value="manual" ${slot.sourceKey === "manual" ? "selected" : ""}>수동 입력</option>
            <option value="monthly_alimtalk" ${slot.sourceKey === "monthly_alimtalk" ? "selected" : ""}>월간 알림톡</option>
            <option value="weekly_check" ${slot.sourceKey === "weekly_check" ? "selected" : ""}>주간 확인</option>
            <option value="import" ${slot.sourceKey === "import" ? "selected" : ""}>가져오기</option>
          </select>
        </label>
      </div>
      <label>메모
        <textarea name="memo" placeholder="예: 6월 월간 확인, 화목 저녁만 가능">${slot.memo || ""}</textarea>
      </label>
      <div class="form-actions">
        <button class="solid-btn" type="submit">${isExisting ? "수정 저장" : "가능 슬롯 등록"}</button>
        ${isExisting ? `<button class="danger-btn" type="button" data-delete-slot="${slot.slotId}">삭제</button>` : ""}
      </div>
    </form>
  `;
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
  const data = Object.fromEntries(new FormData(form).entries());
  if (state.preview) {
    const instructor = state.instructors.find((item) => item.staffId === data.staffId);
    const slotId = data.slotId || `preview_${data.staffId}_${data.date}_${data.startTime.replace(":", "")}`;
    const existingIndex = state.availability.findIndex((item) => item.slotId === slotId);
    const row = {
      slotId,
      staffId: data.staffId,
      staffName: instructor?.name || "",
      date: data.date,
      time: data.startTime,
      endTime: data.endTime,
      status: data.status,
      source: sourceLabel(data.source),
      sourceKey: data.source,
      memo: data.memo,
      checkedAt: "방금 수정",
    };
    if (existingIndex >= 0) state.availability[existingIndex] = row;
    else state.availability.push(row);
    renderBoard();
    showToast("미리보기 슬롯을 저장했습니다");
    return;
  }
  const save = httpsCallable(state.functions, "adminSavePrivateAvailabilitySlot");
  await save({
    staffId: data.staffId,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status: data.status,
    source: data.source,
    memo: data.memo,
  });
  await refresh();
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
  document.getElementById("signOutBtn").addEventListener("click", () => signOut(state.auth));
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
    renderBoard();
  });
  instructorSelect.addEventListener("change", (event) => {
    state.selectedInstructor = event.target.value;
    renderBoard();
  });
  timeFilter.addEventListener("change", (event) => {
    state.timeFilter = event.target.value;
    renderBoard();
  });
  instructorChips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    state.selectedInstructor = button.dataset.id;
    renderBoard();
  });
  board.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slot]");
    const empty = event.target.closest("[data-empty]");
    if (button) renderDetail(JSON.parse(decodeURIComponent(button.dataset.slot)));
    if (empty) renderEmptyDetail(JSON.parse(decodeURIComponent(empty.dataset.empty)));
  });
  details.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-slot-form]");
    if (!form) return;
    event.preventDefault();
    try {
      await saveSlot(form);
    } catch (err) {
      showToast(err.message || "저장 실패");
    }
  });
  details.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-slot]");
    if (!button) return;
    try {
      await deleteSlot(button.dataset.deleteSlot);
    } catch (err) {
      showToast(err.message || "삭제 실패");
    }
  });
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
