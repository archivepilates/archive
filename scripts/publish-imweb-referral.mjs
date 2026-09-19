import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imwebJson, IMWEB_REFERRAL_SCOPE as scope } from './lib/imweb-referral-source.mjs';

const start = '<!-- ARCHIVE-REFERRAL:START -->';
const end = '<!-- ARCHIVE-REFERRAL:END -->';
const hash = text => createHash('sha256').update(text).digest('hex');

export function mergeReferralBlock(previous, block) {
  if (!block.startsWith(start) || !block.endsWith(end) || !block.includes('data-archive-referral=')) {
    throw new Error('Invalid referral release');
  }
  const starts = previous.split(start).length - 1;
  const ends = previous.split(end).length - 1;
  if (starts !== ends || starts > 1) throw new Error('Ambiguous existing referral block');
  if (!starts) return `${previous}\n${block}`;
  const first = previous.indexOf(start), last = previous.indexOf(end) + end.length;
  if (last < first) throw new Error('Invalid existing referral block');
  return previous.slice(0, first) + block + previous.slice(last);
}

function readScripts(run) {
  const context = run(['config', 'context']);
  if (context.resolved_profile?.site_code !== scope.siteCode ||
      context.resolved_profile?.unit_code !== scope.unitCode) throw new Error('Unexpected scope');
  const { data } = run(['script', 'list', '--unit-code', scope.unitCode]);
  if (!Array.isArray(data) || data.length !== 3) throw new Error('Incomplete scripts');
  const scripts = {};
  for (const row of data) {
    if (!['body', 'header', 'footer'].includes(row.position) || scripts[row.position] ||
        row.siteCode !== scope.siteCode || row.unitCode !== scope.unitCode ||
        typeof row.scriptContent !== 'string' || row.scriptContent.length < 10000) throw new Error('Invalid scripts');
    scripts[row.position] = row.scriptContent;
  }
  if (!scripts.header.includes('data-archive-pilates-my-classroom-v2="2026-09-04d"') ||
      !scripts.body.includes('data-archive-pilates-video-watch-tracker="2026-09-19.1"')) {
    throw new Error('Protected classroom markers changed; inspect current source');
  }
  return scripts;
}

export function publishReferral({ apply = false, block, privateDirectory, run = imwebJson }) {
  // The CLI unit-script snapshot differs from the live SEO Footer Code source.
  // Never replace that source through the CLI until the provider resolves it.
  if (apply && run === imwebJson) throw new Error('Native SEO editor required: CLI source is not the live footer');
  const stat = lstatSync(privateDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error('Unsafe backup directory');
  }
  const lockPath = join(privateDirectory, 'script-update.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  try {
    const before = readScripts(run);
    const footer = mergeReferralBlock(before.footer, block);
    if (footer === before.footer) return { state: 'unchanged', verified: true };
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(privateDirectory, `scripts-before-${timestamp}.json`), JSON.stringify(before), { mode: 0o600, flag: 'wx' });
    const data = JSON.stringify({ unitCode: scope.unitCode, position: 'footer', scriptContent: footer });
    const args = ['script', 'update', '--data', data];
    const dry = run([...args, '--dry-run']);
    if (!dry.confirmation_token) throw new Error('Missing confirmation');
    if (!apply) return { state: 'dry-run', before: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, hash(value)])), afterFooter: hash(footer) };
    const current = readScripts(run);
    if (Object.keys(before).some(key => before[key] !== current[key])) throw new Error('Concurrent script change; no write performed');
    run([...args, '--yes', '--confirm-token', dry.confirmation_token]);
    const after = readScripts(run);
    if (after.body !== before.body || after.header !== before.header || after.footer !== footer) {
      throw new Error('Post-write source mismatch; manual review required');
    }
    const result = { state: 'published', verified: true, bodyUnchanged: true, headerUnchanged: true,
      footerHash: hash(footer), releaseHash: hash(block), verifiedAt: new Date().toISOString() };
    writeFileSync(join(privateDirectory, `publish-${timestamp}.json`), JSON.stringify(result), { mode: 0o600, flag: 'wx' });
    return result;
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Invalid arguments');
  const directory = join(homedir(), 'ArchiveIN/automation/referral-production');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const block = readFileSync('artifacts/imweb-referral/script.html', 'utf8');
  console.log(JSON.stringify(publishReferral({ apply: process.argv.includes('--apply'), block, privateDirectory: directory })));
}
