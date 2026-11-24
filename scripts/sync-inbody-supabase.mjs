import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inspectMeasurement, inspectMember, phone, testTime } from './audit-inbody-supabase-match.mjs';

const root = '/Users/archivepilates/archive-automation';
const sourceProject = 'archive-pilates';
const targetProject = 'vrmtkewdqgcrhpbeijhr';
const targetRole = 'archive_inbody_writer';
const account = 'arcpilates';
const studio = '5330';
const eventPath = 'inbodyWebhookEvents';
const fieldMask = ['source', 'studioId', 'lookupStatus', 'measurementId', 'isTempData',
  'userId', 'userToken', 'testDatetimes', 'account'];
const recordFields = ['source', 'studioId', 'detailStatus', 'isTempData', 'eventId', 'testDatetimes',
  'detailRaw.ID', 'detailRaw.Name', 'detailRaw.MobileNumber',
  'summary.weightKg', 'summary.skeletalMuscleMassKg', 'summary.percentBodyFat'];
const day = 86400000;
const since = Date.parse('2026-11-01T00:00:00+09:00');
const stateFile = root + '/operations/inbody-supabase/state.json';
const reasonCodes = new Set(['source_not_verified', 'source_event_missing',
  'source_event_scope_mismatch', 'source_event_backlink_not_verified',
  'provider_identity_not_verified', 'metric_missing_or_invalid',
  'ambiguous_phone', 'no_member_candidate', 'member_name_mismatch', 'native_member_id_not_verified',
  'duplicate_conflict', 'not_ready', 'provider_no_result', 'provider_response_mismatch',
  'provider_unavailable']);
const require = createRequire(import.meta.url);
const sourceCred = root + '/secrets/google/archive-codex-operator.json';
const runtime = '/Users/archivepilates/dev/archive-in-runtime';
const signature = '(text,text,timestamptz,numeric,numeric,numeric)';
const verifySql = 'SELECT archive_inbody.verify_measurement($1,$2,$3,$4,$5,$6) as verified';
const insertSql = 'SELECT archive_inbody.store_measurement($1,$2,$3,$4,$5,$6) as outcome';

async function privateJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.size <= 500000);
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

async function database() {
  const dir = root + '/secrets/supabase';
  const [cfg, identity] = await Promise.all([
    privateJson(dir + '/inbody-writer.json'),
    privateJson(dir + '/mcp-history-reader.json'),
  ]);
  assert(cfg.project === targetProject && identity.project === targetProject &&
    cfg.role === targetRole && /^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/.test(cfg.host) &&
    /^[A-Za-z0-9_-]{64}$/.test(cfg.password) && new X509Certificate(cfg.ca).ca &&
    /^[0-9a-f]{64}$/.test(identity.hmacKey));
  const { Client } = createRequire(runtime + '/services/archivepilates-mcp/package.json')('pg');
  const client = new Client({ host: cfg.host, port: 5432, database: 'postgres',
    user: targetRole + '.' + targetProject, password: cfg.password,
    ssl: { ca: cfg.ca, rejectUnauthorized: true }, connectionTimeoutMillis: 8000,
    query_timeout: 12000, application_name: 'archive-inbody-restricted-ingest' });
  client.on('error', () => {});
  try {
    await client.connect();
    const { rows: [r] } = await client.query(`SELECT current_user AS actor, session_user AS login,
      current_database() AS db, current_setting('log_parameter_max_length') AS log_bind,
      current_setting('log_parameter_max_length_on_error') AS log_error,
      current_setting('pgaudit.log_parameter',true) AS audit_bind,
      current_setting('auto_explain.log_min_duration',true) AS explain,
      current_setting('auto_explain.log_parameter_max_length',true) AS explain_bind,
      current_setting('plan_cache_mode') AS plan_mode,
      (SELECT setting::int FROM pg_settings WHERE name='auto_explain.log_min_duration' AND unit='ms') AS explain_ms,
      (SELECT setting::int FROM pg_settings WHERE name='statement_timeout' AND unit='ms') AS deadline_ms,
      NOT has_table_privilege(current_user,'archive_inbody.measurement','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_table,
      has_function_privilege(current_user,'archive_inbody.store_measurement${signature}','EXECUTE') AS can_store,
      has_function_privilege(current_user,'archive_inbody.verify_measurement${signature}','EXECUTE') AS can_verify`);
    // A reused pooler session may retain the prior role setting. In that case
    // require the server to cancel at least twice as soon as plans can be logged.
    const plansSafe = [null,'','-1'].includes(r.explain) || r.explain_bind === '0' ||
      (r.deadline_ms > 0 && r.explain_ms >= 2 * r.deadline_ms);
    if (r.actor !== targetRole || r.login !== targetRole || r.db !== 'postgres' ||
        r.log_bind !== '0' || r.log_error !== '0' || ![null,'','off'].includes(r.audit_bind) ||
        !plansSafe ||
        r.plan_mode !== 'force_generic_plan' || !r.no_table || !r.can_store || !r.can_verify) {
      throw Error('writer_scope_or_logging_not_verified');
    }
    const hash = value => createHmac('sha256', Buffer.from(identity.hmacKey, 'hex')).update(value).digest('hex');
    return { client, hash };
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

function providerKey() {
  try {
    const key = execFileSync('/opt/homebrew/bin/gcloud',
      ['secrets','versions','access','latest','--secret=INBODY_API_KEY','--project=archive-pilates','--quiet'],
      { encoding: 'utf8', timeout: 12000, stdio: ['ignore','pipe','pipe'],
        env: { ...process.env, CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: sourceCred } }).trim();
    if (key) return key;
  } catch {}
  throw Error('provider_key_unavailable');
}

function sourceEvent(event) {
  return event?.source === 'lookinbody' && String(event.studioId) === studio &&
    event.account === account && event.isTempData === false &&
    typeof event.userId === 'string' && event.userId.trim() && phone(event.userToken) &&
    typeof event.testDatetimes === 'string' && /^\d{14}$/.test(event.testDatetimes);
}

function timestamp(value) {
  const digits = testTime(value);
  if (!digits) return null;
  const date = new Date(digits.slice(0,4) + '-' + digits.slice(4,6) + '-' + digits.slice(6,8) +
    'T' + digits.slice(8,10) + ':' + digits.slice(10,12) + ':' + digits.slice(12) + '+09:00');
  if (!Number.isFinite(date.getTime())) return null;
  const local = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0,19).replace(/\D/g, '');
  return local === digits ? date : null;
}

function metric(value) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
}

