import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import xlsx from 'xlsx';
import {evaluateClassCancellation, prepareClassCancellationPlan, assertClassCancellationDraft} from './lib/class-cancellation-policy.mjs';

export const CLASS_HEADERS = ['수업일', '수업시작시간', '수업종료시간', '강사', '수업', '수업명', '수업구분', '룸', '최대수강인원', '최소수강인원', '예약대기가능인원', '예약가능시간', '취소가능시간', '폐강시간'];
const key = row => JSON.stringify([row.date, row.startTime, row.staffName, row.lessonType, row.category, row.title, row.room]);
const sha = data => createHash('sha256').update(data).digest('hex');
const rebindPlan = plan => {
  if (!plan || typeof plan !== 'object') throw Error('Prepared plan required');
  const expected = prepareClassCancellationPlan(plan.rows, {operation: plan.operation, calendar: plan.calendar});
  if (!expected.ok || !isDeepStrictEqual(expected, plan)) throw Error('Invalid or modified prepared plan');
  return expected;
};
const dateValue = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw Error('Invalid source date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error('Invalid source date');
  return date;
};

export function parseClassTable(table, {from, through, expectedCount}) {
  dateValue(from); dateValue(through);
  if (from > through || !Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 100000) throw Error('Source range and positive UI row count required');
  if (!Array.isArray(table) || !isDeepStrictEqual(table[0], CLASS_HEADERS)) throw Error('Full native class Excel headers required');
  if (table.length !== expectedCount + 1) throw Error('Excel count differs from the independently observed UI count');
  const seen = new Set();
  return table.slice(1).map((cells, index) => {
    if (!Array.isArray(cells) || cells.length !== CLASS_HEADERS.length || cells.some(c => typeof c !== 'string')) throw Error(`Invalid native row ${index + 2}`);
    const [date, startTime, , staffName, lessonType, title, category, room] = cells;
    dateValue(date);
    if (date < from || date > through || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !staffName.trim() || !title.trim()) throw Error(`Invalid identity or out-of-range row ${index + 2}`);
    const row = {date, startTime, staffName, lessonType, title, category, room, cancelDeadline: cells[12], nativeCells: [...cells]};
    if (seen.has(key(row))) throw Error('Ambiguous duplicate native class identity');
    seen.add(key(row)); return row;
  });
}

export function auditClassRows(rows, {calendar, weekendOnly = false} = {}) {
  const results = rows.map((row, index) => {
    const weekday = dateValue(row.date).getUTCDay();
    if (weekendOnly && weekday !== 0 && weekday !== 6) return {index, status: 'outside_scope'};
    const result = evaluateClassCancellation(row, {calendar});
    if (result.status !== 'enforce') return {index, ...result};
    const actual = row.cancelDeadline.replace(/ 까지$/, '');
    return {index, ...result, actualDeadline: actual, matches: actual === result.expectedDeadline};
  });
  const mismatches = results.filter(r => r.status === 'enforce' && !r.matches);
  const blocked = results.filter(r => r.status === 'blocked');
  return {ok: !mismatches.length && !blocked.length, readOnly: true, scope: weekendOnly ? 'weekend_only_not_holiday_or_weekday_verification' : 'calendar_covered_policy', rowCount: rows.length, checkedCount: results.filter(r => r.status === 'enforce').length, excludedCount: results.filter(r => r.status === 'excluded').length, outsideScopeCount: results.filter(r => r.status === 'outside_scope').length, mismatchCount: mismatches.length, blockedCount: blocked.length, results};
}

