import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const sourceUrl = new URL('../provision-imweb-oauth-connection.mjs', import.meta.url);
const functionsRoot = new URL('../../firebase/kangsain-functions/functions/', import.meta.url);
const ts = createRequire(new URL('package.json', functionsRoot))('typescript');
const compiled = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  transformers: { before: [context => node => {
    const visit = value => ts.isPropertyAccessExpression(value) && ts.isMetaProperty(value.expression) &&
      value.expression.keywordToken === ts.SyntaxKind.ImportKeyword && value.name.text === 'url'
      ? ts.factory.createStringLiteral(sourceUrl.href) : ts.visitEachChild(value, visit, context);
    return ts.visitNode(node, visit);
  }] },
}).outputText;

const HOME = '/synthetic-imweb-provision-home';
const DIR = path.join(HOME, 'Library/Application Support/ARCHIVE PILATES/imweb-app-onboarding');
const file = name => path.join(DIR, name);
const HANDOFF_FILES = ['private.pem', 'public.pem', 'credential-handoff.enc'];
const RECEIPT = file('secret-provision-receipt.json');
const RESOURCE = 'projects/archive-pilates/secrets/IMWEB_APP_OAUTH_CONNECTION';
const VERSION = `${RESOURCE}/versions/1`;
const OPERATOR_PATH = '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json';
const OPERATOR = { project_id: 'archive-pilates',
  client_email: 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com',
  private_key: 'synthetic-operator-key-not-real' };
const HANDOFF = { clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret-not-real' };
const validReceipt = () => ({ resource: VERSION, appCode: 'ga202609279410fb87e608a',
  createdAt: '2026-10-22T00:00:00.000Z', plaintextStoredLocally: false });

function fixture(options = {}) {
  const initial = new Map(HANDOFF_FILES.map(name => [file(name), name === 'credential-handoff.enc'
    ? Buffer.from('synthetic-encrypted-handoff').toString('base64') : `synthetic-${name}`]));
  const files = new Map(initial);
  if (options.existingReceipt) files.set(RECEIPT, JSON.stringify(validReceipt()));
  const operations = [], fetchCalls = [], plaintextBuffers = [], logs = [];
  let certCalls = 0, decryptCalls = 0, randomCalls = 0, exitCalls = 0;
  const exitSignal = Object.freeze({ syntheticExit: true });
  const allowed = target => {
    assert.ok(target === DIR || target === OPERATOR_PATH || target.startsWith(`${DIR}/`),
      'unexpected mocked filesystem path');
  };
  const fs = {
    mkdirSync(target, settings) {
      assert.equal(target, DIR);
      assert.equal(settings.mode, 0o700);
    },
    lstatSync(target) {
      allowed(target);
      if (target !== DIR && !files.has(target)) throw Error('synthetic_missing_file');
      return { uid: 501, mode: target === DIR ? 0o40700 : 0o100600,
        isDirectory: () => target === DIR, isFile: () => target !== DIR, isSymbolicLink: () => false };
    },
    existsSync(target) { allowed(target); return files.has(target); },
    readFileSync(target, encoding) {
      allowed(target);
      assert.equal(encoding, 'utf8');
      if (target === OPERATOR_PATH) return JSON.stringify(OPERATOR);
      assert.ok(files.has(target), 'mocked read requires an existing file');
      return files.get(target);
    },
    writeFileSync(target, value, settings) {
      assert.equal(target, RECEIPT);
      assert.equal(settings.flag, 'wx');
      assert.equal(settings.mode, 0o600);
      assert.equal(files.has(target), false);
      if (options.receiptFailure === 'partial') {
        files.set(target, String(value).slice(0, 12));
        operations.push('partial-receipt');
        throw Error('synthetic_receipt_write_failed');
      }
      if (options.receiptFailure) throw Error('synthetic_receipt_write_failed');
      files.set(target, String(value));
      operations.push('receipt-written');
    },
    unlinkSync(target) {
      allowed(target);
      assert.ok(files.has(target));
      files.delete(target);
      operations.push(`unlink:${path.basename(target)}`);
    },
  };
  const imports = {
    'node:fs': fs,
    'node:os': { homedir: () => HOME },
    'node:path': path,
    'node:crypto': {
      constants: { RSA_PKCS1_OAEP_PADDING: 4 },
      generateKeyPairSync() { throw Error('unexpected_key_generation'); },
      privateDecrypt(settings, ciphertext) {
        decryptCalls++;
        assert.equal(settings.key, initial.get(file('private.pem')));
        assert.equal(settings.oaepHash, 'sha256');
        assert.equal(settings.padding, 4);
        assert.equal(ciphertext.toString(), 'synthetic-encrypted-handoff');
        const plaintext = Buffer.from(options.invalidHandoff ? 'invalid-synthetic-json' : JSON.stringify(HANDOFF));
        plaintextBuffers.push(plaintext);
        return plaintext;
      },
      randomBytes(size) { randomCalls++; assert.equal(size, 32); return Buffer.alloc(size, 23); },
    },
    'node:module': { createRequire: () => id => {
      assert.equal(id, 'firebase-admin/app');
      return { cert(operator) {
        certCalls++;
        assert.equal(JSON.stringify(operator), JSON.stringify(OPERATOR));
        if (options.certFailure) throw Error('synthetic_cert_failure');
        return { getAccessToken: async () => ({ access_token: 'synthetic-operator-access-not-real' }) };
      } };
    } },
  };
  const context = vm.createContext({ exports: {}, Buffer, URL,
    require: id => { assert.ok(Object.hasOwn(imports, id), 'unmocked import prohibited'); return imports[id]; },
    process: { argv: ['synthetic-node', sourceUrl.pathname, '--store-approved-connection'], getuid: () => 501,
      exit(code) { assert.equal(code, 0); exitCalls++; throw exitSignal; } },
    AbortSignal: { timeout(ms) { assert.equal(ms, 30_000); return 'synthetic-timeout'; } },
    console: { log: value => logs.push(JSON.parse(value)) },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      assert.equal(init.headers.Authorization, 'Bearer synthetic-operator-access-not-real');
      assert.equal(init.signal, 'synthetic-timeout');
      const index = fetchCalls.length;
      if (index === 1) {
        assert.equal(url, `https://secretmanager.googleapis.com/v1/${RESOURCE}`);
        return { status: 404, ok: false };
      }
      assert.equal(init.method, 'POST');
      if (index === 2) {
        assert.equal(url, 'https://secretmanager.googleapis.com/v1/projects/archive-pilates/secrets?secretId=IMWEB_APP_OAUTH_CONNECTION');
        return { ok: true, json: async () => ({ name: RESOURCE }) };
      }
      assert.equal(index, 3, 'unexpected additional mock request');
      assert.equal(url, `https://secretmanager.googleapis.com/v1/${RESOURCE}:addVersion`);
      if (options.addVersionFailure) return { status: 503, ok: false };
      return { ok: true, json: async () => ({ name: VERSION }) };
    },
  });
  // Only the source reader above reaches disk; all script I/O and credentials are synthetic.
  const run = async () => {
    try { await vm.runInContext(`(async function () {\n${compiled}\n})()`, context, { timeout: 1_000 }); }
    catch (error) { if (error !== exitSignal) throw error; }
  };
  return { run, files, initial, operations, fetchCalls, plaintextBuffers, logs,
    counts: () => ({ certCalls, decryptCalls, randomCalls, exitCalls }) };
}

