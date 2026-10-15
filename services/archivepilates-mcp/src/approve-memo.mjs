#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { createApprovals } from './approvals.mjs';
import { id, requireValue, safeError } from './errors.mjs';
import { hash } from './service.mjs';

let input;
try {
  requireValue(process.stdin.isTTY && process.stdout.isTTY, 'HUMAN_CONFIRMATION_REQUIRED',
    '운영자가 직접 연 터미널에서 승인하세요. 자동 입력·파이프 승인은 허용하지 않습니다.');
  const proposalId = id(process.argv[2]);
  const approvals = await createApprovals(process.env.ARCHIVE_MCP_STATE_DIR
    || path.join(os.homedir(), 'ArchiveIN/automation/archivepilates-mcp'));
  const proposal = await approvals.getPending(proposalId, Date.now());
  process.stdout.write(`\n회원: ${proposal.memberName} (${proposal.maskedPhone})\n메모:\n${proposal.content}\n\n`);
  input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(`대상·내용을 확인했다면 approve ${proposalId} 입력: `);
  requireValue(answer === `approve ${proposalId}`, 'APPROVAL_REQUIRED', '승인하지 않았습니다.');
  await approvals.approve(proposalId, Date.now(), hash(proposal));
  process.stdout.write('계획 승인만 기록했습니다. MCP에서 memos_commit을 호출하면 기존 큐에 접수합니다.\n');
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`);
  process.exitCode = 1;
} finally { input?.close(); }
