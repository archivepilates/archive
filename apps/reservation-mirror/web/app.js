import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { Calendar } from '@fullcalendar/core';
import koLocale from '@fullcalendar/core/locales/ko';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import luxonPlugin from '@fullcalendar/luxon3';
import { DateTime } from 'luxon';
import { createElement, CalendarDays, UsersRound, Ticket, ClipboardList, ContactRound, Package, ChartNoAxesCombined, MessageSquare, Settings, RefreshCw, LogOut, Search, RotateCcw, ChevronLeft, ChevronRight, X } from 'lucide';

const $ = (id) => document.getElementById(id);
const zone = 'Asia/Seoul';
const pageDefinitions = {
  calendar: { title: '수업 일정', entity: 'occurrences', icon: CalendarDays },
  members: { title: '회원', entity: 'members', icon: UsersRound },
  entitlements: { title: '수강권', entity: 'entitlements', icon: Ticket },
  bookings: { title: '예약 내역', entity: 'bookings', icon: ClipboardList },
  staff: { title: '강사', entity: 'staff', icon: ContactRound },
  products: { title: '상품', entity: 'products', icon: Package },
};
const statusLabels = {
  booked: ['예약', 'blue'], booking_confirmed: ['예약 확정', 'green'], booking_waiting: ['예약 대기', 'amber'],
  attendance: ['출석', 'green'], checkIn: ['체크인', 'blue'], absence: ['결석', 'red'], noshow: ['노쇼', 'red'], cancel: ['취소', 'neutral'],
  active: ['사용 중', 'green'], inactive: ['비활성', 'neutral'], expired: ['만료', 'neutral'], holding: ['홀딩', 'amber'],
};
const productTypes = { S: '판매형', RM: '대여형 / 혼합', RP: '대여형 / 기간제', RT: '대여형 / 횟수제', T: '횟수제', P: '기간제' };
const classTypes = { I: '상품', G: '그룹' };
let config;
let auth;
let user = null;
let sessionReady = false;
let sessionBusy = false;
let calendar = null;
let page = 'calendar';
let forbidden = false;
let generation = 0;
let listRequest = 0;
let detailRequest = 0;
let summaryRequest = 0;
let listController;
let summaryController;
let detailController;
let items = [];
let nextCursor = null;
let listSnapshot = null;
let pageCount = 0;
let loading = false;
let summaryBusy = false;
let snapshot = null;
let listError = '';
let summaryError = '';
let applied = { search: '', from: '', to: '', status: 'all' };

