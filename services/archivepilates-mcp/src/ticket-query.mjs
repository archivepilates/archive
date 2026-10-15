import { millis, iso, phone, maskedPhone, requireValue } from './errors.mjs';
import { clean } from './live-dom.mjs';

const DAY = 86400000;
const kstDay = value => { const time = millis(value); return time ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : null; };
const inactive = value => value.mergedInto || value.canonicalMemberId || value.memberMerge?.canonicalMemberId
  || ['merged', 'deleted'].includes(value.status);
const usable = new Set(['사용중', '이용중', '사용예정', '이용예정', '정상', 'active', 'using', 'scheduled']);
function usableStatus(value) {
  const status = clean(value).replace(/\s+/g, '').replace(/\([\d,]+일남음\)$/, '');
  return usable.has(status);
}
function classify(ticket) {
  const label = clean(ticket.classType);
  if (/강사/.test(label) || /강사레슨/.test(clean(ticket.name))) return 'instructor';
  if (/그룹|group/i.test(label)) return 'group';
  if (/개인|프라이빗|private/i.test(label)) return 'private';
  return 'unknown';
}

export function selectExpiring(profiles, { now, daysRemainingMax, classType = 'all', verifiedLinks = [] }) {
  requireValue(Array.isArray(profiles) && profiles.length <= 2000, 'SOURCE_LIMIT', '전체 동기화 원장 조회 한도를 넘었습니다. 일부를 전체 목록으로 표시하지 않았습니다.');
  const startDate = kstDay(now), endDate = new Date(Date.parse(startDate) + daysRemainingMax * DAY).toISOString().slice(0, 10);
  const counts = { scannedProfiles: profiles.length, excludedInactiveProfiles: 0, invalidProfiles: 0,
    ambiguousProfiles: 0, invalidTickets: 0, excludedTicketStatus: 0, excludedEmptyTickets: 0,
    unknownClassType: 0, duplicateTickets: 0, excludedVerifiedAliases: 0 };
  const byId = new Map(profiles.map(p => [p._id, p])), provenAliases = new Set();
  for (const { aliasId, nativeId } of verifiedLinks) {
    const alias = byId.get(aliasId), native = byId.get(nativeId);
    if (alias && native && /^excel_/.test(aliasId) && /^[1-9]\d*$/.test(nativeId)
      && alias.studioId === '5330' && native.studioId === '5330' && alias.memberId === aliasId && native.memberId === nativeId
      && clean(alias.name) === clean(native.name) && phone(alias.phone) === phone(native.phone)
      && !inactive(alias) && !inactive(native) && Array.isArray(native.activeTickets)
      && (native.activeTickets.length > 0 || !alias.activeTickets?.length)) provenAliases.add(aliasId);
  }
  const groups = new Map(), ambiguousMembers = [];
  for (const profile of profiles) {
    if (inactive(profile)) { counts.excludedInactiveProfiles++; continue; }
    if (provenAliases.has(profile._id)) { counts.excludedVerifiedAliases++; continue; }
    if (profile.studioId !== '5330' || profile._id !== profile.memberId || !clean(profile.name)
      || !/^01[016789]\d{7,8}$/.test(phone(profile.phone))) { counts.invalidProfiles++; continue; }
    const key = phone(profile.phone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(profile);
  }
  const members = [];
  for (const group of groups.values()) {
    if (group.length !== 1) {
      counts.ambiguousProfiles += group.length;
      ambiguousMembers.push({ names: [...new Set(group.map(p => clean(p.name)))].sort(), maskedPhone: maskedPhone(group[0].phone), recordIds: group.map(p => p._id).sort() });
      continue;
    }
    const profile = group[0], tickets = [], seen = new Set();
    if (!Array.isArray(profile.activeTickets) || profile.activeTickets.length > 100) { counts.invalidProfiles++; continue; }
    for (const ticket of profile.activeTickets) {
      if (!ticket || !clean(ticket.name)) { counts.invalidTickets++; continue; }
      if (!usableStatus(ticket.status)) { counts.excludedTicketStatus++; continue; }
      if (ticket.remainingCount !== null && ticket.remainingCount !== undefined
        && (!Number.isSafeInteger(ticket.remainingCount) || ticket.remainingCount < 0)) { counts.invalidTickets++; continue; }
      if (ticket.remainingCount === 0) { counts.excludedEmptyTickets++; continue; }
      const expiresOn = kstDay(ticket.expiresAt), startsOn = kstDay(ticket.availableFrom);
      if (!expiresOn || !startsOn || startsOn > expiresOn) { counts.invalidTickets++; continue; }
      if (expiresOn < startDate || expiresOn > endDate) continue;
      const type = classify(ticket);
      if (type === 'unknown') counts.unknownClassType++;
      if (classType !== 'all' && type !== classType) continue;
      const item = { userTicketId: ticket.userTicketId || null, name: clean(ticket.name),
        status: clean(ticket.status), classType: type, availableFromDate: startsOn, expiresOn,
        daysRemaining: Math.round((Date.parse(expiresOn) - Date.parse(startDate)) / DAY),
        remainingCount: ticket.remainingCount ?? null };
      const key = JSON.stringify(item);
      if (seen.has(key)) { counts.duplicateTickets++; continue; }
      seen.add(key); tickets.push(item);
    }
    if (tickets.length) members.push({ memberId: profile.memberId, name: clean(profile.name), maskedPhone: maskedPhone(profile.phone),
      profileTimestamp: iso(profile.syncedAt || profile.sourceObservedAt || profile.sourceUpdatedAt), ticketFreshness: 'unknown',
      nativeMemberId: /^[1-9]\d*$/.test(profile.memberId) ? profile.memberId : null,
      tickets: tickets.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name)) });
  }
  requireValue(members.length <= 200, 'SOURCE_LIMIT', '조건에 맞는 회원이 200명을 넘었습니다. 기간이나 수업 유형을 좁혀 주세요.');
  members.sort((a, b) => a.tickets[0].expiresOn.localeCompare(b.tickets[0].expiresOn) || a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
  return { members, memberCount: members.length, ticketRowCount: members.reduce((sum, p) => sum + p.tickets.length, 0),
    range: { startDate, endDate, daysRemainingMax, inclusive: true, timeZone: 'Asia/Seoul', classType },
    coverage: { kind: 'stored_profiles_only', liveRosterComplete: false, ...counts }, ambiguousMembers,
    liveReadback: false, allowedForExternalActions: false,
    note: '동기화 원장의 조건별 조회입니다. 전체 StudioMate 최신 명단·정지권·삭제 이력의 완전성을 보장하지 않습니다. 오늘 만료는 0일, 만료된 권과 잔여 0회권은 제외하고 사용예정권은 상태를 표시합니다. profileTimestamp는 수강권 최신 확인시각이 아니며 ticketRowCount는 저장된 표시 행 수이지 실제 구매 건수가 아닙니다. 중복 식별자는 별도 확인하며 예약·환불·발송 직전 원본 확인이 필요합니다.' };
}
