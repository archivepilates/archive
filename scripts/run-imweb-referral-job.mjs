import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './run-imweb-referral-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(homedir(), 'ArchiveIN/automation/referral-production');
const result = await main(['--config', join(directory, 'config.json'), '--apply']);
if (result.exitCode) {
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error();
    const filename = join(directory, 'failure-email.json');
    let prior = null;
    if (existsSync(filename)) {
      const entry = lstatSync(filename);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.mode & 0o077) throw new Error();
      prior = JSON.parse(readFileSync(filename, 'utf8'));
    }
    const now = Date.now();
    if (prior?.errorCode !== result.errorCode || now - Date.parse(prior.sentAt) >= 86400000) {
      const body = ['주체: ARCHIVE PILATES / 친구 초대 자동 적립',
        `결론: 자동 적립 점검이 중단되었습니다. (${result.errorCode})`,
        `발생: ${result.finishedAt}`, '영향: 확인되지 않은 적립은 자동 재시도하지 않습니다. 기존 구매·시청 권한은 변경하지 않습니다.',
        '검증: 비공개 실행 장부와 아임웹 적립 내역을 대조해야 합니다.',
        '다음: Mac mini의 referral-production 실행 상태를 확인한 뒤 재개하세요.'].join('\n');
      const sent = spawnSync(process.execPath, ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {
        cwd: root, encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AUTOMATION_REPORT_SUBJECT: '[친구초대][실패] 자동 적립 확인 필요',
          AUTOMATION_REPORT_BODY: body, AUTOMATION_REPORT_FROM: 'home@archivepilates.com',
          AUTOMATION_REPORT_TO: 'home@archivepilates.com', AUTOMATION_REPORT_LABEL: '자동화 실패',
          GOOGLE_SERVICE_ACCOUNT_KEY: join(homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json') },
      });
      if (sent.status !== 0) throw new Error();
      writeFileSync(filename, JSON.stringify({ errorCode: result.errorCode, sentAt: new Date(now).toISOString() }), { mode: 0o600 });
    }
  } catch { process.stderr.write('Referral failure notification could not be confirmed.\n'); }
}
process.exitCode = result.exitCode;
