import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { id, requireValue } from './errors.mjs';
import { hash } from './service.mjs';

export async function createApprovals(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0, 'LOCAL_STATE_UNSAFE', '로컬 승인 폴더 소유자·권한을 확인해 주세요.');
  const file = (proposalId, suffix) => path.join(directory, `${id(proposalId)}.${suffix}.json`);
  async function read(proposalId, suffix) {
    const filename = file(proposalId, suffix);
    let stat;
    try { stat = await lstat(filename); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0 && stat.size < 16000, 'LOCAL_STATE_UNSAFE', '승인 파일 소유자·권한을 확인해 주세요.');
    return JSON.parse(await readFile(filename, 'utf8'));
  }
  async function write(proposalId, suffix, value) {
    await writeFile(file(proposalId, suffix), JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  async function pending(proposalId, now) {
    const value = await read(proposalId, 'proposal');
    requireValue(value && value.proposalId === proposalId && value.version === 1 && value.action === 'append_member_memo'
      && value.issuedAt <= now && value.expiresAt > now && value.expiresAt - value.issuedAt === 600000,
    'PROPOSAL_EXPIRED', '계획이 없거나 만료됐습니다. 다시 준비해 주세요.');
    return value;
  }
  return {
    async prepare(input, now) {
      const value = { ...input, version: 1, action: 'append_member_memo', proposalId: randomUUID(),
        jobId: `mcp_memo_${hash(['5330', input.memberId, input.content]).slice(0, 40)}`,
        issuedAt: now, expiresAt: now + 600000 };
      await write(value.proposalId, 'proposal', value);
      return { proposalId: value.proposalId, memberId: value.memberId, memberName: value.memberName,
        maskedPhone: value.maskedPhone, content: value.content, expiresAt: new Date(value.expiresAt).toISOString() };
    },
    getPending: pending,
    async approve(proposalId, now, displayedHash) {
      const value = await pending(proposalId, now);
      requireValue(typeof displayedHash === 'string' && displayedHash === hash(value),
        'SOURCE_CHANGED', '확인 화면을 연 뒤 계획이 변경됐습니다. 내용을 다시 확인해 주세요.');
      await write(proposalId, 'approval', { proposalHash: hash(value), staffId: value.staffId, approvedAt: now,
        method: 'local_operator_terminal' });
    },
    async loadApproved(proposalId, staffId, now) {
      const value = await pending(proposalId, now);
      const approval = await read(proposalId, 'approval');
      requireValue(approval && approval.method === 'local_operator_terminal' && approval.proposalHash === hash(value)
        && value.staffId === staffId && approval.staffId === staffId && approval.approvedAt >= value.issuedAt
        && approval.approvedAt <= now, 'APPROVAL_REQUIRED', '운영자 터미널에서 대상·메모 내용을 직접 승인해야 합니다.');
      return value;
    },
  };
}
