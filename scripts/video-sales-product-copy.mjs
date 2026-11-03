import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const PRIVATE = path.join(os.homedir(), 'Library/Application Support/ARCHIVE PILATES/video-sales-improvements-20261103');
const SITE = 'S20260516852c71a014d08';
const UNIT = 'u2026051698c99ea234719';
export const productCopy = {
  88: { code: 'AB11', teacher: '배민진', tool: '바렐 + 스틱', duration: '57분 52초', preview: 'gZTRX-sd0zQ', next: 89,
    heading: '스틱의 접촉으로 몸통과 골반의 움직임을 읽습니다',
    observe: '스틱이 닿는 위치와 움직임 순서, 몸통과 골반의 위치를 관찰합니다.',
    adjust: '복부의 당김과 팔의 과한 개입을 구분하며 몸통의 움직임을 조절하는 과정을 봅니다.',
    cue: '강사가 어떤 지점을 먼저 확인하고 어떤 말로 다시 움직이게 하는지, 실제 수업의 큐잉을 듣습니다.',
    nextText: '바렐에서 접촉을 관찰했다면, 리포머에서는 블럭과 발의 압력으로 지지와 몸통 정렬을 살펴보세요.',
    simple: '스틱 접촉과 몸통·골반 움직임을 관찰하는 실제 큐잉 · 배민진 · 57분 52초 · 40일 시청',
    seoTitle: '스틱 접촉으로 몸통·골반 관찰 | 바렐 강사레슨 AB11 - ARCHIVE METHOD',
    seoDescription: '배민진의 바렐+스틱 강사레슨. 스틱 접촉과 움직임 순서, 몸통·골반 위치, 팔의 과한 개입을 구분하는 실제 큐잉을 배웁니다. 미리보기 제공, 구매 후 40일 시청.' },
  89: { code: 'AR7', teacher: '정은영', tool: '리포머 + 블럭', duration: '56분', preview: 'iRMthLJlooA', next: 88,
    heading: '블럭과 발의 압력으로 지지와 정렬을 관찰합니다',
    observe: '블럭이 닿는 위치와 방향, 발의 압력과 지지, 캐리지의 움직임을 관찰합니다.',
    adjust: '캐리지 움직임과 몸통 정렬을 함께 확인하며 조절하는 실제 교정 과정을 봅니다.',
    cue: '접촉과 방향을 어떻게 설명하고 다시 확인하는지, 현장의 구체적인 티칭 언어를 듣습니다.',
    nextText: '같은 외부 피드백 주제를 바렐과 스틱에서도 비교해 보세요. 몸통과 골반의 움직임을 관찰하는 수업입니다.',
    simple: '블럭 접촉과 발의 압력으로 지지·정렬을 관찰하는 실제 큐잉 · 정은영 · 56분 · 40일 시청',
    seoTitle: '발의 압력으로 지지·정렬 관찰 | 리포머 강사레슨 AR7 - ARCHIVE METHOD',
    seoDescription: '정은영의 리포머+블럭 강사레슨. 블럭의 접촉과 방향, 발의 압력과 지지, 캐리지 움직임과 몸통 정렬을 함께 확인하는 큐잉을 배웁니다. 미리보기 제공, 구매 후 40일 시청.' }
};
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function renderProduct(no) {
  const p = productCopy[no];
  assert(p, 'Unexpected product');
  const next = productCopy[p.next];
  return `<section data-video-sales-copy="2026-11-03" style="font-family:inherit;line-height:1.75;color:#222;overflow-wrap:anywhere;word-break:keep-all;">
<p style="color:#a02e28;font-weight:700;">ARCHIVE PILATES · 온라인 강사레슨</p>
<h2 style="font-size:24px;line-height:1.45;">${escape(p.heading)}</h2>
<p>ARCHIVE METHOD ${p.code} · ${p.teacher} · ${p.tool}<br>${p.duration} · 결제 완료 후 40일 시청</p>
<p>2026년 10월 25일 ARCHIVE METHOD #9 C팀 외부 피드백2 수업입니다.</p>
<h3 style="font-size:20px;margin-top:28px;">이 수업에서 확인할 것</h3>
<ul style="padding-left:22px;"><li><strong>관찰 기준</strong> · ${escape(p.observe)}</li><li><strong>교정과 조절</strong> · ${escape(p.adjust)}</li><li><strong>실제 큐잉</strong> · ${escape(p.cue)}</li></ul>
<h3 style="font-size:20px;margin-top:28px;">수업 미리보기</h3>
<div style="width:100%;max-width:390px;aspect-ratio:9/16;margin:16px auto 28px;"><iframe src="https://www.youtube.com/embed/${p.preview}?rel=0" title="${p.code} 외부 피드백2 수업 미리보기" style="display:block;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen=""></iframe></div>
<h3 style="font-size:20px;">구매 후 시청</h3>
<p>결제 완료 후 구매한 계정으로 로그인해 내 강의실에서 시청해 주세요. 해당 영상의 40일 이용 권한이 연결됩니다. 미구매 계정은 전체 영상을 시청할 수 없습니다.</p>
<p><a href="https://archivepilates.imweb.me/archive-method-watch-${p.code.toLowerCase()}" style="display:inline-flex;align-items:center;box-sizing:border-box;max-width:100%;padding:12px 18px;min-height:44px;background:#222;color:#fff;text-decoration:none;">구매한 ${p.code} 전체 수업 시청</a></p>
<p><a href="https://archivepilates.imweb.me/48">내 강의실</a></p>
<hr style="border:0;border-top:1px solid #ddd;margin:28px 0;">
<h3 style="font-size:20px;">이 수업을 본 다음에는</h3>
<p>${escape(p.nextText)}</p>
<p><a href="https://archivepilates.imweb.me/17/?idx=${p.next}&amp;utm_source=product&amp;utm_medium=related_video&amp;utm_campaign=method9_next" style="display:inline-flex;align-items:center;box-sizing:border-box;max-width:100%;min-height:44px;padding:10px 0;">${next.teacher} ${next.tool} ${next.code} 수업 살펴보기</a></p>
<p style="font-size:14px;color:#555;">추천 영상은 별도 구매 상품입니다. 현재 영상의 쿠폰과 시청권한은 추천 영상에 자동 적용되지 않습니다.</p>
</section>`;
}
function cli(args) {
  try { return JSON.parse(execFileSync('imweb', ['--output', 'json', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8e6 })); }
  catch (error) {
    let result; try { result = JSON.parse(String(error.stdout)); } catch { /* Never print credential-bearing diagnostics. */ }
    const code = result?.error?.code || result?.error?.error_code || 'transport_unknown';
    throw Object.assign(new Error(`Imweb operation stopped: ${code}`), { code });
  }
}
const get = no => { const r = cli(['product', 'get', String(no)]); assert.equal(r.statusCode, 200); return r.data; };
const save = (name, value) => fs.writeFileSync(path.join(PRIVATE, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const shaFields = p => { const { content, simpleContent, seoTitle, seoDescription, editTime, ...rest } = p; return rest; };
async function main() {
  const mode = process.argv[2]; assert(['plan', 'apply', 'verify'].includes(mode));
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const context = cli(['config', 'context']).resolved_profile;
  assert.equal(context.site_code, SITE); assert.equal(context.unit_code, UNIT);
  const lock = path.join(os.homedir(), 'ArchiveIN/automation/locks/imweb-product-write.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), task: 'video-sales-improvements' }));
    for (const no of [88,89]) {
      const p = productCopy[no], before = JSON.parse(fs.readFileSync(path.join(PRIVATE, `product-${no}-before.json`)));
      assert.equal(before.prodType, 'subscribe'); assert.equal(before.price, 20000); assert.equal(before.prodStatus, 'sale');
      const steps = [{ leaf: 'info', payload: { description: renderProduct(no), summaryDescription: p.simple }, readKeys: { description: 'content', summaryDescription: 'simpleContent' } },
        { leaf: 'seo', payload: { seoTitle: p.seoTitle, seoDescription: p.seoDescription, seoAccessBot: before.seoAccessBot } }];
      for (const step of steps) {
        const current = get(no); assert.deepEqual(shaFields(current), shaFields(before));
        const resultKey = key => step.readKeys?.[key] || key;
        if (Object.entries(step.payload).every(([key,value]) => isDeepStrictEqual(current[resultKey(key)],value))) continue;
        if (mode === 'verify') throw new Error(`Product ${no} ${step.leaf} pending`);
        const log = `${no}-${step.leaf}-request-v2-intent.json`, logfile = path.join(PRIVATE, log);
        if (fs.existsSync(path.join(PRIVATE, `${no}-${step.leaf}-intent.json`))) {
          const reconciliation = JSON.parse(fs.readFileSync(path.join(PRIVATE, `${no}-${step.leaf}-reconciliation.json`)));
          assert.equal(reconciliation.result, 'confirmed_no_content_change');
        }
        if (mode === 'apply' && fs.existsSync(logfile)) throw new Error('Existing intent needs reconciliation before any repeat');
        if (step.leaf === 'info') assert.equal(current.content, before.content);
        else { assert.equal(current.seoTitle, before.seoTitle); assert.equal(current.seoDescription, before.seoDescription); }
        const args = ['product','update',step.leaf,String(no),'--data',JSON.stringify(step.payload)];
        const dry = cli([...args,'--dry-run']); assert(dry.confirmation_token);
        if (mode === 'apply') {
          assert.deepEqual(get(no), current, 'Concurrent product change');
          save(log, { canonicalActionKey: `video-sales-20261103:${no}:${step.leaf}:official-schema-v2`, at: new Date().toISOString(), before: current, payload: step.payload, state: 'intent' });
          cli([...args,'--yes','--confirm-token',dry.confirmation_token]);
          const after = get(no); assert.deepEqual(shaFields(after), shaFields(before));
          for (const [key,value] of Object.entries(step.payload)) assert.deepEqual(after[resultKey(key)],value);
          save(`${no}-${step.leaf}-verified.json`, { verifiedAt: new Date().toISOString(), product: after });
        }
      }
      save(`product-${no}-${mode}.json`, get(no));
      console.log(JSON.stringify({ no, code: p.code, mode, price: 20000, entitlementDays: 40 }));
    }
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(JSON.stringify({ error: e.message })); process.exitCode = 1; });