function element(tag, value, className) {
  const result = document.createElement(tag);
  if (value !== undefined && value !== null) result.textContent = String(value);
  if (className) result.className = className;
  return result;
}
function display(value) { return value === null || value === undefined || value === '' ? '미확인' : String(value); }
function scalar(value) { return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '미확인'; }
function icon(iconNode) { return createElement(iconNode, { width: 18, height: 18, 'aria-hidden': 'true' }); }
function setIcon(id, iconNode) { $(id).replaceChildren(icon(iconNode)); }
function date(value, format = 'yyyy.MM.dd HH:mm') {
  if (value === null || value === undefined || value === '') return '미확인';
  const parsed = DateTime.fromISO(String(value), { zone }).setZone(zone).setLocale('ko');
  return parsed.isValid ? parsed.toFormat(format) : '미확인';
}
function today() { return DateTime.now().setZone(zone).toISODate(); }
function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone }).isValid; }
function badge(value) {
  const entry = statusLabels[value];
  return element('span', entry ? entry[0] : display(value), `badge ${entry ? entry[1] : 'neutral'}`);
}
function bool(value) { return value === true ? '예' : value === false ? '아니오' : '미확인'; }
function notice() {
  const text = forbidden ? '권한 필요 · 현재 계정으로 조회할 수 없습니다. 관리자에게 계정 권한과 세션 상태를 확인해 주세요.' : [summaryError, listError].filter(Boolean).join(' · ');
  $('notice').textContent = text;
  $('notice').hidden = !text;
}
function errorMessage(error) {
  if (error.status === 401) return '세션이 만료되었습니다. 다시 로그인해 주세요.';
  if (error.status === 403) return '권한 필요';
  if (error.status === 503) return '조회 준비 중입니다. 잠시 후 새로고침해 주세요.';
  return '조회하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.';
}
function isAbort(error) { return error.name === 'AbortError'; }
function abortReads() {
  generation += 1;
  listRequest += 1;
  summaryRequest += 1;
  detailRequest += 1;
  listController?.abort(); summaryController?.abort(); detailController?.abort();
  loading = false;
  summaryBusy = false;
  sessionBusy = false;
}
function clearSensitive() {
  sessionReady = false;
  items = []; nextCursor = null; listSnapshot = null; pageCount = 0; snapshot = null;
  $('list').replaceChildren();
  calendar?.removeAllEvents();
  $('detail-content').replaceChildren();
  $('detail-title').textContent = '상세 조회';
  $('search').value = '';
  applied.search = '';
  if ($('detail-dialog').open) $('detail-dialog').close();
  $('coverage').replaceChildren();
  ['captured-at', 'source-updated-at', 'checked-at', 'rea-version'].forEach((id) => { $(id).textContent = '미확인'; });
  ['rea-applied', 'snapshot-id', 'list-snapshot'].forEach((id) => { $(id).textContent = ''; });
  $('snapshot-state').textContent = '스냅샷 미확인';
  $('snapshot-state').className = 'badge amber';
  $('summary-status').textContent = '원본 상태 미확인';
  $('entity-count').textContent = '원본 건수 미확인';
  $('operator-session').textContent = '';
}
function blockAccess() {
  forbidden = true;
  abortReads();
  clearSensitive();
  $('refresh').disabled = true;
  $('filters').inert = true;
  $('calendar-section').inert = true;
  $('page-indicator').textContent = '권한 필요 · 자동 재시도 중지';
  $('load-more').hidden = true;
  notice();
}
async function expireSession() {
  user = null;
  abortReads();
  clearSensitive();
  $('workspace').hidden = true;
  $('access').hidden = false;
  $('access-status').textContent = '세션이 만료되었습니다. 다시 로그인해 주세요.';
  $('login-form').hidden = false;
  await signOut(auth).catch(() => {});
}
// Only these same-origin GET routes are available to the mirror UI.
async function api(path, params = {}, signal) {
  if (!user || forbidden || !['session', 'summary', 'list', 'member'].includes(path) || (path !== 'session' && !sessionReady)) throw new Error('Access unavailable');
  const actor = user;
  const epoch = generation;
  let token;
  try { token = await actor.getIdToken(); }
  catch (error) {
    if (actor === user && epoch === generation && !signal?.aborted) await expireSession();
    throw error;
  }
  if (actor !== user || epoch !== generation || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  const response = await fetch(`/api/${path}${query.size ? `?${query}` : ''}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
  if (actor !== user || epoch !== generation || signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (response.status === 401) await expireSession();
  if (response.status === 403) blockAccess();
  if (!response.ok) throw Object.assign(new Error('Read failed'), { status: response.status });
  return response.json();
}
async function verifySession() {
  if (!user || forbidden || sessionBusy) return;
  const epoch = generation;
  sessionBusy = true;
  $('refresh').disabled = true;
  $('summary-status').textContent = '운영자 권한 확인 중';
  try {
    const session = await api('session');
    if (epoch !== generation) return;
    if (!['owner', 'manager'].includes(session.role)) { blockAccess(); return; }
    sessionReady = true;
    summaryError = '';
    $('operator-session').textContent = `${display(session.staffName)} · ${session.role === 'owner' ? '대표' : '매니저'}`;
    choosePage(location.hash.slice(1));
    loadSummary();
  } catch (error) {
    if (epoch === generation && !isAbort(error)) {
      summaryError = errorMessage(error);
      $('summary-status').textContent = '권한 확인 미완료';
      notice();
    }
  } finally {
    if (epoch === generation) { sessionBusy = false; $('refresh').disabled = forbidden || summaryBusy; }
  }
}
function renderCoverage(data) {
  const list = element('ul', null, 'coverage-list');
  for (const entry of Array.isArray(data) ? data : []) {
    if (typeof entry === 'string') list.append(element('li', entry));
    else if (entry && typeof entry === 'object') {
      list.append(element('li', Object.entries(entry).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.map(scalar).join(', ') : scalar(value)}`).join(' · ')));
    }
  }
  $('coverage').replaceChildren(list.childElementCount ? list : element('p', '수집 범위 미확인'));
}
function updateEntityCount() {
  const count = snapshot?.counts?.[pageDefinitions[page].entity];
  $('entity-count').textContent = `원본 ${typeof count === 'number' && Number.isFinite(count) ? `${count.toLocaleString('ko-KR')}건` : '건수 미확인'}`;
}
async function loadSummary() {
  if (!user || !sessionReady || forbidden || document.hidden || summaryBusy) return;
  summaryBusy = true;
  const request = ++summaryRequest;
  const epoch = generation;
  summaryController = new AbortController();
  $('refresh').disabled = true;
  try {
    const data = await api('summary', {}, summaryController.signal);
    if (request !== summaryRequest || epoch !== generation) return;
    if (data.mode !== 'read_only_mirror') { blockAccess(); return; }
    snapshot = data.snapshot || null;
    summaryError = '';
    const complete = snapshot?.complete === true;
    $('snapshot-state').textContent = complete ? '수집 범위 완료' : '부분 스냅샷';
    $('snapshot-state').className = `badge ${complete ? 'green' : 'amber'}`;
    $('summary-status').textContent = '스냅샷 기준 · 실시간 아님';
    $('captured-at').textContent = date(snapshot?.capturedAt);
    $('source-updated-at').textContent = date(snapshot?.sourceUpdatedAt);
    $('checked-at').textContent = DateTime.now().setZone(zone).toFormat('MM.dd HH:mm:ss');
    $('snapshot-id').textContent = `스냅샷 ${display(snapshot?.id)}`;
    $('rea-version').textContent = display(data.rea?.version);
    $('rea-applied').textContent = `REA 적용: ${Array.isArray(data.rea?.applied) && data.rea.applied.length ? data.rea.applied.map(scalar).join(' · ') : '미확인'}`;
    renderCoverage(snapshot?.coverage);
    updateEntityCount();
    if (listSnapshot && snapshot?.id && listSnapshot !== snapshot.id) summaryError = '새 스냅샷이 있습니다. 새로고침하면 첫 페이지부터 조회합니다.';
  } catch (error) {
    if (request === summaryRequest && epoch === generation && !isAbort(error)) {
      summaryError = errorMessage(error);
      $('summary-status').textContent = '상태 확인 실패 · 이전 확인 시각 유지';
    }
  } finally {
    if (request === summaryRequest && epoch === generation) { summaryBusy = false; $('refresh').disabled = forbidden; notice(); }
  }
}
function memberLink(id, name) {
  if (id === null || id === undefined || id === '') return element('span', display(name));
  const button = element('button', display(name), 'member-link');
  button.type = 'button';
  button.addEventListener('click', () => openMember(id));
  return button;
}
function withSub(main, sub) {
  const cell = element('div');
  cell.append(main instanceof Node ? main : element('span', display(main)), element('span', sub, 'cell-sub'));
  return cell;
}
function table(headers, rows) {
  if (!rows.length) return element('p', '조회 결과가 없습니다.', 'empty');
  const wrap = element('div', null, 'table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', '조회 결과 표');
  const result = element('table');
  const caption = element('caption', `${pageDefinitions[page].title} 조회 결과`);
  caption.hidden = true;
  const head = element('thead');
  const headRow = element('tr');
  headers.forEach((text) => { const th = element('th', text); th.scope = 'col'; headRow.append(th); });
  head.append(headRow);
  const body = element('tbody');
  rows.forEach((row) => {
    const tr = element('tr');
    row.forEach((value) => { const td = element('td'); td.append(value instanceof Node ? value : document.createTextNode(display(value))); tr.append(td); });
    body.append(tr);
  });
  result.append(caption, head, body); wrap.append(result); return wrap;
}
function passType(item) { return `${productTypes[item.productType] || display(item.productType)} · ${classTypes[item.availableClassType] || display(item.availableClassType)}`; }
function validity(item) { return `${date(item.validFrom, 'yyyy.MM.dd')} ~ ${date(item.validThrough, 'yyyy.MM.dd')}`; }
function entitlementSource(item) {
  const historical = item.identityKind === 'historical_snapshot_not_permanent_ticket_id';
  const label = historical ? `과거 자료 · ${date(item.sourceAsOf, 'yyyy.MM.dd')}` : `원본 기준 · ${date(item.sourceAsOf, 'yyyy.MM.dd')}`;
  return withSub(element('span', label, `badge ${historical ? 'amber' : 'neutral'}`), historical ? '현재 잔여 확인에 사용하지 않음' : item.identityKind === 'native_source_id' ? '원본 번호 연결됨' : '원본 번호 미확인');
}
function renderList() {
  let headers;
  let rows;
  if (page === 'members') {
    headers = ['회원명', '전화번호', '상태'];
    rows = items.map((item) => [memberLink(item.id, item.name), item.phone, badge(item.status)]);
  } else if (page === 'entitlements') {
    headers = ['회원명', '수강권', '원본 구분', '전체', '잔여', '예약 가능', '취소 가능', '유효기간', '상태 / 홀딩', '주 / 월 한도'];
    rows = items.map((item) => [memberLink(item.memberId, item.memberName), withSub(item.title, passType(item)), entitlementSource(item), item.totalUnits, item.remainingUnits, item.bookableUnits, item.cancellableUnits, validity(item), withSub(badge(item.status), `홀딩 ${bool(item.holding)}`), `${display(item.weeklyLimit)} / ${display(item.monthlyLimit)}`]);
  } else if (page === 'bookings') {
    headers = ['회원명', '수업', '일자', '시간', '강사', '예약 상태'];
    rows = bookingRows(items);
  } else if (page === 'staff') {
    headers = ['강사명', '활성 상태'];
    rows = items.map((item) => [item.name, item.active === true ? badge('active') : item.active === false ? badge('inactive') : badge(null)]);
  } else {
    headers = ['상품명', '상품 유형', '수업 구분', '전체', '주 한도', '월 한도'];
    rows = items.map((item) => [item.title, productTypes[item.productType] || display(item.productType), classTypes[item.availableClassType] || display(item.availableClassType), item.totalUnits, item.weeklyLimit, item.monthlyLimit]);
  }
  $('list').replaceChildren(table(headers, rows));
}
function bookingRows(bookings) {
  return bookings.map((item) => [memberLink(item.memberId, item.memberName), item.title, item.localDate || date(item.startAt, 'yyyy.MM.dd'), `${date(item.startAt, 'HH:mm')} ~ ${date(item.endAt, 'HH:mm')}`, item.staffName, badge(item.status)]);
}
function renderCalendar() {
  if (!calendar) return;
  calendar.batchRendering(() => {
    calendar.removeAllEvents();
    for (const item of items) {
      const start = DateTime.fromISO(String(item.startAt || ''), { zone });
      if (!start.isValid) continue;
      const end = DateTime.fromISO(String(item.endAt || ''), { zone });
      calendar.addEvent({ id: String(item.id), title: display(item.title), start: start.toISO(), ...(end.isValid ? { end: end.toISO() } : {}), extendedProps: { item } });
    }
  });
}
function pagination() {
  $('page-indicator').textContent = loading ? `조회 중 · 현재 ${items.length}건` : pageCount ? `${pageCount}페이지 · ${items.length}건 조회${nextCursor ? ' · 다음 페이지 있음' : ' · 마지막 페이지'}${page === 'calendar' && items.some((item) => !DateTime.fromISO(String(item.startAt || ''), { zone }).isValid) ? ' · 날짜 미확인 수업은 캘린더에서 제외' : ''}` : listError ? '조회 실패' : '조회 대기';
  $('load-more').hidden = !nextCursor || forbidden;
  $('load-more').disabled = loading;
  $('list-snapshot').textContent = listSnapshot ? `조회 목록 스냅샷 ${display(listSnapshot)}` : '';
}
async function loadList(append = false) {
  if (!user || !sessionReady || forbidden || (append && (loading || !nextCursor))) return;
  listController?.abort();
  const controller = new AbortController(); listController = controller;
  const request = ++listRequest;
  const epoch = generation;
  if (!append) { items = []; nextCursor = null; listSnapshot = null; pageCount = 0; }
  listError = ''; loading = true;
  if (page === 'calendar') renderCalendar(); else if (!append) $('list').replaceChildren(element('p', '조회 중', 'empty'));
  pagination(); notice();
  try {
    const data = await api('list', { entity: pageDefinitions[page].entity, limit: 50, ...applied, ...(append ? { after: nextCursor } : {}) }, controller.signal);
    if (request !== listRequest || epoch !== generation) return;
    if (!Array.isArray(data.items)) throw new Error('Invalid list');
    if (append && (!data.snapshotId || !listSnapshot || data.snapshotId !== listSnapshot)) {
      nextCursor = null;
      listError = '스냅샷이 변경되어 이어 읽기를 중지했습니다. 새로고침해 주세요.';
      return;
    }
    if (append && data.nextCursor && data.nextCursor === nextCursor) {
      nextCursor = null;
      listError = '페이지 커서가 반복되어 조회를 중지했습니다. 새로고침해 주세요.';
      return;
    }
    items = append ? items.concat(data.items) : data.items;
    nextCursor = data.nextCursor || null;
    listSnapshot = data.snapshotId ?? null;
    pageCount += 1;
    if (snapshot?.id && listSnapshot && snapshot.id !== listSnapshot) summaryError = '요약과 목록의 스냅샷이 다릅니다. 새로고침해 주세요.';
    if (page === 'calendar') renderCalendar(); else renderList();
  } catch (error) {
    if (request === listRequest && epoch === generation && !isAbort(error)) {
      listError = errorMessage(error);
      if (!append && page !== 'calendar') $('list').replaceChildren(element('p', listError, 'empty'));
    }
  } finally {
    if (request === listRequest && epoch === generation) { loading = false; pagination(); notice(); }
  }
}
function calendarRange(info) {
  if (page !== 'calendar') return;
  applied.from = DateTime.fromJSDate(info.start, { zone }).toISODate();
  applied.to = DateTime.fromJSDate(info.end, { zone }).minus({ days: 1 }).toISODate();
  $('from').value = applied.from; $('to').value = applied.to;
  $('calendar-title').textContent = info.view.title;
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === info.view.type)));
  loadList();
}
function ensureCalendar() {
  if (calendar) { calendar.updateSize(); return; }
  calendar = new Calendar($('calendar'), {
    plugins: [dayGridPlugin, timeGridPlugin, luxonPlugin], locale: koLocale, timeZone: zone,
    initialView: window.matchMedia('(min-width: 768px)').matches ? 'timeGridWeek' : 'timeGridDay',
    initialDate: today(), headerToolbar: false, height: 'auto', allDaySlot: false,
    slotMinTime: '00:00:00', slotMaxTime: '24:00:00', slotDuration: '00:30:00',
    editable: false, selectable: false, navLinks: false, nowIndicator: false,
    dayMaxEvents: 4, eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    datesSet: calendarRange,
    eventContent(info) {
      const item = info.event.extendedProps.item;
      const root = element('div');
      root.append(element('div', `${date(item.startAt, 'HH:mm')} ${display(item.title)}`, 'event-title'), element('div', `${display(item.staffName)} · ${display(item.roomName)}`, 'event-meta'), element('div', `예약 ${display(item.occupiedCount)} / 정원 ${display(item.capacity)} · 대기 ${display(item.waitingCount)}`, 'event-meta'));
      return { domNodes: [root] };
    },
    eventDidMount(info) {
      info.el.tabIndex = 0;
      info.el.setAttribute('role', 'button');
      info.el.setAttribute('aria-label', `${info.event.title} ${date(info.event.startStr)} 상세 조회`);
      info.el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOccurrence(info.event.extendedProps.item); } });
    },
    eventClick(info) { info.jsEvent.preventDefault(); openOccurrence(info.event.extendedProps.item); },
  });
  calendar.render();
}
function choosePage(next, focus = false, search = '') {
  if (!pageDefinitions[next]) next = 'calendar';
  page = next;
  applied = { search, from: today(), to: today(), status: 'all' };
  $('search').value = search; $('status').value = 'all'; $('from').value = applied.from; $('to').value = applied.to;
  const schedule = page === 'calendar';
  const dated = schedule || page === 'bookings';
  document.querySelector('.search-field').hidden = !['members', 'entitlements', 'bookings'].includes(page);
  document.querySelectorAll('.date-field').forEach((field) => { field.hidden = !dated; });
  document.querySelector('.status-field').hidden = page !== 'bookings';
  $('from').readOnly = schedule; $('to').readOnly = schedule;
  $('from').required = dated; $('to').required = dated;
  if (!dated) { applied.from = ''; applied.to = ''; }
  $('filters').hidden = !['members', 'entitlements', 'bookings', 'calendar'].includes(page);
  $('calendar-section').hidden = !schedule; $('list-section').hidden = schedule;
  $('page-title').textContent = pageDefinitions[page].title; $('breadcrumb').textContent = pageDefinitions[page].title;
  document.querySelectorAll('[data-page]').forEach((button) => { if (button.dataset.page === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  updateEntityCount();
  if (focus) $('page-title').scrollIntoView({ block: 'nearest' });
  if (!user || !sessionReady || forbidden) return;
  if (schedule) {
    if (!calendar) ensureCalendar();
    else { calendar.updateSize(); calendarRange({ start: calendar.view.activeStart, end: calendar.view.activeEnd, view: calendar.view }); }
  } else loadList();
}
function detailStart(title) {
  detailController?.abort(); detailRequest += 1;
  $('detail-title').textContent = title;
  $('detail-content').replaceChildren(element('p', '조회 중', 'detail-loading'));
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
  $('close-detail').focus();
}
function definitionList(entries) {
  const result = element('dl', null, 'detail-dl');
  entries.forEach(([label, value]) => result.append(element('dt', label), element('dd', display(value))));
  return result;
}
function openOccurrence(item) {
  if (!user || !sessionReady || forbidden) return;
  detailStart(display(item.title));
  $('detail-content').replaceChildren(definitionList([
    ['수업 상태', item.state], ['일자', item.localDate], ['시작', date(item.startAt)], ['종료', date(item.endAt)],
    ['강사', item.staffName], ['강의실', item.roomName], ['정원', item.capacity], ['예약', item.occupiedCount], ['대기', item.waitingCount],
  ]), element('p', `조회 목록 스냅샷 ${display(listSnapshot)}`, 'detail-note'));
}
function entitlementDetail(item) {
  const section = element('section', null, 'detail-pass');
  section.append(element('strong', display(item.title)), entitlementSource(item), element('p', passType(item), 'detail-note'));
  const counts = element('dl', null, 'pass-counts');
  [['전체', item.totalUnits], ['잔여', item.remainingUnits], ['예약 가능', item.bookableUnits], ['취소 가능', item.cancellableUnits]].forEach(([label, value]) => {
    const group = element('div'); group.append(element('dt', label), element('dd', display(value))); counts.append(group);
  });
  section.append(counts, element('p', validity(item), 'detail-note'), badge(item.status), element('p', `홀딩 ${bool(item.holding)} · 주 한도 ${display(item.weeklyLimit)} · 월 한도 ${display(item.monthlyLimit)}`, 'detail-note'));
  return section;
}
async function openMember(id) {
  if (!user || !sessionReady || forbidden) return;
  detailStart('회원 상세');
  const request = detailRequest;
  const epoch = generation;
  detailController = new AbortController();
  try {
    const data = await api('member', { id }, detailController.signal);
    if (request !== detailRequest || epoch !== generation || !$('detail-dialog').open) return;
    const member = data.member || {};
    $('detail-title').textContent = display(member.name);
    const fragment = document.createDocumentFragment();
    fragment.append(definitionList([['회원명', member.name], ['전화번호', member.phone], ['상태', statusLabels[member.status]?.[0] || display(member.status)]]), element('h3', '수강권'));
    const passes = Array.isArray(data.entitlements) ? data.entitlements : [];
    if (passes.length) passes.forEach((pass) => fragment.append(entitlementDetail(pass)));
    else fragment.append(element('p', '조회된 수강권이 없습니다.', 'detail-note'));
    const bookings = Array.isArray(data.bookings?.items) ? data.bookings.items : [];
    fragment.append(element('h3', '예약 내역'), table(['회원명', '수업', '일자', '시간', '강사', '예약 상태'], bookingRows(bookings)));
    fragment.append(element('p', `첫 페이지 · ${bookings.length}건 조회${data.bookings?.nextCursor ? ' · 추가 페이지 있음 · 전체 내역 아님' : ' · 마지막 페이지'}`, 'detail-note'));
    if (data.bookings?.nextCursor) {
      const more = element('button', '예약 목록에서 검색'); more.type = 'button';
      more.addEventListener('click', () => {
        $('detail-dialog').close();
        // This API has no member-id filter; retain the clearly labelled name-prefix query.
        history.replaceState(null, '', '#bookings');
        choosePage('bookings', true, member.name || '');
      });
      fragment.append(element('p', '예약 목록은 별도 조회입니다. 회원명 접두어와 날짜 범위를 적용하며 동명이인 내역이 포함될 수 있습니다.', 'detail-note'), more);
    }
    $('detail-content').replaceChildren(fragment);
  } catch (error) {
    if (request === detailRequest && epoch === generation && !isAbort(error)) $('detail-content').replaceChildren(element('p', errorMessage(error), 'error-text'));
  }
}
function initializeUI() {
  for (const [key, value] of Object.entries(pageDefinitions)) {
    const button = element('button'); button.type = 'button'; button.dataset.page = key;
    button.append(icon(value.icon), element('span', value.title));
    button.addEventListener('click', () => { if (location.hash !== `#${key}`) location.hash = key; else choosePage(key); });
    $('navigation').append(button);
  }
  for (const [title, image] of [['메시지', MessageSquare], ['통계', ChartNoAxesCombined], ['설정', Settings]]) {
    const wrapper = element('span', null, 'unavailable-item'); wrapper.tabIndex = 0;
    const button = element('button'); button.type = 'button'; button.disabled = true;
    const description = `${title}은 조회 미러에서 제공하지 않습니다.`;
    wrapper.title = description; wrapper.setAttribute('aria-label', description);
    const tooltip = element('span', description, 'unavailable-tooltip');
    tooltip.id = `unavailable-${$('unavailable-nav').childElementCount}`;
    tooltip.setAttribute('role', 'tooltip'); wrapper.setAttribute('aria-describedby', tooltip.id);
    button.append(icon(image), element('span', title)); wrapper.append(button, tooltip); $('unavailable-nav').append(wrapper);
  }
  [['refresh', RefreshCw], ['logout', LogOut], ['search-icon', Search], ['filter-reset', RotateCcw], ['calendar-prev', ChevronLeft], ['calendar-next', ChevronRight], ['close-detail', X]].forEach(([id, image]) => setIcon(id, image));
  $('logout').addEventListener('click', async () => { await expireSession(); $('access-status').textContent = '로그아웃되었습니다.'; });
  $('refresh').addEventListener('click', async () => { if (forbidden) return; if (!sessionReady) { await verifySession(); return; } if (!readFilters()) return; await loadSummary(); if (user && !forbidden && readFilters()) loadList(); });
  $('load-more').addEventListener('click', () => loadList(true));
  $('filters').addEventListener('submit', (event) => {
    event.preventDefault();
    if (readFilters()) loadList();
  });
  $('filter-reset').addEventListener('click', () => choosePage(page));
  // Editing a filter invalidates the opaque cursor before the next explicit query.
  ['search', 'from', 'to', 'status'].forEach((id) => $(id).addEventListener('input', () => {
    listController?.abort(); listRequest += 1; loading = false; nextCursor = null;
    pagination(); $('page-indicator').textContent = '조건 변경 · 조회를 눌러 새로 확인';
  }));
  $('calendar-prev').addEventListener('click', () => calendar?.prev());
  $('calendar-next').addEventListener('click', () => calendar?.next());
  $('calendar-today').addEventListener('click', () => calendar?.today());
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => calendar?.changeView(button.dataset.view)));
  $('close-detail').addEventListener('click', () => $('detail-dialog').close());
  $('detail-dialog').addEventListener('close', () => { detailController?.abort(); detailRequest += 1; $('detail-content').replaceChildren(); });
  window.addEventListener('hashchange', () => choosePage(location.hash.slice(1), true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !forbidden) loadSummary(); });
  window.setInterval(() => { if (!document.hidden && user && !forbidden) loadSummary(); }, 60_000);
}
function readFilters() {
  if (['bookings', 'calendar'].includes(page) && (!validDay($('from').value) || !validDay($('to').value) || $('from').value > $('to').value)) {
    listError = '시작일과 종료일을 확인해 주세요.'; notice(); return false;
  }
  applied.search = ['members', 'entitlements', 'bookings'].includes(page) ? $('search').value.trim() : '';
  applied.status = page === 'bookings' ? $('status').value : 'all';
  if (['bookings', 'calendar'].includes(page)) { applied.from = $('from').value; applied.to = $('to').value; }
  return true;
}
async function bootstrap() {
  $('config-retry').hidden = true; $('login-form').hidden = true;
  $('access-status').textContent = '설정을 확인하고 있습니다.';
  try {
    const response = await fetch('/api/config', { method: 'GET', cache: 'no-store' });
    if (response.status === 503) throw Object.assign(new Error('Setup'), { setup: true });
    if (!response.ok) throw new Error('Configuration unavailable');
    config = await response.json();
    if (config.mode !== 'read_only_mirror' || !config.firebase?.apiKey || !config.firebase?.authDomain || !config.firebase?.projectId || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(config.loginEmailDomain || '')) throw new Error('Invalid configuration');
    if (config.loginEmailPrefix !== undefined && !/^[a-zA-Z0-9._-]*$/.test(config.loginEmailPrefix)) throw new Error('Invalid prefix');
    auth = getAuth(initializeApp(config.firebase));
    await setPersistence(auth, browserSessionPersistence);
    $('access-status').textContent = '운영자 계정으로 로그인해 주세요.';
    $('login-form').hidden = false;
    onAuthStateChanged(auth, (actor) => {
      abortReads(); clearSensitive(); user = actor; forbidden = false;
      summaryError = ''; listError = ''; notice();
      $('refresh').disabled = false; $('filters').inert = false; $('calendar-section').inert = false;
      $('workspace').hidden = !actor; $('access').hidden = Boolean(actor);
      if (actor) { $('password').value = ''; verifySession(); }
    });
  } catch (error) {
    $('access-status').textContent = error.setup ? '설정 준비 중 · 운영자 인증 설정이 아직 완료되지 않았습니다.' : '설정을 불러오지 못했습니다. 관리자에게 연결 상태를 확인해 주세요.';
    $('config-retry').hidden = false;
  }
}
initializeUI();
$('config-retry').addEventListener('click', bootstrap);
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const digits = $('phone').value.replace(/\D/g, '');
  $('login-error').hidden = true;
  if (!/^\d{8,15}$/.test(digits)) { $('login-error').textContent = '전화번호를 확인해 주세요.'; $('login-error').hidden = false; return; }
  $('login-button').disabled = true;
  $('login-button').textContent = '로그인 중';
  try {
    await signInWithEmailAndPassword(auth, `${config.loginEmailPrefix ?? 'p'}${digits}@${config.loginEmailDomain}`, $('password').value);
  } catch (error) {
    $('login-error').textContent = error.code === 'auth/too-many-requests' ? '요청이 많아 로그인이 일시 제한되었습니다. 잠시 후 다시 시도해 주세요.' : error.code === 'auth/network-request-failed' ? '네트워크 연결을 확인해 주세요.' : '전화번호와 비밀번호 또는 계정 상태를 확인해 주세요.';
    $('login-error').hidden = false;
  } finally { $('password').value = ''; $('login-button').disabled = false; $('login-button').textContent = '로그인'; }
});
bootstrap();
