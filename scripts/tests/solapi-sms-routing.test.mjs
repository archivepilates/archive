import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
for (const file of ['lib/instructor-signature-reminder-runtime.mjs',
  'process-studiomate-membership-contract-completions.mjs', 'process-studiomate-refund-sms-jobs.mjs']) {
  test('active ordinary text transport is SOLAPI only: ' + file, () => {
    const source = read(file);
    assert.match(source, /import \{[^}]*sendMemberSms[^}]*\} from ['"].*member-sms-solapi\.mjs['"]/);
    assert.doesNotMatch(source, /import .*sendContractReminderSms|await confirmation\.getByRole/);
    assert.match(source, /acquireStudioMateBrowserLock|releaseLock/);
  });
}
test('transport policy preserves native contract invitations and existing schedules', () => {
  assert.match(read('lib/studiomate-native-contract-writer.mjs'), /contract\/signature\/request\/sms/);
  assert.match(read('process-eformsign-instructor-member-jobs.mjs'), /useSms/);
  assert.match(read('process-eformsign-refund-jobs.mjs'), /useSms/);
  assert.match(read('lib/contract-signature-reminder-browser.mjs'), /member_sms_studiomate_transport_disabled/);
  assert.doesNotMatch(read('lib/contract-signature-reminder-browser.mjs'), /await page\.|await confirmation\./);
});
test('LaunchAgent credential lookup is absolute and private configuration never contains API secrets', () => {
  const source = read('lib/member-sms-solapi.mjs');
  assert.match(source, /gcloudPath: '\/opt\/homebrew\/bin\/gcloud'/);
  assert.match(source, /stat\.isFile\(\).*stat\.isSymbolicLink\(\)/);
  assert.match(source, /member-sms-solapi\.json/);
  assert.doesNotMatch(source, /SOLAPI_API_KEY\s*=|SOLAPI_API_SECRET\s*=/);
});
