import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('scripts/generate-monthly-settlement-statements.mjs');
test('review-finalization failures never fall through to legacy file creation or network work', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'settlement-cli-'));
  try {
    for (const extra of [['--rebuild-from-raw'], []]) {
      const result = spawnSync(process.execPath, [script, '--month=202610', `--root=${root}`,
        '--finalize-reviewed=/definitely-missing/private-evidence.json', ...extra], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.deepEqual(readdirSync(root), []);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes('export 실패'), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy apply refuses to overwrite a finalized corrected pair before rebuilding anything', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'settlement-cli-'));
  try {
    const dir = path.join(root, '202610'); mkdirSync(dir);
    const names = ['아카이브 정산명세서 202610_INDEX_검토본.html', '아카이브 정산명세서 202610_INDEX.html',
      '아카이브 정산명세서 202610_검토본.xlsx', '아카이브 정산명세서 202610.xlsx'];
    for (const name of names) writeFileSync(path.join(dir, name), name.endsWith('.html') ? 'preserved-layout' : 'preserved-values');
    const before = names.map(name => readFileSync(path.join(dir, name)));
    const result = spawnSync(process.execPath, [script, '--month=202610', `--root=${root}`, '--apply'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed_finalization_legacy_overwrite_forbidden/);
    assert.equal(readdirSync(dir).length, 4);
    names.forEach((name, i) => assert.deepEqual(readFileSync(path.join(dir, name)), before[i]));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a cleaned HTML-only finalized folder stays protected after workbook archival', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'settlement-html-only-'));
  try {
    const dir=path.join(root,'202610'), archive=path.join(root,'정산 근거보관','202610');
    mkdirSync(dir,{recursive:true});mkdirSync(archive,{recursive:true});
    const index=path.join(dir,'아카이브 정산명세서 202610_INDEX.html');
    const workbook=path.join(archive,'아카이브 정산명세서 202610.xlsx');
    writeFileSync(index,'preserve-recipient-index');writeFileSync(workbook,'preserve-corrected-payroll');
    const result=spawnSync(process.execPath,[script,'--month=202610',`--root=${root}`,'--apply','--rebuild-from-raw'],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/archived_finalization_legacy_overwrite_forbidden/);
    assert.equal(readFileSync(index,'utf8'),'preserve-recipient-index');
    assert.equal(readFileSync(workbook,'utf8'),'preserve-corrected-payroll');
    assert.equal(readdirSync(dir).length,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