export function compareClassReadbacks(before, after, plan) {
  // Bind every destination to the prepared policy again; a supplied plan is not approval or native evidence.
  const expected = rebindPlan(plan);
  const assertNative = row => {
    const parsed = parseClassTable([CLASS_HEADERS, row.nativeCells], {from: row.date, through: row.date, expectedCount: 1})[0];
    if (key(parsed) !== key(row) || parsed.cancelDeadline !== row.cancelDeadline) throw Error('Canonical fields contradict native cells');
  };
  before.forEach(assertNative); after.forEach(assertNative);
  const targetKeys = new Set(plan.rows.map(key));
  const beforeMap = new Map(before.map(r => [key(r), r]));
  const afterMap = new Map(after.map(r => [key(r), r]));
  if (beforeMap.size !== before.length || afterMap.size !== after.length || targetKeys.size !== plan.rows.length) throw Error('Duplicate readback identity');
  const selected = plan.rows.map(r => afterMap.get(key(r)));
  if (selected.some(r => !r)) throw Error('Missing destination class');
  const checked = assertClassCancellationDraft(expected, selected);
  if (checked === false || checked?.ok === false) throw Error('Saved destination cancellation policy does not match');
  const changes = [];
  for (const [identity, row] of beforeMap) {
    const next = afterMap.get(identity);
    if (!next) throw Error('Pre-existing class removed or identity changed');
    if (!isDeepStrictEqual(row.nativeCells, next.nativeCells)) {
      const columns = row.nativeCells.flatMap((v, i) => v === next.nativeCells[i] ? [] : [i]);
      if (plan.operation !== 'edit' || !targetKeys.has(identity) || columns.some(i => i !== 12)
        || evaluateClassCancellation(row, {calendar: plan.calendar}).status !== 'enforce') throw Error('Unexpected change outside an enforced target cancellation column');
      changes.push({key: identity, columns: columns.map(i => CLASS_HEADERS[i])});
    }
  }
  const added = [...afterMap.keys()].filter(k => !beforeMap.has(k));
  if (plan.operation === 'edit' ? added.length || plan.rows.some(r => !beforeMap.has(key(r))) : plan.rows.some(r => beforeMap.has(key(r))) || added.length !== targetKeys.size || added.some(k => !targetKeys.has(k))) throw Error('Unexpected addition or destination already existed');
  if (plan.operation !== 'edit') {
    for (const row of plan.rows) {
      // New destinations have no baseline row: require all planned native cells, not identity alone.
      assertNative(row);
      const actual = afterMap.get(key(row)).nativeCells;
      if (row.nativeCells.some((v, i) => i !== 12 && v !== actual[i])) throw Error('New destination differs from planned non-policy fields');
    }
  }
  return {ok: true, readOnly: true, beforeCount: before.length, afterCount: after.length, targetCount: targetKeys.size, changedCount: changes.length, addedCount: added.length, unrelatedClassesPreserved: true, changes, bookingRosterVerified: false};
}

function readExcel(file, coverage) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > 50 * 1024 * 1024) throw Error('Excel input too large');
  const workbook = xlsx.read(bytes, {type: 'buffer'});
  if (workbook.SheetNames.length !== 1) throw Error('Exactly one native class worksheet required');
  const table = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1, raw: false, defval: '', blankrows: true});
  return {rows: parseClassTable(table, coverage), sha256: sha(bytes)};
}

function writePrivate(file, value) {
  const parent = path.dirname(path.resolve(file));
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Output requires an owned private directory (0700)');
  const fd = fs.openSync(file, 'wx', 0o600);
  try {fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}

export function runCancellationGuard(args) {
  const [command, ...rest] = args;
  const flags = {};
  const allowed = {
    plan: ['input', 'output'],
    'check-draft': ['plan', 'input', 'output'],
    'audit-excel': ['file', 'from', 'through', 'expected-count', 'calendar', 'weekend-only', 'output'],
    'verify-excel': ['file', 'before-file', 'from', 'through', 'expected-count', 'before-count', 'plan', 'output'],
  }[command];
  if (!allowed) throw Error('Use plan, check-draft, audit-excel or verify-excel; all commands are read-only');
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || !allowed.includes(name) || Object.hasOwn(flags, name)) throw Error('Unknown or repeated argument');
    flags[name] = name === 'weekend-only' ? true : rest[++i];
    if (!flags[name] || typeof flags[name] === 'string' && flags[name].startsWith('--')) throw Error('Missing argument value');
  }
  if (!flags.output) throw Error('Private output path required');
  const json = name => {if (!flags[name]) throw Error(`Missing --${name}`); return JSON.parse(fs.readFileSync(flags[name], 'utf8'));};
  let result;
  if (command === 'plan') {
    const input = json('input');
    result = prepareClassCancellationPlan(input.rows, {operation: input.operation, calendar: input.calendar});
  } else if (command === 'check-draft') {
    const plan = json('plan'), draft = json('input');
    result = assertClassCancellationDraft(rebindPlan(plan), draft.rows);
    if (result === undefined || result === true) result = {ok: true, readOnly: true};
  } else {
    if (!flags.file) throw Error('Missing --file');
    const coverage = {from: flags.from, through: flags.through, expectedCount: Number(flags['expected-count'])};
    const current = readExcel(flags.file, coverage);
    if (command === 'audit-excel') result = {...auditClassRows(current.rows, {calendar: flags.calendar ? json('calendar') : undefined, weekendOnly: !!flags['weekend-only']}), sourceSha256: current.sha256};
    else {
      if (!flags['before-file']) throw Error('Missing --before-file');
      const before = readExcel(flags['before-file'], {...coverage, expectedCount: Number(flags['before-count'])});
      result = {...compareClassReadbacks(before.rows, current.rows, json('plan')), beforeSha256: before.sha256, afterSha256: current.sha256};
    }
    result.coverage = {...coverage, authority: 'caller_observed_native_UI_range_and_count_not_independently_fetched_by_this_CLI'};
  }
  writePrivate(flags.output, result);
  return {ok: result.ok, readOnly: true, command, checkedCount: result.checkedCount, mismatchCount: result.mismatchCount, blockedCount: result.blockedCount ?? result.blocked?.length, targetCount: result.targetCount};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {const result = runCancellationGuard(process.argv.slice(2)); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 2;}
  catch (error) {console.error(`Cancellation guard blocked: ${error.message}`); process.exitCode = 1;}
}
