import { dedupeSettlementSourceRows } from './monthly-settlement-source.mjs';

const clean = value => String(value ?? '').trim().normalize('NFC');
const count = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const weight = attendance => attendance === '출석' ? 1 : attendance === '노쇼' ? 0.5 : 0;
const fail = () => { throw new Error('SETTLEMENT_CLASS_COUNTS_SOURCE_REVIEW_REQUIRED'); };

// Display counts only: the existing payroll rows and monetary calculations stay unchanged.
export function buildSettlementClassCounts(sourceRows, month) {
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(sourceRows) || !sourceRows.length) fail();
  const grouped = new Map(), identityBuckets = new Map();
  for (const row of sourceRows) {
    const identity = clean(row.classId);
    if (!identityBuckets.has(identity)) identityBuckets.set(identity, []);
    identityBuckets.get(identity).push(row);
  }
  const uniqueRows = [...identityBuckets.values()].flatMap(rows => dedupeSettlementSourceRows(rows).rows);
  for (const raw of uniqueRows) {
    const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? clean(v) : v]));
    const name = clean(row.instructorName);
    if (!name || !['그룹', '프라이빗', '강사레슨'].includes(row.finalType)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.classDate) || row.classDate.replaceAll('-', '').slice(0, 6) !== month
      || !/^\d{2}:\d{2}$/.test(row.classTime) || !/^\d{2}:\d{2}$/.test(row.endTime)
      || !['출석', '결석', '노쇼'].includes(row.attendance)) fail();
    if (!grouped.has(name)) grouped.set(name, new Map());
    const key = clean(row.classId) || JSON.stringify([row.classDate, row.classTime, name]);
    const sessions = grouped.get(name);
    if (!sessions.has(key)) sessions.set(key, { type: row.finalType, date: row.classDate, start: row.classTime, end: row.endTime, rows: [] });
    const session = sessions.get(key);
    if (session.type !== row.finalType || session.date !== row.classDate || session.start !== row.classTime || session.end !== row.endTime) fail();
    session.rows.push(row);
  }
  const result = new Map();
  for (const [name, sessions] of grouped) {
    const counts = { groupSessions: 0, lessonSessions: 0, soloSessions: 0, duetSessions: 0,
      tripleSessions: 0, privateSessions: 0, privateSettlementUnits: 0 };
    for (const session of sessions.values()) {
      if (session.type === '그룹') { counts.groupSessions++; continue; }
      const eligible = session.rows.filter(row => weight(row.attendance) > 0);
      if (!eligible.length) continue;
      if (session.type === '강사레슨') { counts.lessonSessions++; continue; }
      const kinds = new Set(session.rows.map(row => /듀엣/.test(row.ticketName) ? 'duet'
        : /트리플/.test(row.ticketName) ? 'triple'
          : /프라이빗|개인|1\s*:\s*1|스타터.*OT/i.test(row.ticketName) ? 'solo' : 'unknown'));
      if (kinds.size !== 1 || kinds.has('unknown') || session.rows.some(row => !clean(row.memberName) || !clean(row.ticketName))) fail();
      const kind = [...kinds][0], members = new Set(session.rows.map(row => row.memberName));
      if (members.size !== session.rows.length || members.size > { solo: 1, duet: 2, triple: 3 }[kind]) fail();
      counts[`${kind}Sessions`]++;
      counts.privateSessions++;
      counts.privateSettlementUnits += eligible.reduce((sum, row) => sum + weight(row.attendance), 0);
    }
    counts.totalGroupSessions = counts.groupSessions + counts.lessonSessions;
    counts.totalSessions = counts.totalGroupSessions + counts.privateSessions;
    result.set(name, counts);
  }
  return result;
}

export function reconcileSettlementClassCounts(counts, instructor) {
  if (!counts || counts.groupSessions !== Number(instructor.groupCount)
    || counts.lessonSessions !== Number(instructor.lessonCount)
    || counts.privateSettlementUnits !== Number(instructor.privateCount)) fail();
  return counts;
}

export function settlementClassCountPresentation(counts) {
  if (!counts || Object.values(counts).some(value => !Number.isFinite(value) || value < 0)
    || counts.totalGroupSessions !== counts.groupSessions + counts.lessonSessions
    || counts.privateSessions !== counts.soloSessions + counts.duetSessions + counts.tripleSessions
    || counts.totalSessions !== counts.totalGroupSessions + counts.privateSessions) fail();
  const privateBreakdown = `개인 ${count(counts.soloSessions)}회 · 듀엣 ${count(counts.duetSessions)}회`
    + (counts.tripleSessions ? ` · 트리플 ${count(counts.tripleSessions)}회` : '');
  return {
    totalClasses: count(counts.totalSessions),
    groupMetric: { label: '그룹', value: `${count(counts.totalGroupSessions)}회`,
      details: [`일반 그룹 ${count(counts.groupSessions)}회`, `강사레슨 ${count(counts.lessonSessions)}회`] },
    privateMetric: { label: '프라이빗', value: `${count(counts.privateSessions)}회`,
      details: [privateBreakdown, `회원별 정산 ${count(counts.privateSettlementUnits)}건`] },
    privateDetail: `${privateBreakdown} · 회원별 정산 ${count(counts.privateSettlementUnits)}건`,
    lessonDetail: `강사레슨 ${count(counts.lessonSessions)}회`,
  };
}
