import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const CONTRACT_SEAL_UPLOAD_POLICY = 'studiomate_temporary_center_seal_v1';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// Matches StudioMate's current rendered application's temporary-upload flow.
// Session credentials never follow the presigned image URL.
export async function uploadStudioMateCenterSeal({ api, contractId, seal, beforeStep,
  fetchImpl = globalThis.fetch, readBytes = readFile }) {
  if (!/^[a-f0-9]{64}$/.test(contractId || '') || typeof beforeStep !== 'function' ||
    typeof api?.get !== 'function' || typeof api?.patch !== 'function' ||
    !/^[a-f0-9]{64}$/.test(seal?.sha256 || '') || seal.mimeType !== 'image/png')
    throw new Error('contract_seal_upload_preflight_required');
  const bytes = await readBytes(seal.path);
  if (bytes.length !== seal.bytes || createHash('sha256').update(bytes).digest('hex') !== seal.sha256)
    throw new Error('contract_seal_file_changed');
  await beforeStep('reserve');
  const response = await api.get('/v2/staff/contract/signature/direct/temporary?' +
    new URLSearchParams({ contract_id_hash: contractId, signature_party: 'M', signature_method: 'upload' }));
  const data = response?.data || response;
  let url;
  try { url = new URL(data?.presigned_url); } catch { throw new Error('contract_seal_upload_target_invalid'); }
  const digitalId = String(data.digital_signature_id ?? ''), partyId = String(data.target_contract_party_id ?? '');
  const headers = data.headers;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    !/^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname) ||
    !url.searchParams.has('X-Amz-Signature') || data.method !== 'PUT' ||
    [data.digital_signature_id, data.target_contract_party_id].some(v => typeof v === 'number' && !Number.isSafeInteger(v)) ||
    !id(digitalId) || !id(partyId) || typeof data.upload_token !== 'string' || !data.upload_token ||
    !headers || typeof headers !== 'object' || Array.isArray(headers) ||
    Object.entries(headers).some(([key, value]) => !/^(content-type|x-amz-[a-z0-9-]+)$/i.test(key) ||
      typeof value !== 'string' || /[\r\n]/.test(value)) ||
    Object.entries(headers).some(([key, value]) => key.toLowerCase() === 'content-type' && value !== seal.mimeType))
    throw new Error('contract_seal_upload_target_invalid');
  await beforeStep('upload');
  let uploaded;
  try {
    uploaded = await fetchImpl(url.href, { method: 'PUT', headers, body: bytes,
      redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch { throw Object.assign(new Error('contract_seal_upload_outcome_unknown'), {
    method: 'PUT', ambiguous: true, errorKind: 'transport',
  }); }
  if (!uploaded.ok) throw Object.assign(new Error('contract_seal_upload_unconfirmed'), {
    method: 'PUT', status: uploaded.status, ambiguous: true, errorKind: 'http',
  });
  await beforeStep('finalize');
  await api.patch(`/v2/staff/contract/signature/direct/temporary/${digitalId}/${partyId}`,
    { upload_token: data.upload_token });
  // The caller must independently reload this exact contract before continuing.
  return { policy: CONTRACT_SEAL_UPLOAD_POLICY, contractId, sealSha256: seal.sha256 };
}
