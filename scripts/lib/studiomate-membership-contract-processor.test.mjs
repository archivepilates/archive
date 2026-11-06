import assert from 'node:assert/strict';
import test from 'node:test';
import { runStudioMateMembershipContractCandidates } from './studiomate-membership-contract-processor.mjs';
import { CONTRACT_SEAL_UPLOAD_POLICY } from './studiomate-contract-seal-upload.mjs';

const now = () => Date.parse('2026-11-06T01:00:00Z');
const base = { mode: 'live', sourcePromoted: true, nativeE2eVerified: true, studioId: '5330' };
const creationProof = { schemaVersion: 1, policy: 'studiomate_join_create_v1', source: 'studiomate_native_create',
  studioId: '5330', categoryId: 1, signType: 1, status: 'verified', contractId: 'c'.repeat(64),
  payloadHash: 'a'.repeat(64), createdAt: '2026-11-06T00:00:00.000Z', verifiedAt: '2026-11-06T00:01:00.000Z',
  independentReloadVerified: true, originalMemberAndPassesPreserved: true, termsUnchecked: true };
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

test('seal-only evidence cannot activate creation, and valid creation proof never dispatches an empty discovery', async () => {
  const prior = process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER;
  process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER = 'enabled';
  try {
    for (const proof of [undefined, false, { ...creationProof, status: 'pending' },
      { ...creationProof, originalMemberAndPassesPreserved: false }, creationProof]) {
      const config = { ...base, contractWriterEnabled: true,
        sealUploadVerification: { policy: CONTRACT_SEAL_UPLOAD_POLICY, status: 'verified', contractCreationVerified: false },
        ...(proof === undefined ? {} : { contractCreationVerification: proof }) };
      const result = await runStudioMateMembershipContractCandidates({ now,
        db: { doc: () => ({ get: async () => ({ data: () => config }) }) } });
      assert.equal(result.status, proof === creationProof ? 'idle' : 'review');
      if (proof !== creationProof) assert.equal(result.reason, 'contract_creation_e2e_required');
      assert.equal(result.studioMateWrites, 0);
    }
  } finally {
    if (prior === undefined) delete process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER;
    else process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER = prior;
  }
});
