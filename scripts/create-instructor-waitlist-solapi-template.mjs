import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';
import { INSTRUCTOR_WAITLIST_TEMPLATE as spec, instructorWaitlistTemplatePayload,
  assertInstructorWaitlistTemplate } from './lib/instructor-waitlist-template.mjs';

export const INSTRUCTOR_WAITLIST_STATE_FILE = path.join(os.homedir(), 'ArchiveIN/operations/instructor-waitlist-notice-20261106/template-state.json');
const ACTION_KEY = 'instructor-waitlist-notice-20261106:template-v1';
const BASE = '/kakao/v2/templates';
const INSPECTION_COMMENT = '강사레슨 수강대기 신청자에게 접수 사실과 예약 미확정 상태를 안내하는 정보성 메시지입니다. 결원 발생 안내는 별도로 진행합니다. 본문에 최초 또는 현재 대기순번을 넣지 않으며, 신청자 전용 링크에서 현재 대기순번 확인 또는 수강대기 취소만 가능합니다. 인증 토큰은 URL fragment에만 포함하며 광고, 구매 유도, 이미지가 없습니다.';

function templatePath(id) {
  if (typeof id !== 'string' || !/^KA01TP[A-Za-z0-9]+$/.test(id)) throw Error('Invalid template ID');
  return `${BASE}/${id}`;
}

function assertPrivate(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077
      || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error('Unsafe template journal');
}

function privateJournal() {
  const file = INSTRUCTOR_WAITLIST_STATE_FILE, root = path.dirname(file), lock = path.join(root, 'template.lock');
  return {
    read() {
      if (!fs.existsSync(root)) return {};
      assertPrivate(root, true);
      if (!fs.existsSync(file)) return {};
      assertPrivate(file);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(state) {
      assertPrivate(root, true);
      if (fs.existsSync(file)) assertPrivate(file);
      const temp = `${file}.${process.pid}.tmp`, fd = fs.openSync(temp, 'wx', 0o600);
      try {
        try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temp, file);
        const dir = fs.openSync(root, 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    },
    acquire() {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      assertPrivate(root, true);
      const fd = fs.openSync(lock, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); fs.fsyncSync(fd); }
      catch (error) { fs.closeSync(fd); fs.unlinkSync(lock); throw error; }
      return () => { fs.closeSync(fd); fs.unlinkSync(lock); };
    },
  };
}

export async function listInstructorWaitlistTemplates(request) {
  const rows = [], seenCursors = new Set(), seenTemplateIds = new Set();
  let startKey;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ channelId: spec.channelId, limit: '100', ...(startKey ? { startKey } : {}) });
    const data = await request(`${BASE}?${query}`, 'GET');
    if (!Array.isArray(data?.templateList)) throw Error('Incomplete template inventory');
    for (const row of data.templateList) {
      templatePath(row?.templateId);
      if (row.channelId !== spec.channelId || typeof row.name !== 'string') throw Error('Template inventory source mismatch');
      if (seenTemplateIds.has(row.templateId)) throw Error('Duplicate template IDs require reconciliation');
      seenTemplateIds.add(row.templateId);
      rows.push(row);
    }
    if (data.nextKey == null || data.nextKey === '') return rows;
    if (typeof data.nextKey !== 'string' || seenCursors.has(data.nextKey)) throw Error('Template inventory cursor loop');
    seenCursors.add(data.nextKey); startKey = data.nextKey;
  }
  throw Error('Template inventory exceeds 20-page limit; no partial inventory accepted');
}

function matchTemplate(rows) {
  const matches = rows.filter(row => row.name === spec.name);
  if (matches.length > 1) throw Error('Duplicate template names require reconciliation');
  if (matches[0]?.isDeleted) throw Error('Prior template deleted; do not recreate');
  return matches[0];
}

