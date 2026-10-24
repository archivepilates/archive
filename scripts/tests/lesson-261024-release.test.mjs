import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertLessonReleaseScope } from '../release-lesson-261024.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = file => execFileSync('git', ['show', `4ce1faf6:${file}`], { cwd: root, encoding: 'utf8' });
const classroom = baseline('official-home/assets/imweb-my-classroom-20260723a.js');
const rules = baseline('core/rules/index.html');
const rows = ['A', 'B'].map((team, index) => `    ${JSON.stringify({
  code: `${team}261024`, path: `/private-lesson-external-feedback2-${team.toLowerCase()}-261024`,
  title: `10/24 외부 피드백2 ${team}팀 · 수강생 공유`,
  group: `PRIVATE LESSON EXTERNAL FEEDBACK2 ${team} 261024 40D`, private: true,
})}${index === 0 ? ',' : ''}\n`);
const anchor = classroom.match(/^    \{"code":"E261017"[^\n]+\}\n/m)?.[0];
assert.ok(anchor, 'Pinned Git baseline must contain the E261017 catalog anchor');
const proposedClassroom = classroom.replace(anchor, `${anchor.trimEnd()},\n${rows.join('')}`);
const note = '          <div class="rule-note" id="lesson-share-261024"><strong>10/24</strong><span>Synthetic policy fixture.</span></div>\n';

test('scope accepts exactly the two canonical team catalog additions on the Git baseline', () => {
  assert.doesNotThrow(() => assertLessonReleaseScope(classroom, proposedClassroom, 'classroom'));
});

test('scope rejects unrelated bytes, missing teams, duplicate codes and reordered teams', () => {
  for (const after of [proposedClassroom + '\n', proposedClassroom.replace('var VERSION=', 'var UNRELATED='),
    proposedClassroom.replace(rows[1], ''), proposedClassroom.replace('"B261024"', '"A261024"'),
    proposedClassroom.replace(rows.join(''), `${rows[1].trimEnd()},\n${rows[0].replace(/,\n$/, '\n')}`)]) {
    assert.throws(() => assertLessonReleaseScope(classroom, after, 'classroom'));
  }
});

for (const [field, from, to] of [
  ['path', '/private-lesson-external-feedback2-a-261024', '/private-lesson-external-feedback2-b-261024'],
  ['title', '10/24 외부 피드백2 A팀 · 수강생 공유', '10/24 외부 피드백2 B팀 · 수강생 공유'],
  ['group', 'PRIVATE LESSON EXTERNAL FEEDBACK2 A 261024 40D', 'PRIVATE LESSON EXTERNAL FEEDBACK2 B 261024 40D'],
]) {
  test(`scope rejects A code paired with the B ${field}`, () => {
    const after = proposedClassroom.replace(from, to);
    assert.throws(() => assertLessonReleaseScope(classroom, after, 'classroom'));
  });
}

test('scope rejects team rows outside the private catalog insertion point', () => {
  const after = rows.join('') + classroom;
  assert.throws(() => assertLessonReleaseScope(classroom, after, 'classroom'));
});

for (const target of ['rules', 'core-rules']) {
  test(`scope accepts only the synthetic operating note for ${target}`, () => {
    assert.doesNotThrow(() => assertLessonReleaseScope(rules, rules + note, target));
  });
}

test('rule scope rejects missing/duplicate notes and any other byte changes', () => {
  for (const after of [rules, rules + note + note, rules + note + '\n', note]) {
    assert.throws(() => assertLessonReleaseScope(rules, after, 'rules'));
  }
});
