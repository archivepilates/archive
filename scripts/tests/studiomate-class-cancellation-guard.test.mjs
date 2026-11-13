import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CLASS_HEADERS, parseClassTable, auditClassRows, compareClassReadbacks, runCancellationGuard} from '../studiomate-class-cancellation-guard.mjs';
import {prepareClassCancellationPlan} from '../lib/class-cancellation-policy.mjs';

const cells = (date = '2026-11-21', time = '09:00', deadline = '2026-11-20 21:00:00 까지') => [date, time, '09:50', 'Test Instructor', '그룹', 'Test Class', '그룹', 'Room A', '5', '2', '무제한', `${date} 08:59:00 까지`, deadline, `${date} 07:00:00`];
const parse = data => parseClassTable([CLASS_HEADERS, ...data], {from: '2026-11-01', through: '2026-11-30', expectedCount: data.length});
const plan = rows => prepareClassCancellationPlan(rows, {operation: 'edit'});

test('native parser requires complete headers, explicit UI count and valid unique identities', () => {
  assert.equal(parse([cells()]).length, 1);
  assert.throws(() => parseClassTable([CLASS_HEADERS, cells()], {from: '2026-11-01', through: '2026-11-30', expectedCount: 2}), /count/);
  assert.throws(() => parseClassTable([CLASS_HEADERS.slice(1), cells()], {from: '2026-11-01', through: '2026-11-30', expectedCount: 1}), /headers/);
  assert.throws(() => parse([cells(), cells()]), /duplicate/);
  assert.throws(() => parse([cells('2026-11-31')]), /date/);
  assert.throws(() => parse([cells('2026-12-01')]), /range/);
  assert.throws(() => parse([cells('2026-11-21', '24:00')]), /identity/);
});

test('audit catches inherited six hours and does not claim weekday/holiday coverage', () => {
  const rows = parse([cells(), cells('2026-11-28', '09:00', '2026-11-28 03:00:00 까지'), cells('2026-11-20')]);
  const result = auditClassRows(rows, {weekendOnly: true});
  assert.equal(result.ok, false);
  assert.equal(result.checkedCount, 2);
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.outsideScopeCount, 1);
  assert.equal(auditClassRows(rows).blockedCount, 1);
});

test('native readback accepts exactly the target cancellation-column edit', () => {
  const before = parse([cells('2026-11-21', '09:00', '2026-11-21 03:00:00 까지'), cells('2026-11-28')]);
  const after = parse([cells(), cells('2026-11-28', '09:00', '2026-11-27 21:00:00 까지')]);
  const result = compareClassReadbacks(before, after, plan(after));
  assert.equal(result.changedCount, 2);
  assert.equal(result.unrelatedClassesPreserved, true);
  assert.equal(result.bookingRosterVerified, false);
});

test('rejects stale, extra, missing, duplicated and unrelated changed readbacks', () => {
  const before = parse([cells('2026-11-21', '09:00', '2026-11-21 03:00:00 까지'), cells('2026-11-28', '09:00', '2026-11-27 21:00:00 까지')]);
  const after = parse([cells(), cells('2026-11-28', '09:00', '2026-11-27 21:00:00 까지')]);
  const prepared = plan([after[0]]);
  assert.throws(() => compareClassReadbacks(before, before, prepared));
  assert.throws(() => compareClassReadbacks(before, [after[0]], prepared), /removed/);
  assert.throws(() => compareClassReadbacks(before, [...after, after[0]], prepared), /Duplicate/);
  const extra = structuredClone(after[1]); extra.startTime = '10:00'; extra.nativeCells[1] = '10:00';
  assert.throws(() => compareClassReadbacks(before, [...after, extra], prepared), /addition/);
  const unrelated = structuredClone(after); unrelated[1].nativeCells[8] = '6';
  assert.throws(() => compareClassReadbacks(before, unrelated, prepared), /Unexpected change/);
  const targetOtherField = structuredClone(after); targetOtherField[0].nativeCells[2] = '10:00';
  assert.throws(() => compareClassReadbacks(before, targetOtherField, prepared), /Unexpected change/);
  const contradictory = structuredClone(after); contradictory[0].nativeCells[12] = before[0].nativeCells[12];
  assert.throws(() => compareClassReadbacks(before, contradictory, prepared), /contradict/);
  const tampered = structuredClone(prepared); tampered.rows[0].cancellation.deadline = '2026-11-21 03:00:00';
  assert.throws(() => compareClassReadbacks(before, after, tampered), /modified/);
});

test('copy requires only new approved destinations while preserving all existing classes', () => {
  const before = parse([cells()]);
  const destination = parse([cells('2026-11-28', '09:00', '2026-11-27 21:00:00 까지')]);
  const prepared = prepareClassCancellationPlan(destination, {operation: 'copy'});
  assert.equal(compareClassReadbacks(before, [...before, ...destination], prepared).addedCount, 1);
  assert.throws(() => compareClassReadbacks(before, before, prepared), /Missing/);
  assert.throws(() => compareClassReadbacks(destination, destination, prepared), /already existed/);
  for (const index of [2, 8]) {
    const wrong = structuredClone(destination); wrong[0].nativeCells[index] = '99';
    assert.throws(() => compareClassReadbacks(before, [...before, ...wrong], prepared), /non-policy/);
  }
  const incomplete = structuredClone(destination); delete incomplete[0].nativeCells;
  assert.throws(() => compareClassReadbacks(before, [...before, ...destination], prepareClassCancellationPlan(incomplete, {operation: 'copy'})), /native row/);
});

test('even a plan made from the after state cannot authorize changing an excluded class', () => {
  const original = cells(); original[6] = '강사레슨';
  const changed = [...original]; changed[12] = '2026-11-21 03:00:00 까지';
  const before = parse([original]), after = parse([changed]);
  assert.throws(() => compareClassReadbacks(before, after, plan(after)), /Unexpected change/);
});

test('CLI writes private files, never overwrites and rejects unknown flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'class-cancellation-'));
  try {
    const input = path.join(dir, 'input.json'), output = path.join(dir, 'prepared.json');
    fs.writeFileSync(input, JSON.stringify({operation: 'copy', rows: parse([cells()])}), {mode: 0o600});
    assert.equal(runCancellationGuard(['plan', '--input', input, '--output', output]).ok, true);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => runCancellationGuard(['plan', '--input', input, '--output', output]), /exist/);
    assert.throws(() => runCancellationGuard(['plan', '--apply']), /Unknown/);
    assert.throws(() => runCancellationGuard(['plan', '--input', input]), /output/);
    const draft = path.join(dir, 'draft.json');
    fs.writeFileSync(draft, JSON.stringify({rows: parse([cells()])}), {mode: 0o600});
    assert.equal(runCancellationGuard(['check-draft', '--plan', output, '--input', draft, '--output', path.join(dir, 'checked.json')]).ok, true);
    const bad = JSON.parse(fs.readFileSync(output, 'utf8')); bad.rows[0].cancellation.leadHours = 6;
    const badFile = path.join(dir, 'bad.json'); fs.writeFileSync(badFile, JSON.stringify(bad), {mode: 0o600});
    assert.throws(() => runCancellationGuard(['check-draft', '--plan', badFile, '--input', draft, '--output', path.join(dir, 'bad-check.json')]), /modified/);
    fs.chmodSync(dir, 0o755);
    assert.throws(() => runCancellationGuard(['plan', '--input', input, '--output', path.join(dir, 'unsafe.json')]), /private directory/);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