function assertZeroed(f) {
  assert.equal(f.plaintextBuffers.length, 1);
  assert.ok(f.plaintextBuffers[0].every(byte => byte === 0), 'decrypted buffer must be zeroed');
}

function assertRecoveryPreserved(f) {
  for (const name of HANDOFF_FILES) {
    assert.equal(f.files.get(file(name)), f.initial.get(file(name)), `${name} must survive uncertain provisioning`);
  }
  assert.equal(f.operations.some(operation => operation.startsWith('unlink:')), false);
}

test('addVersion failure preserves encrypted handoff and private key and zeroes plaintext', { timeout: 2_000 }, async () => {
  const f = fixture({ addVersionFailure: true });
  await assert.rejects(f.run(), /secret_manager_503/);
  assertZeroed(f);
  assertRecoveryPreserved(f);
  assert.equal(f.files.has(RECEIPT), false);
  assert.equal(f.fetchCalls.length, 3);
});

for (const receiptFailure of ['before-write', 'partial']) {
  test(`${receiptFailure} receipt-write failure preserves recovery and zeroes plaintext`, { timeout: 2_000 }, async () => {
    const f = fixture({ receiptFailure });
    await assert.rejects(f.run(), /synthetic_receipt_write_failed/);
    assertZeroed(f);
    assertRecoveryPreserved(f);
    assert.equal(f.fetchCalls.length, 3);
    if (receiptFailure === 'partial') assert.throws(() => JSON.parse(f.files.get(RECEIPT)));
    else assert.equal(f.files.has(RECEIPT), false);
  });
}

test('successful durable receipt precedes handoff cleanup and plaintext is zeroed', { timeout: 2_000 }, async () => {
  const f = fixture();
  await f.run();
  assertZeroed(f);
  const receipt = JSON.parse(f.files.get(RECEIPT));
  assert.equal(receipt.resource, VERSION);
  assert.equal(receipt.appCode, 'ga202609279410fb87e608a');
  assert.equal(receipt.plaintextStoredLocally, false);
  assert.equal(f.operations[0], 'receipt-written');
  for (const name of HANDOFF_FILES) assert.equal(f.files.has(file(name)), false);
  assert.equal(f.fetchCalls.length, 3);
  assert.equal(f.logs.at(-1).stored, true);
  const payload = JSON.parse(Buffer.from(JSON.parse(f.fetchCalls[2].init.body).payload.data, 'base64').toString());
  assert.equal(payload.clientId, HANDOFF.clientId);
  assert.equal(payload.clientSecret, HANDOFF.clientSecret);
  assert.equal(payload.encryptionKey, Buffer.alloc(32, 23).toString('base64'));
});

test('existing valid receipt cleans leftovers idempotently without decrypt, cert or network', { timeout: 2_000 }, async () => {
  const f = fixture({ existingReceipt: true });
  const original = f.files.get(RECEIPT);
  await f.run();
  await f.run();
  assert.equal(f.files.size, 1);
  assert.equal(f.files.get(RECEIPT), original);
  assert.deepEqual(f.counts(), { certCalls: 0, decryptCalls: 0, randomCalls: 0, exitCalls: 2 });
  assert.equal(f.fetchCalls.length, 0);
  assert.equal(f.plaintextBuffers.length, 0);
  assert.ok(f.logs.every(log => log.alreadyProvisioned === true && log.localHandoffRemoved === true));
});

for (const [name, options, message] of [
  ['invalid handoff', { invalidHandoff: true }, /invalid_encrypted_handoff/],
  ['operator cert failure', { certFailure: true }, /synthetic_cert_failure/],
]) {
  test(`${name} preserves encrypted recovery and zeroes decrypted plaintext`, { timeout: 2_000 }, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), message);
    assertZeroed(f);
    assertRecoveryPreserved(f);
    assert.equal(f.fetchCalls.length, 0);
  });
}
