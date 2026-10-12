#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

// Local synthetic persistence only. SDK set/update parse real records; no SDK commit.
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const adapterPath = 'core/assets/sequence-store.js';
const baselineRevision = '708b863e6c7d88a31439d1f0e73649f4df11adaf';
const baseline = execFileSync('git', ['show', `${baselineRevision}:${adapterPath}`], { cwd: root });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
const fixed = await fs.readFile(path.join(root, adapterPath));
const files = new Map();
for (const name of ['core/sequence/studio.html', 'core/sequence/studio-ui.css', 'core/assets/ui-icons.js']) {
  files.set(`/${name}`, await fs.readFile(path.join(root, name)));
}
const output = await fs.mkdtemp(path.join(tmpdir(), 'sequence-cross-frame-save-'));
const results = [], blocked = [], modules = new Map(), contexts = new Set();
let server, browser, base;

// Executed in the outer window: SDK references, sentinels and parsers stay here.
function makeRuntime(sdk, db) {
  const records = new Map(), listeners = new Set(), constraints = new WeakMap();
  const audit = [], events = [];
  let clock = 1760000000000, tail = Promise.resolve();
  const controls = { fail: false, gate: null, audit, events, transactions: 0, commits: 0, realCommits: 0 };
  const realBatch = () => {
    const batch = sdk.writeBatch(db);
    batch.commit = () => { controls.realCommits++; throw Error('Real Firebase commit is forbidden'); };
    return batch;
  };
  const copy = value => {
    if (value instanceof sdk.Timestamp) return value;
    if (value instanceof sdk.FieldValue) return sdk.Timestamp.fromMillis(++clock);
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
    return value;
  };
  const snapshot = ref => ({ id: ref.id, ref, exists: () => records.has(ref.path), data: () => copy(records.get(ref.path)), metadata: { fromCache: false, hasPendingWrites: false } });
  const rows = ref => {
    const info = constraints.get(ref);
    let selected = [...records].filter(([key]) => key.startsWith(`${info.path}/`));
    for (const constraint of info.filters) {
      if (constraint.type === 'where') selected = selected.filter(([, data]) => data[constraint.field] === constraint.value);
      if (constraint.type === 'orderBy') selected.sort((a, b) => (a[1][constraint.field]?.toMillis() || 0) - (b[1][constraint.field]?.toMillis() || 0));
      if (constraint.type === 'limit') selected = selected.slice(-constraint.value);
    }
    return { docs: selected.map(([key]) => snapshot(sdk.doc(db, key))), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const deliver = listener => listener.next(constraints.has(listener.ref) ? rows(listener.ref) : snapshot(listener.ref));
  const broadcast = () => { for (const listener of listeners) deliver(listener); };
  const parse = (batch, method, ref, data) => {
    const entry = { method, path: ref.path, parentObject: data instanceof Object, nullPrototype: Object.getPrototypeOf(data) === null,
      serverTimestamp: data.updatedAt instanceof sdk.FieldValue, createdTimestamp: data.createdAt instanceof sdk.Timestamp };
    try {
      // Do not clone or normalize first: that would hide the foreign-realm defect.
      batch[method](ref, data);
      entry.accepted = true;
    } catch (error) {
      entry.accepted = false; entry.code = error.code; entry.error = error.message;
      throw error;
    } finally { audit.push(entry); }
  };
  const apply = writes => {
    for (const write of writes) {
      if (write.method === 'delete') records.delete(write.ref.path);
      else records.set(write.ref.path, write.method === 'update'
        ? { ...records.get(write.ref.path), ...copy(write.data) } : copy(write.data));
    }
    controls.commits++;
    events.push('mock-commit');
    broadcast();
  };
  const runtime = {
    db, doc: sdk.doc, collection: sdk.collection, serverTimestamp: sdk.serverTimestamp,
    authClient: { currentUser: { uid: 'synthetic-instructor' } },
    where: (field, op, value) => ({ type: 'where', field, op, value }),
    orderBy: field => ({ type: 'orderBy', field }), limit: value => ({ type: 'limit', value }),
    query: (ref, ...filters) => {
      const query = sdk.query(ref, ...filters.map(item => item.type === 'where' ? sdk.where(item.field, item.op, item.value)
        : item.type === 'orderBy' ? sdk.orderBy(item.field, 'desc') : sdk.limit(item.value)));
      constraints.set(query, { path: ref.path, filters }); return query;
    },
    getDocFromServer: async ref => snapshot(ref), getDocsFromServer: async ref => rows(ref),
    onSnapshot: (ref, _options, next) => {
      const listener = { ref, next }; listeners.add(listener); queueMicrotask(() => { if (listeners.has(listener)) deliver(listener); });
      return () => listeners.delete(listener);
    },
    runTransaction: async (_db, callback) => {
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
      controls.transactions++;
      const batch = realBatch(), writes = [];
      try {
        const value = await callback({
          get: async ref => { if (writes.length) throw Error('Read after write'); return snapshot(ref); },
          set: (ref, data) => { parse(batch, 'set', ref, data); writes.push({ method: 'set', ref, data }); },
          update: (ref, data) => { parse(batch, 'update', ref, data); writes.push({ method: 'update', ref, data }); },
        });
        if (controls.gate) { controls.gate.entered = true; await controls.gate.promise; }
        if (controls.fail) throw Error('Synthetic persistence failure after actual SDK parsing');
        apply(writes); return value;
      } finally { release(); }
    },
    writeBatch: () => {
      const batch = realBatch(), writes = [];
      return { delete: ref => { batch.delete(ref); writes.push({ method: 'delete', ref }); }, commit: async () => apply(writes) };
    },
  };
  return { runtime, controls, inspect: () => [...records].map(([key, data]) => [key, copy(data)]),
    seed: (id, state) => records.set(`sequenceNotes/${id}`, { ownerUid: runtime.authClient.currentUser.uid, revision: 1, deleted: false,
      createdAt: sdk.Timestamp.fromMillis(++clock), payload: JSON.stringify(state) }),
    control: (method, data) => parse(realBatch(), method, sdk.doc(db, 'sequenceNotes', 'parser-control'), data),
    hold: () => { let resolve; const promise = new Promise(done => { resolve = done; }); controls.gate = { promise, resolve, entered: false }; },
    release: () => { controls.gate.resolve(); controls.gate = null; },
  };
}

const style = `<style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;color:#222;background:#fff}header{display:flex;gap:12px;align-items:center;padding:8px;flex-wrap:wrap}h1{font-size:18px;margin:0}button{min-height:44px;font:inherit}#notice{padding:8px;overflow-wrap:anywhere}iframe{display:block;width:100%;height:calc(100dvh - 120px);border:0} [hidden]{display:none!important}</style>`;
function host(variant) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE IN isolated SDK fixture</title>${style}
    <header><h1>ARCHIVE IN SDK fixture</h1><button id="exit">Exit menu</button></header><div id="notice" role="status">Loading SDK</div>
    <iframe title="Sequence menu" data-testid="menu" src="/menu?variant=${variant}"></iframe><script type="module">
    import {initializeApp, deleteApp, SDK_VERSION} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
    import * as sdk from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
    const app=initializeApp({projectId:'sequence-cross-frame-fixture'},'isolated-parser');
    const db=sdk.getFirestore(app); window.fixture=(${makeRuntime.toString()})(sdk,db); window.fixture.sdkVersion=SDK_VERSION;
    window.fixture.control('set',{title:'parent-literal'}); window.fixture.control('update',{title:'parent-literal'});
    window.fixture.dispose=async()=>{await sdk.terminate(db);await deleteApp(app);};
    window.fixture.exited=false; document.getElementById('notice').textContent='Synthetic instructor; SDK parser only';
    document.getElementById('exit').onclick=async()=>{
      const frame=document.querySelector('iframe'); const editor=frame.contentDocument.querySelector('iframe').contentWindow;
      window.fixture.controls.events.push('prepare-start');
      const ok=await editor.archiveSequenceNavigation.prepare(); window.fixture.controls.events.push(ok?'prepare-ok':'prepare-failed');
      if(!ok){document.getElementById('notice').textContent='Save failed; menu exit blocked';return;}
      window.fixture.controls.events.push('exit');window.fixture.exited=true;frame.remove();document.getElementById('notice').textContent='Menu exited after flush';
    };
    </script>`;
}
function menu(variant) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${style}<iframe title="Sequence editor" data-testid="editor" data-sequence-studio data-auth-ready="true"></iframe>
    <script type="module">import {createSequenceStore} from '/adapter-${variant}.js';
    await new Promise(resolve=>{if(window.parent.fixture)return resolve();window.parent.addEventListener('fixture-ready',resolve,{once:true});});
    const fixture=window.parent.fixture;window.archiveSequenceStore=createSequenceStore(fixture.runtime,fixture.runtime.authClient.currentUser);
    window.foreignControl=method=>{try{fixture.control(method,{title:'foreign-literal'});return null;}catch(error){return {code:error.code,message:error.message};}};
    document.querySelector('iframe').src='/core/sequence/studio.html';</script>`;
}

async function ready(page, variant) {
  await page.goto(`${base}/?variant=${variant}`);
  await page.waitForFunction(() => !!window.fixture);
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-ready')));
  const frame = await page.getByTestId('menu').elementHandle();
  const menuFrame = await frame.contentFrame();
  await menuFrame.waitForFunction(() => !!window.archiveSequenceStore);
  const editorHandle = await menuFrame.getByTestId('editor').elementHandle();
  const editor = await editorHandle.contentFrame();
  await editor.waitForFunction(() => !!window.ARCHIVE_TEST && !document.getElementById('title').disabled);
  assert.equal(await page.evaluate(() => fixture.sdkVersion), '10.14.1');
  assert.equal(await menuFrame.evaluate(() => window.parent.Object !== Object), true);
  return { menuFrame, editor };
}
async function sample(editor, id, image = false) {
  return editor.evaluate(({ id, image }) => {
    const state = ARCHIVE_TEST.sample(); state.id = id; state.title = 'Synthetic cross-frame note'; state.teacher = 'Synthetic instructor';
    state.moves.main = []; state.moves.cool = [];
    if (image) { const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16); state.moves.warm[0].image = canvas.toDataURL('image/jpeg'); }
    ARCHIVE_TEST.setState(state); return ARCHIVE_TEST.getState();
  }, { id, image });
}
const flush = editor => editor.evaluate(() => ARCHIVE_TEST.flush());
const evidence = page => page.evaluate(() => ({ audit: fixture.controls.audit, transactions: fixture.controls.transactions,
  commits: fixture.controls.commits, realCommits: fixture.controls.realCommits, events: fixture.controls.events, records: fixture.inspect() }));