async function loadDetail(key, event) {
  const request = { UserID: event.userId, Datetimes: event.testDatetimes };
  let resp;
  try {
    resp = await fetch('https://apikr.lookinbody.com/InBody/GetFullInBodyDataByID', {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Account: account, 'API-KEY': key },
      signal: AbortSignal.timeout(11000), body: JSON.stringify(request),
    });
  } catch { return { hold: 'provider_unavailable' }; }
  if ([401,403,429].includes(resp.status)) throw Error('provider_rejected_or_throttled_' + resp.status);
  if (resp.status >= 500) return { hold: 'provider_unavailable' };
  if (!resp.ok) return { hold: 'provider_no_result' };
  const raw = await resp.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.ID) return { hold: 'provider_no_result' };
  const summary = { weightKg: metric(raw.Weight), skeletalMuscleMassKg: metric(raw['SMM(SkeletalMuscleMass)']),
    percentBodyFat: metric(raw['PBF(PercentBodyFat)']) };
  return { raw, summary };
}

async function run(mode, note) {
  const applying = mode !== '--plan';
  const admin = require(runtime + '/firebase/kangsain-functions/functions/node_modules/firebase-admin');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = sourceCred;
  const app = admin.initializeApp({ projectId: sourceProject });
  const firestore = admin.firestore(app);
  let client;
  try {
    const login = applying ? await database() : null;
    client = login?.client;
    if (client) {
      const { rows:[row] } = await client.query('SELECT pg_try_advisory_lock(5330, 20261124) AS locked');
      if (!row.locked) return { ok:true, mode, skipped:'active_run' };
    }
    let state = { lastScan: 0, events: {} };
    if (mode === '--sync') {
      try { state = await privateJson(stateFile); }
      catch(error) { if (error.code !== 'ENOENT') throw error; }
      assert(Number.isSafeInteger(state.lastScan) && state.lastScan >= 0 && state.events &&
        !Array.isArray(state.events) && typeof state.events === 'object');
    }
    const now = Date.now();
    const counts = { mode, scanned: 0, checked: 0, matched: 0, inserted: 0, alreadyPresent: 0,
      readback: 0, cached: 0, holds: {} };
    const hold = reason => {
      assert(reasonCodes.has(reason));
      counts.holds[reason] = (counts.holds[reason] ?? 0) + 1;
    };
    const memberCache = new Map();
    async function verifyAndStore(ls, identity, summary, date) {
      if (!memberCache.has(identity.phone)) {
        const digits = identity.phone;
        const parts = [digits.slice(0,3),digits.slice(3,7),digits.slice(7)];
        const found = await firestore.collection('memberProfiles').where('phone','in',[
          digits,parts.join('-'),parts.join(' '),'+82'+digits.slice(1)
        ]).limit(10).select('studioId','phone','name','memberId','studiomateMemberId','mergedInto','canonicalMemberId').get();
        memberCache.set(digits,found.docs.map(doc => ({ id:doc.id, profile:doc.data() })));
      }
      const member = inspectMember(identity,memberCache.get(identity.phone));
      if (member.hold) { hold(member.hold); return member.hold; }
      counts.matched++;
      if (!client) return 'plan_matched';
      const args = [ls,login.hash('archive-ops:studiomate:5330:member:'+member.memberId),date.toISOString(),
        summary.weightKg,summary.skeletalMuscleMassKg,summary.percentBodyFat];
      const already = (await client.query(verifySql,args)).rows[0].verified;
      if (already) { counts.alreadyPresent++; counts.readback++; return 'verified'; }
      const outcome = (await client.query(insertSql,args)).rows[0].outcome;
      if (outcome === 'conflict') { hold('duplicate_conflict'); return 'duplicate_conflict'; }
      const readback = (await client.query(verifySql,args)).rows[0].verified;
      if (!readback || !['inserted','already_present'].includes(outcome)) throw Error('stored_row_readback_failed');
      counts[outcome === 'inserted' ? 'inserted' : 'alreadyPresent']++;
      counts.readback++;
      return 'verified';
    }
    const events = firestore.collection(eventPath);
    if (mode === '--historical' || mode === '--plan') {
      const list = await firestore.collection('inbodyMeasurements').select(...recordFields,
        new admin.firestore.FieldPath('detailRaw','TestDate/Time')).limit(31).get();
      if (list.size > 30) throw Error('historical_scope_changed');
      for (const doc of list.docs) {
        const row = doc.data();
        counts.scanned++;
        if (typeof row.eventId !== 'string' || !/^inbody_[a-f0-9]{32}$/.test(row.eventId)) {
          hold('source_event_missing'); continue;
        }
        const event = (await firestore.getAll(events.doc(row.eventId),{fieldMask}))[0].data();
        const identity = inspectMeasurement(doc.id,row,event);
        if (identity.hold) { hold(identity.hold); continue; }
        const at = timestamp(event.testDatetimes);
        if (!at || at.getTime() >= since || at.getTime() > now) { hold('not_ready'); continue; }
        counts.checked++;
        await verifyAndStore(login?.hash('archive-ops:lookinbody:5330:event:'+row.eventId), identity,row.summary,at);
      }
    } else {
      const begin = Math.max(since, state.lastScan ? state.lastScan - 7 * day : since);
      const rows = await events.where('lastReceivedAt','>=',admin.firestore.Timestamp.fromMillis(begin))
        .orderBy('lastReceivedAt').limit(501).select(...fieldMask).get();
      if (rows.size > 500) throw Error('scan_limit_operator_review');
      let key;
      let transientErrors = 0;
      for (const doc of rows.docs) {
        counts.scanned++;
        const event = doc.data();
        const eventKey = login.hash('archive-ops:lookinbody:5330:event:'+doc.id);
        if (state.events[eventKey]?.result === 'verified' || state.events[eventKey]?.retryAt > now) {
          counts.cached++; continue;
        }
        const at = timestamp(event.testDatetimes);
        if (!sourceEvent(event)) { hold('source_not_verified'); continue; }
        if (!at || at.getTime() > now - 5 * 60 * 1000 || at.getTime() < since) { hold('not_ready'); continue; }
        key ||= providerKey();
        counts.checked++;
        const detail = await loadDetail(key,event);
        let result;
        if (detail.hold) {
          result = detail.hold;
          hold(result);
          if (result === 'provider_unavailable' && ++transientErrors >= 3) {
            throw Error('provider_consecutive_errors');
          }
        } else {
          transientErrors = 0;
          const identity = inspectMeasurement(doc.id,{
            source:event.source,studioId:studio,detailStatus:'synced',isTempData:false,
            testDatetimes:event.testDatetimes,detailRaw:detail.raw,summary:detail.summary
          },{ ...event, lookupStatus:'synced',measurementId:doc.id });
          if (identity.hold) { result=identity.hold; hold(result); }
          else result = await verifyAndStore(eventKey,identity,detail.summary,at);
        }
        state.events[eventKey] = { result, retryAt: now + day };
      }
      state.lastScan = now;
      for (const [hash, entry] of Object.entries(state.events)) {
        if (entry.retryAt < now - 21 * day) delete state.events[hash];
      }
      const temp = stateFile+'.'+process.pid;
      await writeFile(temp,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
      await rename(temp,stateFile);
    }
    note('verified');
    return { ok:true, ...counts };
  } finally {
    if (client) await client.end().catch(() => {});
    await firestore.terminate().catch(() => {});
    await app.delete().catch(() => {});
  }
}

const mode = process.argv[2] || '--plan';
const allowed = ['--plan','--historical','--sync'];
let stage = 'preflight';
try {
  if (!allowed.includes(mode) || process.argv.length > 3) throw Error('unsupported_mode');
  const result = await run(mode, value => { stage=value; });
  console.log(JSON.stringify(result));
} catch (error) {
  const known = new Set(['unsupported_mode','provider_key_unavailable','historical_scope_changed',
    'scan_limit_operator_review','stored_row_readback_failed','provider_consecutive_errors',
    'writer_scope_or_logging_not_verified',
    ...[401,403,429].map(code => 'provider_rejected_or_throttled_'+code)]);
  const code = known.has(error?.message) ? error.message :
    (typeof error?.code === 'number' || /^[0-9A-Z]{5}$/.test(error?.code ?? '')) ? error.code : 'sync_failed';
  console.error(JSON.stringify({ ok:false, mode, stage, code }));
  process.exitCode = 1;
}
