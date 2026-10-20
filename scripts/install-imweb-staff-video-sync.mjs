import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STAFF_VIDEO_DIR, STAFF_VIDEO_POLICY } from './lib/imweb-staff-video-sync.mjs';
import { SITE, UNIT } from './lib/imweb-staff-video-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(os.homedir(), 'dev/archive-in-runtime');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--prepare', '--apply'].includes(args[0])) throw Error('Use --prepare or --apply');
const apply = args[0] === '--apply';
const git = values => execFileSync('git', values, { cwd: root, encoding: 'utf8' }).trim();
if (apply) {
  if (root !== runtime || git(['status', '--porcelain'])
    || git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) throw Error('Clean integrated runtime required');
}
fs.mkdirSync(STAFF_VIDEO_DIR, { recursive: true, mode: 0o700 });
const configFile = path.join(STAFF_VIDEO_DIR, 'config.json');
const stateFile = path.join(STAFF_VIDEO_DIR, 'state.json');
if (fs.existsSync(configFile)) {
  const existing = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (existing.policyVersion !== STAFF_VIDEO_POLICY || existing.approved !== true
    || existing.siteCode !== SITE || existing.unitCode !== UNIT) throw Error('Existing activation requires review');
  if (!fs.existsSync(stateFile)) throw Error('Activated ownership ledger missing; operator review required');
} else {
  if (fs.existsSync(stateFile)) throw Error('Unactivated ownership ledger exists; operator review required');
  fs.writeFileSync(stateFile, JSON.stringify({ policyVersion: STAFF_VIDEO_POLICY, approved: true,
    members: {} }, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(configFile, JSON.stringify({ policyVersion: STAFF_VIDEO_POLICY, approved: true,
    siteCode: SITE, unitCode: UNIT, approvedAt: new Date().toISOString(),
    source: 'operator_approved_staff_grade_video_linking_20261020' }, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
}
if (apply) {
  const label = 'com.archive.imweb-staff-video';
  const domain = `gui/${process.getuid()}`;
  const destination = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const source = path.join(root, 'ops/launchagents', `${label}.plist`);
  execFileSync('plutil', ['-lint', source], { stdio: 'pipe' });
  fs.copyFileSync(source, destination); fs.chmodSync(destination, 0o600);
  let loaded = false; let running = false;
  try {
    const status = execFileSync('launchctl', ['print', `${domain}/${label}`], { encoding: 'utf8', stdio: 'pipe' });
    loaded = true; running = /state = running/.test(status);
  } catch {}
  if (running) throw Error('Wait for the active staff sync before reinstalling');
  if (loaded) execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'pipe' });
  execFileSync('launchctl', ['bootstrap', domain, destination], { stdio: 'pipe' });
  execFileSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'pipe' });
}
console.log(JSON.stringify({ ok: true, prepared: true, installed: apply, intervalSeconds: 300 }));