async function backup(page, editor, name) {
  const before = await evidence(page);
  const state = await editor.evaluate(() => ARCHIVE_TEST.getState());
  const downloaded = page.waitForEvent('download');
  await editor.getByRole('button', { name: '작성 내용 백업', exact: true }).click();
  const download = await downloaded;
  const target = path.join(output, `${name}.json`); await download.saveAs(target);
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), state);
  const after = await evidence(page);
  assert.equal(after.transactions, before.transactions, 'Backup must not start a save');
  assert.equal(after.commits, before.commits, 'Backup must not persist');
  assert.deepEqual(after.records, before.records, 'Backup must not change synthetic server data');
  assert.equal(await editor.evaluate(() => ARCHIVE_TEST.dirty()), true);
  return target;
}
async function baselineCheck(page, editor, menuFrame, name) {
  for (const method of ['set', 'update']) {
    const result = await menuFrame.evaluate(method => window.foreignControl(method), method);
    assert.equal(result.code, 'invalid-argument'); assert.match(result.message, /custom Object/);
  }
  const state = await sample(editor, 'old_plain');
  assert.equal(await flush(editor), false);
  assert.match((await evidence(page)).audit.at(-1).error, /custom Object/);
  await page.getByRole('button', { name: 'Exit menu', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('exit blocked'));
  assert.equal(await page.evaluate(() => fixture.exited), false);
  assert.deepEqual(await editor.evaluate(() => ARCHIVE_TEST.getState()), state);
  const screenshot = path.join(output, `${name}-foreign-object.png`); await page.screenshot({ path: screenshot, fullPage: true });
  const download = await backup(page, editor, `${name}-unsaved-backup`);
  await sample(editor, 'old_image', true); assert.equal(await flush(editor), false);
  const imageFailure = (await evidence(page)).audit.at(-1);
  assert.match(imageFailure.path, /^sequenceNoteImages\//); assert.match(imageFailure.error, /custom Object/);
  await page.evaluate(() => fixture.seed('old_remove', { id: 'old_remove', moves: {} }));
  const removal = await menuFrame.evaluate(async () => {
    try { await archiveSequenceStore.remove('old_remove', 1); return null; } catch (error) { return { code: error.code, message: error.message }; }
  });
  assert.equal(removal.code, 'invalid-argument'); assert.match(removal.message, /custom Object/);
  const outcome = await evidence(page); assert.equal(outcome.commits, 0); assert.equal(outcome.realCommits, 0);
  return { screenshot, download, noImageFailure: outcome.audit.find(item => item.path === 'sequenceNotes/old_plain' && !item.accepted), imageFailure, removal, outcome };
}
async function fixedCheck(page, editor, menuFrame, name) {
  const saves = [];
  for (const withImage of [false, true]) {
    const id = withImage ? 'fixed_image' : 'fixed_plain';
    const state = await sample(editor, id, withImage); assert.equal(await flush(editor), true);
    const created = await menuFrame.evaluate(id => archiveSequenceStore.get(id), id);
    assert.deepEqual(created.state, state); assert.equal(created.revision, 1);
    await editor.evaluate(() => { const state = ARCHIVE_TEST.getState(); state.goal = 'Edited synthetic goal'; ARCHIVE_TEST.setState(state); });
    assert.equal(await flush(editor), true);
    const edited = await menuFrame.evaluate(id => archiveSequenceStore.get(id), id);
    assert.equal(edited.revision, 2); assert.equal(edited.state.goal, 'Edited synthetic goal');
    saves.push({ id, withImage, revision: edited.revision });
    await menuFrame.evaluate(({ id }) => archiveSequenceStore.remove(id, 2), { id });
    const record = (await evidence(page)).records.find(([key]) => key === `sequenceNotes/${id}`)[1];
    assert.equal(record.deleted, true); assert.equal(record.revision, 3);
    assert.equal((await evidence(page)).records.filter(([key]) => key.startsWith(`sequenceNoteImages/${id}_`)).length, 0);
    // Reopen the editor after removal to clear its intentional remote-delete conflict.
    await editor.goto(`${base}/core/sequence/studio.html`);
    await editor.waitForFunction(() => !!window.ARCHIVE_TEST && !document.getElementById('title').disabled);
  }
  await page.evaluate(() => { fixture.controls.fail = true; });
  const retryState = await sample(editor, 'fixed_retry', true);
  await page.getByRole('button', { name: 'Exit menu', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('exit blocked'));
  assert.equal(await page.evaluate(() => fixture.exited), false);
  assert.equal(await editor.evaluate(() => ARCHIVE_TEST.dirty()), true);
  assert.deepEqual(await editor.evaluate(() => ARCHIVE_TEST.getState()), retryState);
  assert.ok(!(await evidence(page)).records.some(([key]) => key.includes('fixed_retry')));
  const screenshot = path.join(output, `${name}-failed-save-backup.png`); await page.screenshot({ path: screenshot, fullPage: true });
  const download = await backup(page, editor, `${name}-unsaved-backup`);
  await page.evaluate(() => { fixture.controls.fail = false; fixture.hold(); });
  await page.getByRole('button', { name: 'Exit menu', exact: true }).click();
  await page.waitForFunction(() => fixture.controls.gate?.entered === true);
  assert.equal(await page.evaluate(() => fixture.exited), false, 'Exit waits for acknowledged persistence');
  assert.equal(await editor.evaluate(() => ARCHIVE_TEST.dirty()), true);
  await page.evaluate(() => fixture.release());
  await page.waitForFunction(() => fixture.exited === true);
  const outcome = await evidence(page);
  const saved = outcome.records.find(([key]) => key === 'sequenceNotes/fixed_retry')[1];
  assert.equal(saved.revision, 1); assert.equal(saved.title, retryState.title);
  assert.equal(outcome.events.at(-1), 'exit'); assert.deepEqual(outcome.events.slice(-3), ['mock-commit', 'prepare-ok', 'exit']);
  assert.equal(outcome.realCommits, 0);
  const writes = outcome.audit.filter(item => !item.path.endsWith('parser-control'));
  assert.ok(writes.every(item => item.accepted), 'Every transaction record must pass the actual SDK parser');
  assert.ok(writes.some(item => item.method === 'set' && item.path.startsWith('sequenceNoteImages/')));
  assert.ok(writes.some(item => item.method === 'update'));
  assert.ok(writes.some(item => item.createdTimestamp), 'Existing SDK Timestamp survives edit');
  assert.ok(writes.filter(item => item.path.startsWith('sequenceNotes/')).every(item => item.serverTimestamp), 'Real serverTimestamp sentinel survives');
  const exitScreenshot = path.join(output, `${name}-flushed-exit.png`); await page.screenshot({ path: exitScreenshot, fullPage: true });
  return { saves, screenshot, download, exitScreenshot, outcome };
}

try {
  assert.notEqual(hash(baseline), hash(fixed), 'Fixed adapter must differ from the pinned prepatch baseline');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); const variant = url.searchParams.get('variant') === 'baseline' ? 'baseline' : 'fixed';
    let body, type = 'text/html; charset=utf-8';
    if (url.pathname === '/') body = host(variant);
    else if (url.pathname === '/menu') body = menu(variant);
    else if (url.pathname === '/adapter-baseline.js') { body = baseline; type = 'text/javascript'; }
    else if (url.pathname === '/adapter-fixed.js') { body = fixed; type = 'text/javascript'; }
    else if (files.has(url.pathname)) { body = files.get(url.pathname); type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'text/javascript' : type; }
    else if (/^\/core\/(icons\/|favicon\.ico|site\.webmanifest)/.test(url.pathname) || url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    browser = await launcher.launch({ headless: true });
    try {
      for (const width of [320, 390, 768, 1440]) for (const variant of ['baseline', 'fixed']) {
        const name = `${engine}-${width}-${variant}`, pendingModules = new Set();
        const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
        contexts.add(context); let page;
        try {
          await context.route('**/*', route => {
            const request = route.request(), url = new URL(request.url());
            const local = url.origin === base;
            const officialStatic = url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/10\.14\.1\/firebase-[a-z-]+\.js$/.test(url.pathname);
            if (request.method() === 'GET' && (local || officialStatic)) return route.continue();
            blocked.push({ test: name, url: request.url(), method: request.method() }); return route.abort('blockedbyclient');
          });
          await context.routeWebSocket('**/*', socket => { blocked.push({ test: name, websocket: socket.url() }); socket.close(); });
          page = await context.newPage(); const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
          page.on('response', response => {
            if (!response.url().startsWith('https://www.gstatic.com/firebasejs/10.14.1/')) return;
            const task = response.body().then(bytes => modules.set(response.url(), hash(bytes))).finally(() => pendingModules.delete(task));
            pendingModules.add(task);
          });
          const { editor, menuFrame } = await ready(page, variant);
          const details = variant === 'baseline' ? await baselineCheck(page, editor, menuFrame, name) : await fixedCheck(page, editor, menuFrame, name);
          assert.deepEqual(pageErrors, []);
          await Promise.all([...pendingModules]);
          results.push({ name, status: 'passed', ...details }); console.log(`PASS ${name}`);
        } catch (error) {
          const screenshot = path.join(output, `${name}-unexpected-failure.png`);
          if (page && !page.isClosed()) await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
          results.push({ name, status: 'failed', error: error.stack, screenshot }); console.error(`FAIL ${name}: ${error.message}`);
          throw error;
        } finally {
          if (page && !page.isClosed()) await page.evaluate(async () => { fixture?.controls.gate?.resolve(); await window.fixture?.dispose(); }).catch(() => {});
          await Promise.allSettled([...pendingModules]); await context.close(); contexts.delete(context);
        }
      }
    } finally { await browser.close(); browser = null; }
  }
} finally {
  for (const context of contexts) await context.close(); contexts.clear();
  if (browser) await browser.close();
  if (server?.listening) await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  const report = { head, baselineRevision, sources: { baselineGitBlob: execFileSync('git', ['rev-parse', `${baselineRevision}:${adapterPath}`], { cwd: root }).toString().trim(),
    baselineSHA256: hash(baseline), fixedSHA256: hash(fixed), ...Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])) },
    sdkVersion: '10.14.1', sdkModules: Object.fromEntries(modules), output, results, blocked,
    limits: ['Synthetic instructor identity only; no authenticated roles or security-rule verification.',
      'Actual adapter and studio in two nested frames; outer menu exit is a small fixture, not the full CORE navigation shell.',
      'Actual Firebase writeBatch set/update parsing only; persistence, reads and snapshots are synthetic in-memory fixtures.',
      'No Firebase/Auth/API network allowed; only official gstatic 10.14.1 static modules and localhost GETs.',
      'Local-only. No accounts, credentials, production data, deployment, commit or push.'],
    cleanup: { openContexts: contexts.size, browserClosed: !browser || !browser.isConnected(), serverClosed: !server?.listening } };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  await fs.writeFile(path.join(output, 'report.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE IN cross-frame SDK regression</title><style>body{font:16px system-ui;margin:24px;max-width:1000px}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto}li{margin:8px 0}</style><h1>ARCHIVE IN cross-frame SDK regression</h1><p>Local-only synthetic persistence. Actual Firebase 10.14.1 parser.</p><ul>${results.map(result => `<li>${escape(result.status)} ${escape(result.name)}${result.screenshot ? ` <a href="${escape(path.basename(result.screenshot))}">screenshot</a>` : ''}${result.download ? ` <a href="${escape(path.basename(result.download))}">backup</a>` : ''}</li>`).join('')}</ul><pre>${escape(JSON.stringify({ ...report, results: results.map(({ outcome, ...result }) => result) }, null, 2))}</pre>`);
  console.log(JSON.stringify({ output, passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length, sources: report.sources, cleanup: report.cleanup }, null, 2));
  if (results.length !== 16 || results.some(result => result.status === 'failed') || blocked.length) process.exitCode = 1;
}
