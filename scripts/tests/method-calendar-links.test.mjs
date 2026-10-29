import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEAM_EVENT, renderTeamCalendarHtml, renderTeamCalendarIcs } from '../build-team-261120-calendar.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const methodRoot = path.join(root, 'archivein/method');
const builders = ['validate-method-calendar-links.mjs', 'build-team-261120-calendar.mjs', 'build-team-261121-calendar.mjs'];
const saved = new Map();
for (const slug of fs.readdirSync(methodRoot)) {
  const token = slug.match(/-(\d{6})$/)?.[1];
  if (!token) continue;
  for (const name of ['index.html', `archive-method-${token}.ics`]) {
    const relative = `${slug}/calendar/${name}`;
    if (fs.existsSync(path.join(methodRoot, relative))) saved.set(relative, fs.readFileSync(path.join(methodRoot, relative)));
  }
}
const ordinary = [...saved.keys()].find(file => file.endsWith('/index.html') && !file.startsWith('team-'));
assert.ok(ordinary, 'existing ordinary calendar fixture required');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'method-calendar-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const name of builders) fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
  const update = (file, content) => {
    const target = path.join(dir, 'archivein/method', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  for (const [file, content] of saved) update(file, content);
  return { update, run: () => spawnSync(process.execPath, [path.join(dir, 'scripts/validate-method-calendar-links.mjs')],
    { encoding: 'utf8', timeout: 15000 }) };
}

test('exact November 20 Team is standalone, builder-verified, 14:00–15:50 #1 with stable date and UID', async t => {
  assert.equal(TEAM_EVENT.date, '2026-11-20');
  assert.equal(TEAM_EVENT.start, '20261120T050000Z');
  assert.equal(TEAM_EVENT.end, '20261120T065000Z');
  assert.equal(TEAM_EVENT.uid, 'team-261120@archivepilates.com');
  assert.equal(TEAM_EVENT.title, 'ARCHIVE PILATES Team 강사레슨 · ARCHIVE METHOD #1 직장인 증후군');
  assert.match(renderTeamCalendarHtml(), /data-event-date="2026-11-20"/);
  assert.doesNotMatch(renderTeamCalendarHtml(), /method-calendar\.css|rel="stylesheet"/);
  const before = [...saved].map(([file, content]) => [file, Buffer.from(content)]);
  const result = fixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /calendar validation passed/);
  for (const [file, content] of before) assert.deepEqual(fs.readFileSync(path.join(methodRoot, file)), content);
});

const team20Html = 'team-261120/calendar/index.html';
const team20Ics = 'team-261120/calendar/archive-method-261120.ics';
const team21Html = 'team-261121/calendar/index.html';
const team21Ics = 'team-261121/calendar/archive-method-261121.ics';
const ordinaryIcs = ordinary.replace('index.html', `archive-method-${ordinary.match(/-(\d{6})\//)[1]}.ics`);

for (const [label, file, from, to] of [
  ['Team20 HTML event date', team20Html, 'data-event-date="2026-11-20"', 'data-event-date="2026-11-21"'],
  ['Team20 Google times', team20Html, '20261120T050000Z%2F20261120T065000Z', '20261120T040000Z%2F20261120T061000Z'],
  ['Team20 ICS start', team20Ics, 'DTSTART:20261120T050000Z', 'DTSTART:20261120T040000Z'],
  ['Team20 ICS end', team20Ics, 'DTEND:20261120T065000Z', 'DTEND:20261120T061000Z'],
  ['Team20 UID', team20Ics, 'UID:team-261120@archivepilates.com', 'UID:team-261121@archivepilates.com'],
  ['Team20 topic', team20Html, 'ARCHIVE METHOD #1', 'ARCHIVE METHOD #8'],
  ['Team21 Google times', team21Html, '20261121T043000Z%2F20261121T062000Z', '20261121T050000Z%2F20261121T065000Z'],
  ['Team21 UID', team21Ics, 'UID:team-261121@archivepilates.com', 'UID:team-261120@archivepilates.com'],
  ['Team21 topic', team21Html, 'ARCHIVE METHOD #9', 'ARCHIVE METHOD #1'],
  ['ordinary shared stylesheet', ordinary, '../../assets/method-calendar.css', 'missing.css'],
  ['ordinary Google times', ordinary, 'T040000Z%2F', 'T050000Z%2F'],
  ['ordinary UID', ordinaryIcs, 'UID:archive-method-8-external-feedback-', 'UID:wrong-'],
  ['ordinary topic', ordinaryIcs, 'SUMMARY:ARCHIVE METHOD #8', 'SUMMARY:ARCHIVE METHOD #1'],
]) {
  test(`rejects ${label} drift without changing other validation rules`, t => {
    const f = fixture(t), original = saved.get(file).toString('utf8');
    assert.ok(original.includes(from), `${label} mutation must actually change the fixture`);
    f.update(file, original.replaceAll(from, to));
    const result = f.run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /calendar validation failed/);
  });
}

test('Team-like slugs do not receive the two exact standalone exceptions', t => {
  const f = fixture(t);
  f.update('other-team-261120/calendar/index.html', renderTeamCalendarHtml());
  f.update('other-team-261120/calendar/archive-method-261120.ics', renderTeamCalendarIcs('20261029T000000Z'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /other-team-261120[\s\S]*shared calendar stylesheet is missing/);
});
