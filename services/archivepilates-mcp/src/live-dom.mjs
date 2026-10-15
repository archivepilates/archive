import { requireValue, phone } from './errors.mjs';

export const STUDIO_ORIGIN = 'https://arcpilates.studiomate.kr';
export const clean = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const nativeId = value => /^[1-9]\d{0,15}$/.test(String(value));

export function assertMemberUrl(url, memberId) {
  const parsed = new URL(url);
  requireValue(parsed.origin === STUDIO_ORIGIN && parsed.pathname === '/users/detail'
    && parsed.searchParams.get('id') === memberId && nativeId(memberId),
  'LIVE_IDENTITY_MISMATCH', 'StudioMate 센터·회원 상세 주소가 일치하지 않습니다.');
}

// These extractors read visible HTML only, never application state or response bodies.
export function extractSearchDom() {
  const visible = e => e && e.getClientRects().length > 0;
  const bars = [...document.querySelectorAll('.search-bar')].filter(visible);
  if (bars.length !== 1) return { ready: false };
  const bar = bars[0];
  const empty = [...bar.querySelectorAll('.no-member')].filter(visible);
  return { ready: true, query: bar.querySelector('input')?.value,
    emptyQuery: empty.length === 1 ? empty[0].querySelector('h3')?.textContent.trim().replace(/^"|"$/g, '') : null,
    incomplete: [...bar.querySelectorAll('.el-pagination, .el-loading-mask')].some(visible),
    rows: [...bar.querySelectorAll('.members .member')].filter(visible).map(e => ({
      name: e.querySelector('.name')?.textContent, phone: e.querySelector('.mobile')?.textContent })) };
}

export function validateSearch(raw, query, isPhone) {
  requireValue(raw?.ready && clean(raw.query) === clean(query) && !raw.incomplete
    && Array.isArray(raw.rows) && raw.rows.length < 10,
  'LIVE_INCOMPLETE', '검색 화면이 미완료이거나 결과 범위를 확인할 수 없습니다. 전체 전화번호로 다시 조회하세요.');
  if (!raw.rows.length) requireValue(clean(raw.emptyQuery) === clean(query),
    'LIVE_INCOMPLETE', '검색 결과 없음 표시를 확인하지 못했습니다. 빈 결과로 처리하지 않았습니다.');
  const rows = raw.rows.map(row => ({ name: clean(row.name), phone: phone(row.phone) }));
  requireValue(rows.every((row, i) => row.name && /^01[016789]\d{7,8}$/.test(row.phone)
    && !/[*•]/.test(String(raw.rows[i].phone))),
  'LIVE_IDENTITY_MISMATCH', '검색 화면의 전체 이름·전화번호를 검증하지 못했습니다.');
  const exact = rows.filter(row => isPhone ? row.phone === phone(query) : row.name === clean(query));
  requireValue(new Set(exact.map(row => JSON.stringify(row))).size === exact.length,
    'LIVE_AMBIGUOUS', '이름과 전화번호가 같은 회원이 여러 명입니다. 원본 확인이 필요합니다.');
  return exact;
}

export function extractOverviewDom() {
  const visible = e => e && e.getClientRects().length > 0;
  const headers = [...document.querySelectorAll('.member-detail__header')].filter(visible);
  const sections = [...document.querySelectorAll('.member-basic__user-tickets')].filter(visible);
  const section = sections.find(e => e.querySelector('.userticket-card__extra__add-new'));
  if (headers.length !== 1 || !section) return { ready: false };
  const header = headers[0];
  const text = (e, selector) => e.querySelector(selector)?.textContent?.trim() || '';
  const cards = [...section.querySelectorAll('.userticket-card')].filter(visible);
  return { ready: true, name: text(header, '.member-detail__header__name h3'),
    phone: text(header, '.member-detail__header__mobile span'),
    memberGrade: text(header, '.member-detail__header__user-grade span'),
    incomplete: [...section.querySelectorAll('.el-pagination, .el-loading-mask')].some(visible),
    addCards: cards.filter(e => e.querySelector('.userticket-card__extra__add-new')).length,
    tickets: cards.filter(e => !e.querySelector('.userticket-card__extra__add-new')).map(e => ({
      name: text(e, 'h3'), status: text(e, '.userticket-card__indicator__tag.contained'),
      type: text(e, '.userticket-card__body__details'),
      counts: [...e.querySelectorAll('.userticket-card__footer__counts > span')].map(s => ({
        label: s.children[0]?.textContent, value: s.children[1]?.textContent })),
      period: text(e, '.userticket-card__footer__period'),
      payment: text(e, '.userticket-card__extra__price__total') })) };
}

