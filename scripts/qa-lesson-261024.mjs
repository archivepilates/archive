import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { imwebJson } from './lib/imweb-referral-source.mjs';
import { SITE, UNIT, STAFF_GRADE, assertMemberPreserved } from './lib/imweb-staff-video-policy.mjs';
import { A261024_SHARE, B261024_SHARE } from './lib/imweb-student-share-policy.mjs';
import { MEMBER_GROUP_LOCK } from './lib/imweb-staff-video-sync.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';

// Manual cross-tool QA harness: its caller must restore in cleanup and verify the
// receipt before ending the browser workflow. Native groups do not have a TTL.

const ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261024');
const TEST_MEMBER = 'm20260701062ea69cfb285';
const TEST_GROUPS = { A: A261024_SHARE.groupCode, B: B261024_SHARE.groupCode };
const file = path.join(ROOT, 'qa-member.json');
const save = value => {
  const temporary = `${file}.${process.pid}.tmp`, fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(ROOT, 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
};

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['A', 'B', 'restore'].includes(mode)) throw Error('Only A, B, restore allowed');
  const release = await acquireStudioMateBrowserLock({ lockPath: MEMBER_GROUP_LOCK, owner: 'lesson-share-qa', waitMs: 0, staleMs: 600000 });
  try {
    const context = imwebJson(['config', 'context']);
    if (context.resolved_profile?.site_code !== SITE || context.resolved_profile?.unit_code !== UNIT
        || context.token?.status !== 'healthy' || !context.remote_context?.write_ready) throw Error('Imweb context mismatch');
    const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'member-snapshot.json')));
    const matches = snapshot.list.filter(row => row.memberCode === TEST_MEMBER && row.name === 'Codex 테스트');
    if (matches.length !== 1) throw Error('Dedicated test identity required');
    const before = imwebJson(['member', 'get', matches[0].uid, '--unit-code', UNIT]).data;
    if (before.memberCode !== TEST_MEMBER || before.siteCode !== SITE || before.unitCode !== UNIT
        || before.grade === STAFF_GRADE || !Array.isArray(before.group)) throw Error('Invalid test member');
    let state;
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Unsafe QA receipt');
      state = JSON.parse(fs.readFileSync(file));
      if (state.baseline.memberCode !== TEST_MEMBER) throw Error('Wrong QA baseline');
      assertMemberPreserved(state.baseline, before, before.group);
      if (state.intent) {
        if (!isDeepStrictEqual([...before.group].sort(), [...state.intent.afterGroups].sort())) throw Error('Unresolved QA write; inspect before retry');
        state.lastVerifiedGroups = [...before.group]; delete state.intent; save(state);
      }
      if (!isDeepStrictEqual([...before.group].sort(), [...state.lastVerifiedGroups].sort())) throw Error('Concurrent test-group change; preserve and review');
    } else {
      if (Object.values(TEST_GROUPS).some(code => before.group.includes(code))) throw Error('Test group predates this QA; do not adopt');
      state = { baseline: before, lastVerifiedGroups: [...before.group], createdAt: new Date().toISOString() }; save(state);
    }
    const groups = mode === 'restore' ? [...state.baseline.group] : [...state.baseline.group, TEST_GROUPS[mode]];
    if (isDeepStrictEqual([...before.group].sort(), [...groups].sort())) { console.log(JSON.stringify({ mode, unchanged: true })); return; }
    const command = ['member', 'update', 'groups', before.uid, '--data', JSON.stringify({ unitCode: UNIT, groupCodes: groups })];
    const dry = imwebJson([...command, '--dry-run']);
    if (!dry.confirmation_token || dry.body?.unitCode !== UNIT || !isDeepStrictEqual(dry.body.groupCodes, groups)) throw Error('QA dry-run mismatch');
    assertMemberPreserved(before, imwebJson(['member', 'get', before.uid, '--unit-code', UNIT]).data, before.group);
    state.intent = { mode, afterGroups: groups, attemptedAt: new Date().toISOString() }; save(state);
    const write = [...command, '--yes', '--confirm-token', dry.confirmation_token];
    if (dry.safety?.bulk_confirmation_required_for_execute) {
      const token = dry.bulk_confirmation_token || dry.safety.bulk_confirmation_token;
      if (!token) throw Error('QA bulk token missing');
      write.push('--bulk-confirm-token', token);
    }
    imwebJson(write);
    const after = imwebJson(['member', 'get', before.uid, '--unit-code', UNIT]).data;
    assertMemberPreserved(before, after, groups);
    state.lastVerifiedGroups = [...groups]; state.lastMode = mode; delete state.intent; save(state);
    console.log(JSON.stringify({ mode, independentlyVerified: true, baselinePreserved: true }));
  } finally { await release(); }
}

main().catch(() => { console.error('Test access update incomplete; reconcile private QA receipt and restore before completion'); process.exitCode = 1; });
