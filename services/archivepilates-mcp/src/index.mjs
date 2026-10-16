#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.mjs';
import { createStore } from './store.mjs';
import { createApprovals } from './approvals.mjs';
import { createService } from './service.mjs';
import { createMcpServer } from './transport.mjs';
import { requireValue, safeError } from './errors.mjs';
import { createLiveReader } from './live-browser.mjs';
import { createTargetValidator } from './target-validator.mjs';

let app, server, liveReader;
let appCleanup;
function cleanupApp() {
  if (!appCleanup) {
    const current = app;
    app = null;
    appCleanup = current ? deleteApp(current) : Promise.resolve();
  }
  return appCleanup;
}
try {
  const settings = config();
  const key = JSON.parse(await readFile(settings.credentialPath, 'utf8'));
  requireValue(key.project_id === settings.projectId && key.client_email === 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com',
    'CONFIG_INVALID', '승인된 archive-pilates 서비스 계정 연결이 필요합니다.');
  app = initializeApp({ credential: cert(key), projectId: settings.projectId });
  const db = getFirestore(app);
  const approvals = await createApprovals(settings.stateDir);
  liveReader = createLiveReader();
  const service = createService({ store: createStore(db, Timestamp), approvals,
    staffId: settings.staffId, memoWritesEnabled: settings.memoWritesEnabled, readOnly: settings.readOnly, liveReader,
    targetValidator: createTargetValidator({ credentialPath: settings.credentialPath }) });
  server = createMcpServer(service);
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await liveReader.close(); await server.close(); await cleanupApp(); };
  const disconnect = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', disconnect);
  process.once('SIGTERM', disconnect);
  process.stdin.once('end', disconnect);
  process.stdin.once('close', disconnect);
  // stdout belongs exclusively to MCP JSON-RPC; no credentials or payload diagnostics are printed.
  await server.connect(new StdioServerTransport());
  server.onclose = () => { void liveReader.close().finally(cleanupApp).catch(() => { process.exitCode = 1; }); };
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`);
  await cleanupApp();
  process.exitCode = 1;
}
