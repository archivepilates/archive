import os from 'node:os';
import path from 'node:path';
import { id, requireValue } from './errors.mjs';

export function config(env = process.env) {
  const readOnly = env.ARCHIVE_MCP_READ_ONLY !== 'false';
  requireValue(!env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT === 'archive-pilates',
    'CONFIG_INVALID', 'Firebase 프로젝트는 archive-pilates여야 합니다.');
  requireValue(!env.GCLOUD_PROJECT || env.GCLOUD_PROJECT === 'archive-pilates',
    'CONFIG_INVALID', 'Firebase 프로젝트는 archive-pilates여야 합니다.');
  requireValue(!env.FIRESTORE_EMULATOR_HOST, 'CONFIG_INVALID', '운영 시작 명령에서 에뮬레이터 대체를 허용하지 않습니다.');
  requireValue(env.ARCHIVE_MCP_ENABLE_MEMO_WRITES !== 'true' || (!readOnly && env.ARCHIVE_MCP_MEMO_ROLLOUT === 'verified_v1'),
    'WRITE_DISABLED', '메모 쓰기는 원본·큐 제한 검증과 운영 승격 후에 활성화할 수 있습니다.');
  return { projectId: 'archive-pilates', staffId: id(env.ARCHIVE_MCP_OPERATOR_STAFF_ID),
    credentialPath: env.GOOGLE_APPLICATION_CREDENTIALS || path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json'),
    stateDir: env.ARCHIVE_MCP_STATE_DIR || path.join(os.homedir(), 'ArchiveIN/automation/archivepilates-mcp'),
    readOnly, memoWritesEnabled: !readOnly && env.ARCHIVE_MCP_ENABLE_MEMO_WRITES === 'true' };
}
