import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { archiveAutomationRoot, canonicalAutomationPath } from '../../scripts/lib/archive-automation-paths.mjs';
import { loadConfig } from '../../scripts/run-imweb-referral-worker.mjs';
import { readOperatorIdentities } from '../../scripts/lib/lesson-share-operator-identities.mjs';
import { MEMBER_SMS_CONFIG_PATH } from '../../scripts/lib/member-sms-solapi.mjs';
import { rewriteAutomationPaths } from './policy.mjs';

const root = archiveAutomationRoot();
if (root !== '/Users/archivepilates/archive-automation') throw Error('Migration not verified');
const audit = path.join(root, 'operations/2026-11-19-automation-root-migration');
const plan = JSON.parse(fs.readFileSync(path.join(audit, 'migration-plan.json'), 'utf8'));
const migration = JSON.parse(fs.readFileSync(path.join(audit, 'migration-result.json'), 'utf8'));
if (migration.status !== 'verified' || !migration.identityPreserved) throw Error('Incomplete migration');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw Error(`${path.basename(command)} verification failed`);
  return result.stdout;
};
const plist = file => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
const jobs = plan.jobs.map(job => {
  const before = plist(path.join(audit, 'plist-backups', job.name));
  const after = plist(path.join('/Users/archivepilates/Library/LaunchAgents', job.name));
  if (!isDeepStrictEqual(after, rewriteAutomationPaths(before, plan.oldRoot, root))) throw Error('Unexpected plist change');
  const loaded = run('/bin/launchctl', ['print', `gui/${process.getuid()}/${after.Label}`]);
  return { label: after.Label, loaded: true, configurationExact: true,
    state: loaded.match(/^\s*state = (.+)$/m)?.[1] || null,
    pid: loaded.match(/^\s*pid = (\d+)$/m)?.[1] || null,
    lastExitCode: loaded.match(/^\s*last exit code = (.+)$/m)?.[1] || null,
    baselineLastExitCode: job.baseline.lastExitCode };
});
const referral = loadConfig(path.join(plan.oldRoot, 'automation/referral-production/config.json'), { apply: true });
if (!referral.ledgerPath.startsWith(root + '/') || !referral.backupDir.startsWith(root + '/')) throw Error('Referral paths not canonical');
const registry = readOperatorIdentities();
JSON.parse(fs.readFileSync(MEMBER_SMS_CONFIG_PATH, 'utf8'));
const keyFile = path.join(root, 'secrets/google/archive-codex-operator.json');
const credential = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
if (credential.client_email !== 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com') throw Error('Unexpected credential identity');
const report = { checkedAt: new Date().toISOString(), canonicalRoot: root,
  compatibilityAlias: fs.realpathSync(plan.oldRoot) === root,
  criticalIdentitiesPreserved: plan.protectedPaths.every(item => {
    const stat = fs.statSync(path.join(root, item.path));
    return stat.ino === item.ino && stat.dev === item.dev && stat.mode === item.mode && stat.uid === item.uid && stat.gid === item.gid;
  }), jobs, referralConfigurationReadable: true, identityRegistryState: registry ? 'validated' : 'not_configured', smsConfigurationReadable: true,
  legacyCredentialPathCanonical: canonicalAutomationPath(path.join(plan.oldRoot, 'secrets/google/archive-codex-operator.json')) === keyFile,
  providerDispatchPerformed: false, manualQueueRun: false };
if (process.argv.includes('--online')) {
  const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
  const { GoogleAuth } = require('google-auth-library');
  const client = await new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/datastore'] }).getClient();
  const response = await client.request({ url: 'https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/systemSettings/membershipContractAutomation', method: 'GET' });
  report.existingFirestoreReadStatus = response.status;
}
if (!report.criticalIdentitiesPreserved) throw Error('Critical path identity changed');
fs.writeFileSync(path.join(audit, 'post-migration-verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