function day(value) {
  const match = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(value.trim());
  requireValue(match, 'LIVE_LAYOUT_CHANGED', '수강권의 이용 날짜 형식을 확인해야 합니다.');
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  requireValue(Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
  'LIVE_LAYOUT_CHANGED', '수강권의 이용 날짜가 올바르지 않습니다.');
  return date;
}

export function validateOverview(raw, expected) {
  requireValue(raw?.ready && !raw.incomplete && raw.addCards === 1
    && Array.isArray(raw.tickets) && raw.tickets.length <= 100,
  'LIVE_INCOMPLETE', '수강권 화면의 현재 보유 목록 전체를 확인하지 못했습니다.');
  requireValue(clean(raw.name) === clean(expected.name) && phone(raw.phone) === phone(expected.phone)
    && /^01[016789]\d{7,8}$/.test(phone(raw.phone)) && !/[*•]/.test(raw.phone)
    && clean(raw.memberGrade), 'LIVE_IDENTITY_MISMATCH', '회원 상세의 이름·전체 전화번호·등급이 검색 결과와 다릅니다.');
  const tickets = raw.tickets.map(row => {
    const name = clean(row.name), status = clean(row.status), type = clean(row.type);
    requireValue(name && status && type && Array.isArray(row.counts),
      'LIVE_LAYOUT_CHANGED', '수강권 이름·상태·유형 표시를 확인해야 합니다.');
    const periods = /^(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)\s*~\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)\s*(?:\([^)]*\))?$/.exec(clean(row.period));
    requireValue(periods, 'LIVE_LAYOUT_CHANGED', '수강권 이용기간을 정확히 읽지 못했습니다.');
    const availableFromDate = day(periods[1]), expiresOn = day(periods[2]);
    requireValue(availableFromDate <= expiresOn, 'LIVE_LAYOUT_CHANGED', '수강권 시작·종료일이 올바르지 않습니다.');
    const count = label => {
      const matches = row.counts.filter(value => clean(value.label) === label);
      requireValue(matches.length <= 1, 'LIVE_LAYOUT_CHANGED', '수강권 횟수 표시가 중복됩니다.');
      if (!matches.length) return null;
      const value = clean(matches[0].value);
      requireValue(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:회)?$/.test(value), 'LIVE_LAYOUT_CHANGED', '수강권 횟수를 정확히 읽지 못했습니다.');
      const number = Number(value.replace(/[,회]/g, ''));
      requireValue(Number.isSafeInteger(number), 'LIVE_LAYOUT_CHANGED', '수강권 횟수 범위를 확인해야 합니다.');
      return number;
    };
    const remainingCount = count('잔여'), reservableCount = count('예약가능');
    requireValue(!type.includes('횟수제') || remainingCount !== null,
      'LIVE_LAYOUT_CHANGED', '횟수권의 잔여횟수를 확인하지 못했습니다.');
    const payment = /^결제\s*금액\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s*원$/.exec(clean(row.payment));
    requireValue(!clean(row.payment) || payment, 'LIVE_LAYOUT_CHANGED', '결제 금액 표시 형식을 확인해야 합니다.');
    const paymentAmount = payment ? Number(payment[1].replaceAll(',', '')) : null;
    requireValue(paymentAmount === null || Number.isSafeInteger(paymentAmount), 'LIVE_LAYOUT_CHANGED', '결제 표시 범위를 확인해야 합니다.');
    return { userTicketId: null, name, status, type, remainingCount, reservableCount,
      availableFromDate, expiresOn, availableFrom: new Date(`${availableFromDate}T00:00:00+09:00`).toISOString(),
      expiresAt: new Date(`${expiresOn}T00:00:00+09:00`).toISOString(), paymentAmount };
  });
  requireValue(new Set(tickets.map(row => JSON.stringify(row))).size === tickets.length,
    'LIVE_AMBIGUOUS', '같은 표시의 수강권이 여러 개라 전체 목록을 확정하지 않았습니다.');
  return { name: clean(raw.name), phone: phone(raw.phone), memberGrade: clean(raw.memberGrade), tickets };
}
