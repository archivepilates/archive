import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';
import { LESSON_VIDEO_COMPLETE_TEMPLATE as spec, lessonVideoTemplatePayload, assertLessonVideoTemplate } from './lib/lesson-video-complete-template.mjs';

const ROOT = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/lesson-video-notices-261026');
function save(file, data) {
  const temp = `${file}.${process.pid}.tmp`, fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('Unsafe template journal');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function inventory(request) {
  const rows = []; const seen = new Set(); let startKey;
  for (let page = 0; page < 20; page++) {
    const data = await request('/kakao/v2/templates?' + new URLSearchParams({ channelId: spec.channelId, limit: '100', ...(startKey ? { startKey } : {}) }));
    if (!Array.isArray(data.templateList)) throw Error('Incomplete template inventory');
    rows.push(...data.templateList);
    if (!data.nextKey) return rows;
    if (seen.has(data.nextKey)) throw Error('Template inventory loop');
    seen.add(data.nextKey); startKey = data.nextKey;
  }
  throw Error('Template inventory limit');
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--read-only', '--apply'].includes(args[0])) throw Error('Use --read-only or --apply');
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const directory = fs.lstatSync(ROOT);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || directory.mode & 0o077) throw Error('Unsafe template directory');
  const request = makeLessonVideoSolapiRequest(), reference = await request(`/kakao/v2/templates/${spec.referenceTemplateId}`);
  const payload = lessonVideoTemplatePayload(reference);
  const image = await request(`/storage/v1/files/${spec.imageId}`);
  if (image.width !== 800 || image.height !== 400 || image.type !== 'ATA') throw Error('Official logo dimensions or ATA type changed');
  const url = new URL(image.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) throw Error('Unexpected logo origin');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== spec.logoSha256) throw Error('Official logo bytes changed');
  const matches = (await inventory(request)).filter(t => t.name === spec.name && !t.isDeleted);
  if (matches.length > 1) throw Error('Duplicate template names require reconciliation');
  const file = path.join(ROOT, 'template-state.json');
  const state = fs.existsSync(file) ? read(file) : {};
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (state.payloadHash && state.payloadHash !== payloadHash) throw Error('Prior template intent content drift');
  let current = matches[0] ? await request(`/kakao/v2/templates/${matches[0].templateId}`) : null;
  if (state.templateId && state.templateId !== current?.templateId) throw Error('Prior template result missing; do not recreate');
  if (current) assertLessonVideoTemplate(current, payload);
  if (args[0] === '--apply') {
    const lock = path.join(ROOT, 'template.lock'), fd = fs.openSync(lock, 'wx', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      if (!current) {
        if (state.creationIntentAt) throw Error('Unknown prior create result; no blind retry');
        Object.assign(state, { payloadHash, creationIntentAt: new Date().toISOString(), referenceTemplateId: spec.referenceTemplateId, imageId: spec.imageId }); save(file, state);
        current = await request('/kakao/v2/templates', 'POST', payload);
        if (!current.templateId) throw Error('Unknown template create result');
        state.templateId = current.templateId; save(file, state);
        current = await request(`/kakao/v2/templates/${current.templateId}`); assertLessonVideoTemplate(current, payload);
      }
      Object.assign(state, { templateId: current.templateId, payloadHash });
      if (current.status === 'PENDING') {
        if (state.inspectionIntentAt) throw Error('Prior inspection outcome needs readback; no blind resubmit');
        state.inspectionIntentAt = new Date().toISOString(); save(file, state);
        await request(`/kakao/v2/templates/${current.templateId}/inspection`, 'PUT', { comment: '기존 강사레슨 수강생에게 수강한 수업의 복습 영상 업로드 완료와 시청 방법을 1회 안내하는 계약 이행 메시지입니다. 홈페이지 회원가입은 해당 수강 영상 권한 연결에 필요한 절차이며 상품 홍보·추가 구매 유도는 없습니다. 내 강의실과 공식 홈페이지 가입 링크만 사용하고, 기존 공식 심벌 이미지를 그대로 재사용합니다. 시청기간은 최초 권한 부여일부터 40일입니다.' });
      }
      current = await request(`/kakao/v2/templates/${current.templateId}`); assertLessonVideoTemplate(current, payload);
      if (!['INSPECTING', 'APPROVED'].includes(current.status)) throw Error('Inspection not confirmed; inspect before any retry');
      Object.assign(state, { status: current.status, verifiedAt: new Date().toISOString(), memberSends: 0 }); save(file, state);
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  console.log(JSON.stringify({ mode: args[0], templateId: current?.templateId ?? null, status: current?.status ?? 'NOT_CREATED',
    name: spec.name, channelId: spec.channelId, imageId: spec.imageId, referenceTemplateId: spec.referenceTemplateId,
    memberSends: 0, ...(args[0] === '--read-only' ? { proposal: payload } : {}) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const safe = /^(SOLAPI (GET|POST|PUT) \d{3};|Template [a-zA-Z]+ mismatch|Template links or additional text differ|Unknown template status|Inspection not confirmed|Official logo|Unexpected logo|Prior template|Unknown prior)/.test(error.message) ? error.message : 'validation_or_provider_readback_failed';
  console.error(JSON.stringify({ status: 'incomplete', reason: safe, retry: 'inspect_private_journal_before_write' })); process.exitCode = 1;
});
