#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Ajv from 'ajv';
import { assert } from './safety.mjs';
import { createOwnerAccess } from './auth.mjs';
import { createStore } from './store.mjs';
import { createPlans } from './plans.mjs';
import { createBackend } from './backend.mjs';
import { createService } from './service.mjs';
import { createMcpServer } from './transport.mjs';
import { ACTIONS } from './actions.mjs';
import { DIRECT_ACTIONS, createDirect } from './direct.mjs';

let app, server;
let closing;
async function cleanup() {
  if (!closing) closing = (async () => { await server?.close(); if (app) await deleteApp(app); })();
  return closing;
}
try {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const credentialPath = '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json';
  const key = JSON.parse(await readFile(credentialPath, 'utf8'));
  assert(key.project_id === 'archive-pilates' && key.client_email === 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com',
    'CONFIG_INVALID', '기존 승인된 운영자 서비스 계정이 필요합니다.');
  assert(process.env.ARCHIVE_CORE_MCP_STAFF_ID === '1979746', 'CONFIG_INVALID', '지정된 기존 CORE 소유자 연결이 필요합니다.');
  app = initializeApp({ credential: cert(key), projectId: 'archive-pilates' });
  const db = getFirestore(app);
  const access = createOwnerAccess({ db, auth: getAuth(app), staffId: '1979746', configFile: path.join(root, 'core/firebase-config.js') });
  await access.owner();
  const plans = await createPlans(path.join(os.homedir(), 'ArchiveIN/operations/core-mcp'));
  const remote = createBackend({ access, endpoints: ACTIONS.map(a => a.name) });
  const direct = createDirect({ db, access });
  const directNames = new Set(DIRECT_ACTIONS.map(a => a.name));
  const invoke = (name, ...args) => directNames.has(name) ? direct(name, ...args) : remote(name, ...args);
  const ajv = new Ajv({ allErrors: false, strict: true });
  const validators = new Map();
  const service = createService({ access, store: createStore(db), plans, invoke,
    validate(name, args) { assert(validators.get(name)?.(args), 'INVALID_ARGUMENT', '도구 입력 형식을 확인하세요.'); } });
  for (const tool of service.listTools()) validators.set(tool.name, ajv.compile(tool.inputSchema));
  server = createMcpServer(service);
  const disconnect = () => { access.clear(); void cleanup().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', disconnect); process.once('SIGTERM', disconnect);
  process.stdin.once('end', disconnect); process.stdin.once('close', disconnect);
  await server.connect(new StdioServerTransport());
  server.onclose = disconnect;
} catch (error) {
  process.stderr.write(JSON.stringify(error?.safe ? { code: error.code, message: error.message }
    : { code: 'STARTUP_FAILED', message: 'CORE MCP 연결 실패. 인증값은 출력하지 않습니다.' }) + '\n');
  await cleanup(); process.exitCode = 1;
}
