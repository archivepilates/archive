import assert from 'node:assert/strict';
import test from 'node:test';
import { runStudioMateMembershipContractCandidates } from './studiomate-membership-contract-processor.mjs';
import { CONTRACT_SEAL_UPLOAD_POLICY } from './studiomate-contract-seal-upload.mjs';

const now = () => Date.parse('2026-11-06T01:00:00Z');
const base = { mode: 'live', sourcePromoted: true, nativeE2eVerified: true, studioId: '5330' };
test('historical E2E proof never enables a new seal route', async () => {
  const prior = process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER;
  process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER = 'enabled';
  try {
    for (const config of [{ ...base, contractWriterEnabled: false }, { ...base, contractWriterEnabled: true },
      { ...base, contractWriterEnabled: true, sealUploadVerification: { policy: CONTRACT_SEAL_UPLOAD_POLICY, status: 'pending' } }]) {
      const result = await runStudioMateMembershipContractCandidates({ now,
        db: { doc: path => { assert.equal(path, 'systemSettings/membershipContractAutomation');
          return { get: async () => ({ data: () => config }) }; } } });
      assert.equal(result.reason, 'contract_seal_upload_e2e_required');
      assert.equal(result.studioMateWrites, 0);
    }
  } finally {
    if (prior === undefined) delete process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER;
    else process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER = prior;
  }
});

test('verified route keeps explicitly paused writer disabled', async () => {
  const result = await runStudioMateMembershipContractCandidates({ now,
    db: { doc: () => ({ get: async () => ({ data: () => ({ ...base, contractWriterEnabled: false,
      sealUploadVerification: { policy: CONTRACT_SEAL_UPLOAD_POLICY, status: 'verified' } }) }) }) } });
  assert.equal(result.status, 'disabled');
  assert.equal(result.studioMateWrites, 0);
});
