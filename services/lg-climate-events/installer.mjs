import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG_PATH, NODE, RUNTIME, fault } from './config.mjs';
import { loadConfiguration, loadTlsMaterial, readPrivateFile } from './runtime.mjs';

export const LABEL = 'com.archive.lg-climate-events';

export function guardRuntime({ root, run = execFileSync, realpath = fs.realpathSync }) {
  if (root !== RUNTIME || realpath(root) !== RUNTIME) throw fault('RUNTIME_GUARD');
  const git = args => run('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  if (git(['rev-parse', '--show-toplevel']) !== RUNTIME || git(['status', '--porcelain'])
    || git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) throw fault('RUNTIME_GUARD');
  const version = run(NODE, ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (!/^v(?:2[2-9]|[3-9]\d)\./.test(version)) throw fault('RUNTIME_GUARD');
}

export function validateActivation(configFile = CONFIG_PATH) {
  const config = loadConfiguration(configFile);
  loadTlsMaterial(config);
  let credentials;
  try { credentials = JSON.parse(readPrivateFile(config.firebaseCredentialPath, { privateMode: true })); }
  catch { throw fault('CREDENTIAL_READ_FAILED'); }
  if (credentials.project_id !== 'archive-pilates'
    || credentials.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com') throw fault('FIREBASE_IDENTITY');
}

export function installReceiver({ root, mode, run = execFileSync, guard = guardRuntime,
  validate = validateActivation, home = '/Users/archivepilates', uid = process.getuid() }) {
  if (!['--prepare', '--apply'].includes(mode)) throw fault('INSTALL_ARGUMENTS');
  guard({ root, run });
  const source = path.join(root, 'ops/launchagents', `${LABEL}.plist`);
  run('plutil', ['-lint', source], { stdio: 'pipe' });
  if (mode === '--prepare') return { prepared: true, installed: false, credentialsChecked: false };
  // All credential checks precede mkdir, npm, plist copying, or launchctl bootstrap.
  validate();
  const domain = `gui/${uid}`;
  let loaded = false;
  try { run('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'pipe' }); loaded = true; }
  catch (error) { if (error.status !== 113) throw fault('INSTALL_FAILED'); }
  if (loaded) throw fault('INSTALL_ALREADY_LOADED');
  run('/opt/homebrew/bin/npm', ['ci', '--prefix', path.join(root, 'services/lg-climate-events'),
    '--ignore-scripts', '--no-fund', '--no-audit', '--registry=https://registry.npmjs.org',
    '--userconfig=/dev/null', '--globalconfig=/nonexistent-lg-climate-events-global-npmrc'], {
    cwd: root, stdio: 'pipe', env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: home },
  });
  for (const directory of ['logs', 'locks', 'state']) {
    fs.mkdirSync(path.join(home, 'ArchiveIN/automation', directory), { recursive: true, mode: 0o700 });
  }
  const destination = path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination); fs.chmodSync(destination, 0o600);
  run('launchctl', ['bootstrap', domain, destination], { stdio: 'pipe' });
  run('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'pipe' });
  return { prepared: true, installed: true, credentialsChecked: true };
}
