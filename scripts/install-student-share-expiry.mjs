import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPIRY_WORKER_DIR, EXPIRY_WORKER_POLICY, expiryPlan, privateJson, savePrivateJson } from './lib/student-share-expiry-worker.mjs';
import { readStudentShareLedgers } from './lib/imweb-student-share-policy.mjs';

export async function installExpiryWorker(args, { execute = execFileSync, home = os.homedir(),
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), readLedgers = readStudentShareLedgers } = {}) {
  if (args.length !== 1 || !['--prepare','--install','--activate'].includes(args[0])) throw Error('Use --prepare, --install or --activate');
  const apply = args[0] !== '--prepare';
  const directory = path.join(home, 'ArchiveIN/automation/student-share-expiry');
  const file = path.join(directory, 'config.json');
  const label = 'com.archive.student-share-expiry';
  const target = `gui/${process.getuid()}/${label}`;
  const git = values => execute('git', values, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  if (apply && (root !== path.join(home, 'dev/archive-in-runtime') || git(['status','--porcelain','--untracked-files=no'])
    || git(['rev-parse','HEAD']) !== git(['rev-parse','origin/main']))) throw Error('Clean synchronized runtime required');
  const plan = expiryPlan(readLedgers(), Date.now());
  if (plan.status === 'blocked_unknown_result') throw Error('Existing ambiguous revocation requires review');
  if (!apply) return { ok: true, status: 'prepared', active: plan.active, due: plan.due, nextExpiryAt: plan.nextExpiryAt };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Unsafe worker directory');
  let config = privateJson(file, null);
  if (config && (config.policy !== EXPIRY_WORKER_POLICY || config.approved !== true || config.sourceAutomationId !== 'e-2'))
    throw Error('Existing activation mismatch');
  if (args[0] === '--activate') {
    if (!config || config.enabled) throw Error('Installed disabled worker required');
    const legacy = path.join(home, '.codex/automations/e-2/automation.toml');
    if (fs.existsSync(legacy) && !/^status\s*=\s*"PAUSED"\s*$/m.test(fs.readFileSync(legacy,'utf8')))
      throw Error('Legacy e-2 must be deleted or paused before activation');
    const current = execute('launchctl', ['print', target], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
    if (!current.includes(label)) throw Error('Worker is not installed');
    config = { ...config, enabled: true, activatedAt: new Date().toISOString(), sourceCommit: git(['rev-parse','HEAD']) };
    savePrivateJson(file, config);
    return { ok:true, status:'activated', active:plan.active, due:plan.due, intervalSeconds:60 };
  }
  if (config?.enabled) throw Error('Active worker reinstall requires review');
  if (!config) savePrivateJson(file, { policy: EXPIRY_WORKER_POLICY, approved: true, enabled: false,
    sourceAutomationId: 'e-2', approvedAt: new Date().toISOString(), scope: 'existing five canonical share sources; expiry only',
    sourceCommit: git(['rev-parse','HEAD']) });
  const source = path.join(root, 'ops/launchagents', label + '.plist');
  const destination = path.join(home, 'Library/LaunchAgents', label + '.plist');
  execute('plutil', ['-lint', source], { stdio:'pipe' });
  let loaded;
  try { loaded = execute('launchctl', ['print', target], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }); } catch {}
  if (loaded && /state = running/.test(loaded)) throw Error('Wait for existing worker');
  if (loaded) throw Error('Existing installed worker requires explicit reconciliation');
  fs.copyFileSync(source,destination); fs.chmodSync(destination,0o600);
  execute('launchctl',['bootstrap',`gui/${process.getuid()}`,destination],{stdio:'pipe'});
  execute('launchctl',['print',target],{stdio:'pipe'});
  return {ok:true,status:'installed_disabled',active:plan.active,due:plan.due,intervalSeconds:60};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await installExpiryWorker(process.argv.slice(2)))); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
