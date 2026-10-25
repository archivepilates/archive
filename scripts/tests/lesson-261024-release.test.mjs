import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
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

const uiBaseline = execFileSync('git', ['show', 'b7e70384:core/rules/index.html'], { cwd: root, encoding: 'utf8' });
// The completed A/B release is immutable evidence; later lanes add their own notes.
const currentRules = execFileSync('git', ['show', '9aaf7a8c:core/rules/index.html'], { cwd: root, encoding: 'utf8' });
const releaseSource = readFileSync(new URL('../release-lesson-261024.mjs', import.meta.url), 'utf8');
function existingNote(html) {
  const lines = html.split('\n').filter(line => line.includes('id="lesson-share-261024"'));
  assert.equal(lines.length, 1, 'Exactly one existing lesson-share note is required');
  return `${lines[0]}\n`;
}
const uiOriginalNote = existingNote(uiBaseline);
const uiCurrentNote = existingNote(currentRules);
const uiReplacement = note.replace('Synthetic policy fixture.', 'Synthetic verified UI grant fixture.');
const proposedUiRules = uiBaseline.replace(uiOriginalNote, uiReplacement);

test('UI rule target table pins both site boundaries and b7e70384 without invoking the release main', () => {
  const start = releaseSource.indexOf('const targets = {');
  const end = releaseSource.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'Bounded target table required');
  // Evaluate only the literal table with its one asset constant, never the release entrypoint.
  const targets = runInNewContext(`${releaseSource.slice(start, end + 3)}\ntargets;`, {
    ASSET: '/assets/imweb-my-classroom-20260723a.js',
  });
  for (const [target, site, resource, url] of [
    ['ui-rules', 'archive-pilates', '/core/rules/index.html', 'https://archive-pilates.web.app/core/rules/'],
    ['ui-core-rules', 'archive-pilates-core', '/rules/index.html', 'https://archive-pilates-core.web.app/rules/'],
  ]) {
    assert.deepEqual(structuredClone(targets[target]), {
      site, resource, baseline: 'b7e70384', source: 'core/rules/index.html', url,
    });
  }
});

for (const target of ['ui-rules', 'ui-core-rules']) {
  test(`${target}: accepts one existing-note replacement and preserves every surrounding byte`, () => {
    assert.notEqual(uiOriginalNote, uiReplacement);
    assert.equal(proposedUiRules.replace(uiReplacement, ''), uiBaseline.replace(uiOriginalNote, ''));
    assert.doesNotThrow(() => assertLessonReleaseScope(uiBaseline, proposedUiRules, target));
  });

  test(`${target}: released A/B source changes only the existing note relative to Git b7e70384`, () => {
    assert.notEqual(uiCurrentNote, uiOriginalNote, 'Current source must contain a real note update');
    assert.equal(currentRules, uiBaseline.replace(uiOriginalNote, uiCurrentNote));
    assert.doesNotThrow(() => assertLessonReleaseScope(uiBaseline, currentRules, target));
  });

  for (const [label, after] of [
    ['no-op', uiBaseline],
    ['note removal', uiBaseline.replace(uiOriginalNote, '')],
    ['additional note', uiBaseline + uiReplacement],
    ['duplicate note on another line', proposedUiRules.replace(uiReplacement, uiReplacement + uiReplacement)],
    ['duplicate note on the same line', proposedUiRules.replace(uiReplacement, uiReplacement.trimEnd() + uiReplacement.trimStart())],
    ['unrelated prefix', `<!-- synthetic-unrelated -->\n${proposedUiRules}`],
    ['unrelated suffix', `${proposedUiRules}\n`],
    ['unrelated byte removal', proposedUiRules.slice(1)],
    ['unrelated title change', proposedUiRules.replace('<title>', '<title>Synthetic unrelated ')],
    ['unrelated sibling on the note line', proposedUiRules.replace(uiReplacement, `${uiReplacement.trimEnd()}<div id="synthetic-unrelated">Other content</div>\n`)],
    ['note relocation', uiBaseline.replace(uiOriginalNote, '') + uiReplacement],
  ]) {
    test(`${target}: rejects ${label}`, () => {
      assert.notEqual(after, proposedUiRules, 'Negative fixture must differ from the allowed replacement');
      assert.throws(() => assertLessonReleaseScope(uiBaseline, after, target));
    });
  }

  test(`${target}: rejects insertion when the pinned baseline has no existing note`, () => {
    assert.throws(() => assertLessonReleaseScope(uiBaseline.replace(uiOriginalNote, ''), proposedUiRules, target));
  });

  test(`${target}: rejects replacement when the pinned baseline has duplicate notes`, () => {
    assert.throws(() => assertLessonReleaseScope(uiBaseline + uiOriginalNote, proposedUiRules, target));
  });
}