export async function runInstructorWaitlistTemplate({ mode, request, makeRequest = makeLessonVideoSolapiRequest,
  journal = privateJournal(), now = () => new Date().toISOString() } = {}) {
  if (!['--read-only', '--apply'].includes(mode)) throw Error('Use --read-only or --apply');
  const apply = mode === '--apply';
  const release = apply ? journal.acquire() : () => {};
  try {
    const state = journal.read();
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('Invalid template journal');
    if (Object.keys(state).length && (state.actionKey !== ACTION_KEY || state.referenceTemplateId !== spec.referenceTemplateId
        || typeof state.creationIntentAt !== 'string' || !state.creationIntentAt)) throw Error('Prior template journal identity mismatch');
    const provider = request ?? makeRequest();
    // Only the new-template POST and its inspection PUT are reachable; never edit or send.
    const reference = await provider(templatePath(spec.referenceTemplateId), 'GET');
    const payload = instructorWaitlistTemplatePayload(reference);
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (Object.keys(state).length && (state.payloadHash !== payloadHash || !isDeepStrictEqual(state.payload, payload)))
      throw Error('Prior template intent content drift');
    const rows = await listInstructorWaitlistTemplates(provider), match = matchTemplate(rows);
    let id = state.templateId ?? match?.templateId;
    if (state.templateId && match?.templateId !== state.templateId) throw Error('Prior template result missing; do not recreate');
    const readback = async targetId => {
      const actual = await provider(templatePath(targetId), 'GET');
      if (actual?.templateId !== targetId || targetId === spec.referenceTemplateId) throw Error('Template identity mismatch');
      assertInstructorWaitlistTemplate(actual, payload);
      return actual;
    };
    let current = id ? await readback(id) : null;
    if (apply) {
      if (state.creationIntentAt && !state.templateId) throw Error('Unknown prior create result; no blind retry');
      if (current && (!state.creationIntentAt || !state.createdByThisJournal || state.templateId !== id))
        throw Error('Unowned template; inspection forbidden');
      if (!current) {
        Object.assign(state, { actionKey: ACTION_KEY, payloadHash, payload, referenceTemplateId: spec.referenceTemplateId,
          creationIntentAt: now(), memberSends: 0 });
        journal.save(state);
        const created = await provider(BASE, 'POST', payload);
        // Preserve any returned ID before validating it or attempting independent readback.
        if (typeof created?.templateId !== 'string' || !created.templateId) throw Error('Unknown template create result');
        id = created.templateId;
        Object.assign(state, { templateId: id, createdByThisJournal: id !== spec.referenceTemplateId && !rows.some(row => row.templateId === id) });
        journal.save(state);
        if (!state.createdByThisJournal) throw Error('Unowned template; inspection forbidden');
        current = await readback(id);
      }
      if (current.status === 'REJECTED') throw Error('Template rejected; manual review required');
      if (current.status === 'PENDING') {
        if (state.inspectionIntentAt) throw Error('Prior inspection outcome unknown; no blind resubmit');
        // Refresh both uniqueness and the exact original payload immediately before inspection.
        const freshMatch = matchTemplate(await listInstructorWaitlistTemplates(provider));
        if (freshMatch?.templateId !== id) throw Error('Prior template result missing; inspection forbidden');
        current = await readback(id);
        if (current.status === 'PENDING') {
          state.inspectionIntentAt = now(); journal.save(state);
          await provider(`${templatePath(id)}/inspection`, 'PUT', { comment: INSPECTION_COMMENT });
        }
      }
      current = await readback(id);
      if (!['INSPECTING', 'APPROVED'].includes(current.status)) throw Error('Inspection not confirmed; no blind resubmit');
      Object.assign(state, { status: current.status, verifiedAt: now(), memberSends: 0 }); journal.save(state);
    }
    return { mode, templateId: current?.templateId ?? state.templateId ?? null,
      status: current?.status ?? (state.creationIntentAt ? 'CREATE_UNKNOWN' : 'NOT_CREATED'),
      name: spec.name, channelId: spec.channelId, referenceTemplateId: spec.referenceTemplateId,
      memberSends: 0, recoveryRequired: Boolean((state.creationIntentAt && !state.templateId)
        || (state.inspectionIntentAt && current?.status === 'PENDING')),
      ...(apply ? {} : { proposal: payload }) };
  } finally { release(); }
}

export async function main(args = process.argv.slice(2), options = {}) {
  if (args.length !== 1 || !['--read-only', '--apply'].includes(args[0])) throw Error('Use --read-only or --apply');
  return runInstructorWaitlistTemplate({ ...options, mode: args[0] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(() => {
    // Never echo provider errors, credential subprocess diagnostics, or private journal contents.
    console.error(JSON.stringify({ status: 'incomplete', reason: 'validation_or_provider_readback_failed',
      retry: 'inspect_private_journal_and_provider_with_read_only_before_write' }));
    process.exitCode = 1;
  });
}
