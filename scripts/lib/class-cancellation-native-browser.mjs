import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import xlsx from 'xlsx';
import {CLASS_HEADERS, parseClassTable} from '../studiomate-class-cancellation-guard.mjs';
import {privateDirectory, savePrivateJson} from './class-cancellation-correction-ledger.mjs';

const HOST = 'https://arcpilates.studiomate.kr';
const key = r => JSON.stringify([r.date, r.startTime, r.staffName, r.lessonType, r.category, r.title, r.room]);
const uiDate = d => d.split('-').map((v, i) => i ? String(Number(v)) : v).join('. ') + '.';
const compact = text => text.replace(/\s+/g, '');
export function classCorrectionTransportAllowed({method, origin, isEditor, armed, used, now}) {
  const ms = now.getTime(), hour = new Date(ms + 9 * 3600000).getUTCHours();
  const cutoff = typeof armed?.deadline === 'string' ? Date.parse(armed.deadline.replace(' ', 'T') + '+09:00') : NaN;
  return !!(isEditor && armed && !used && origin === 'https://api.studiomate.kr'
    && ['POST', 'PUT', 'PATCH'].includes(method) && Number.isFinite(ms) && Number.isFinite(cutoff)
    && Number.isFinite(armed.expiresAt) && ms <= armed.expiresAt && ms < cutoff && hour >= 9 && hour < 23);
}
export async function forwardNativeClassMutation(route) {
  try {
    // Forward exactly the already-generated native UI request, without retry or redirect.
    const response = await route.fetch({maxRedirects: 0, maxRetries: 0, timeout: 20000});
    if (response.status() < 200 || response.status() >= 300) {
      await route.abort('blockedbyclient'); return {ok: false, status: response.status()};
    }
    await route.fulfill({response}); return {ok: true, status: response.status()};
  } catch {
    await route.abort('blockedbyclient').catch(() => {}); return {ok: false, status: 'unknown'};
  }
}
export async function waitForNativeClassCount(page, total) {
  try {
    await page.waitForFunction(expected => [...document.querySelectorAll('*')].some(el => {
      const match = /^필터된 수업\s*([\d,]+)\s*개$/.exec(el.innerText?.trim() || '');
      return match && Number(match[1].replaceAll(',', '')) === expected;
    }), total, {timeout: 15000});
  } catch {throw Error(`Native export/UI count mismatch: expected ${total}, observed ${await page.getByText(/필터된 수업/).innerText()}`);}
}
export function nativeDateTime(text, {until = false} = {}) {
  if (text === '-' || text === '') return '';
  const match = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2}):(\d{2})(?:\s*까지)?$/.exec(text.trim());
  if (!match) throw Error('Unrecognized native time text');
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')} ${match[4]}:${match[5]}:00${until ? ' 까지' : ''}`;
}

export function nativeClassCells(cells) {
  if (cells.length !== 13) throw Error('Native class table column count changed');
  const dateTime = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*\([^)]\)\s*(\d{2}:\d{2})~(\d{2}:\d{2})$/.exec(cells[1]);
  const capacity = /^(\d+)\/(\d+)$/.exec(cells[7]);
  if (!dateTime || !capacity) throw Error('Native class identity format changed');
  const empty = value => value === '-' ? '' : value;
  return [`${dateTime[1]}-${dateTime[2].padStart(2, '0')}-${dateTime[3].padStart(2, '0')}`, dateTime[4], dateTime[5], cells[2], cells[3], cells[4], empty(cells[5]), empty(cells[6]), capacity[1], capacity[2], empty(cells[8]), nativeDateTime(cells[9], {until: true}), nativeDateTime(cells[10], {until: true}), nativeDateTime(cells[12])];
}

export function createClassCancellationBrowser({readPage, editPage, directory}) {
  let arm = null, transport = null, transportRequest = null, blockedMutation = false;
  const blockedDestinations = new Set();
  const initialize = async () => readPage.context().route('**/*', async route => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    // All non-native writes (including telemetry) are denied, never forwarded or counted as class saves.
    if (new URL(request.url()).origin !== 'https://api.studiomate.kr') return route.abort('blockedbyclient');
    let isEditor = false;
    try {isEditor = request.frame().page() === editPage;} catch { /* No service-worker/popup write authority. */ }
    if (!classCorrectionTransportAllowed({method: request.method(), origin: new URL(request.url()).origin,
      isEditor, armed: arm, used: !!transport, now: new Date()})) {
      blockedMutation = true; blockedDestinations.add(new URL(request.url()).origin + new URL(request.url()).pathname); return route.abort('blockedbyclient');
    }
    // Native UI owns the endpoint/payload; the adapter does not construct a private API call.
    transport = {method: request.method(), urlHash: createHash('sha256').update(request.url()).digest('hex')};
    transportRequest = request;
    const receipt = await forwardNativeClassMutation(route);
    transport.status = receipt.status;
    if (!receipt.ok) blockedMutation = true;
  });
  async function setRange(page, from, through) {
    await page.goto(`${HOST}/lectures`, {waitUntil: 'networkidle', timeout: 45000});
    if (!page.url().startsWith(`${HOST}/lectures`) || await page.locator('input[type="password"]').count()) throw Error('StudioMate class source login required');
    const owner = page.getByRole('button', {name: /(?:김기효|배민진)\s*스튜디오 오너님/});
    try {await owner.waitFor({timeout: 15000});}
    catch {throw Error('Native configured owner session not verified');}
    await page.getByRole('textbox', {name: '선택', exact: true}).first().click();
    await page.getByText('기간', {exact: true}).click();
    const inputs = page.locator('input.el-range-input');
    if (await inputs.count() !== 2) throw Error('Native class range control changed');
    // Raw input edits can update export state before the list watcher. Use the native calendar commit.
    await page.locator('.el-range-editor').click();
    const panel = page.locator('.el-picker-panel.el-date-range-picker:visible');
    await panel.waitFor({state: 'visible'});
    const pick = async date => {
      const [year, month, day] = date.split('-').map(Number);
      for (let move = 0; move < 4; move++) {
        const sections = panel.locator('.el-date-range-picker__content');
        const headers = await sections.locator('.el-date-range-picker__header div').allTextContents();
        const index = headers.findIndex(h => compact(h) === `${year}년${month}월`);
        if (index >= 0) {
          const target = sections.nth(index).locator('td.available').getByText(String(day), {exact: true});
          if (await target.count() !== 1) throw Error('Native range day is not unique');
          await target.click(); return;
        }
        await panel.locator('.el-date-range-picker__content.is-right .el-icon-arrow-right').click();
      }
      throw Error('Native range month outside bounded picker navigation');
    };
    await pick(from); await pick(through);
    await panel.waitFor({state: 'hidden'});
    await page.waitForLoadState('networkidle');
    const values = await inputs.evaluateAll(es => es.map(e => e.value));
    if (!isDeepStrictEqual(values, [uiDate(from), uiDate(through)])) throw Error('Native class range not applied');
    for (const placeholder of ['모든 요일', '강사 전체', '수업 전체', '수업구분 전체', '룸 전체']) {
      if (await page.getByPlaceholder(placeholder, {exact: true}).inputValue() !== '') throw Error('Uncleared native class filter');
    }
    const text = await page.getByText(/필터된 수업/).innerText();
    const match = /^필터된 수업\s+([\d,]+)\s*개$/.exec(text.trim());
    if (!match) throw Error('Native class count missing');
    return Number(match[1].replaceAll(',', ''));
  }
  async function exportClasses({from, through}) {
    const observedAt = new Date().toISOString();
    await setRange(readPage, from, through);
    await privateDirectory(directory);
    const waiting = readPage.waitForEvent('download', {timeout: 30000});
    await readPage.getByRole('button', {name: '엑셀 다운', exact: true}).click();
    const download = await waiting;
    const file = path.join(directory, `classes-${randomUUID()}.xlsx`);
    await download.saveAs(file); await fs.chmod(file, 0o600);
    if (blockedMutation) throw Error(`Unexpected mutation while reading class source: ${JSON.stringify([...blockedDestinations])}`);
    const bytes = await fs.readFile(file), workbook = xlsx.read(bytes, {type: 'buffer'});
    if (workbook.SheetNames.length !== 1) throw Error('Native class workbook is incomplete');
    const table = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {header: 1, raw: false, defval: ''});
    const total = table.length - 1;
    if (!Number.isSafeInteger(total) || total < 0 || total > 5000) throw Error('Native class source exceeds bounded horizon size');
    // Filter requests are debounced. Compare against the settled UI, not its provisional previous count.
    await waitForNativeClassCount(readPage, total);
    const rangeAfter = await readPage.locator('input.el-range-input').evaluateAll(es => es.map(e => e.value));
    if (!isDeepStrictEqual(rangeAfter, [uiDate(from), uiDate(through)])) throw Error('Class range changed during export');
    const rows = total ? parseClassTable(table, {from, through, expectedCount: total}) : [];
    if (!total && (!isDeepStrictEqual(table[0], CLASS_HEADERS) || table.length !== 1)) throw Error('Native zero count contradicts workbook');
    const snapshot = {rows, total, from, through, observedAt, sourceHash: createHash('sha256').update(bytes).digest('hex'), file};
    await savePrivateJson(file + '.json', {...snapshot, rows: undefined, purpose: 'canonical_native_class_source_snapshot'});
    return snapshot;
  }
  async function locateRow(page, row) {
    await setRange(page, row.date, row.date);
    await page.waitForFunction(expected => document.querySelector('tr.el-table__row td:nth-child(2)')?.textContent.trim().startsWith(expected), uiDate(row.date), {timeout: 15000});
    const text = await page.getByText(/필터된 수업/).innerText();
    const match = /^필터된 수업\s+([\d,]+)\s*개$/.exec(text.trim());
    const total = match ? Number(match[1].replaceAll(',', '')) : 0;
    if (!total || total > 200) throw Error('Native single-day class pagination is missing or too large');
    const matches = [], seen = new Set();
    let targetIndex = null, targetPage = null;
    for (let pageIndex = 1; pageIndex <= Math.ceil(total / 10); pageIndex++) {
      const tableRows = page.locator('tr.el-table__row');
      const raw = await tableRows.evaluateAll(es => es.map(e => [...e.querySelectorAll('td')].map(c => c.innerText.trim())));
      for (let i = 0; i < raw.length; i++) {
        const cells = nativeClassCells(raw[i]);
        const value = parseClassTable([CLASS_HEADERS, cells], {from: row.date, through: row.date, expectedCount: 1})[0];
        if (seen.has(key(value))) throw Error('Ambiguous native UI identity');
        seen.add(key(value));
        if (key(value) === key(row)) {matches.push({...value, uiBookingChange: nativeDateTime(raw[i][11], {until: raw[i][11] !== '-'})}); targetPage = pageIndex; targetIndex = i;}
      }
      if (pageIndex < Math.ceil(total / 10)) {await page.locator('.el-pagination .btn-next').click(); await page.waitForLoadState('networkidle');}
    }
    if (seen.size !== total || matches.length !== 1) throw Error('Native exact class row/complete pagination not verified');
    while (Number(await page.locator('.el-pagination .el-pager .active').innerText()) > targetPage) {
      await page.locator('.el-pagination .btn-prev').click(); await page.waitForLoadState('networkidle');
    }
    const locator = page.locator('tr.el-table__row').nth(targetIndex);
    const rendered = await locator.locator('td').allTextContents();
    const actualCells = nativeClassCells(rendered.map(s => s.trim()));
    if (!isDeepStrictEqual(actualCells, matches[0].nativeCells)) throw Error('Native class ordering changed during pagination');
    return {row: {...matches[0], uiBookingChange: nativeDateTime(rendered[11].trim(), {until: rendered[11].trim() !== '-'})}, locator};
  }
  async function readClass(row) {return (await locateRow(readPage, row)).row;}
  async function correctClass(row, policy, {beforeSubmit, previewOnly = false}) {
    const selected = await locateRow(editPage, row);
    if (!isDeepStrictEqual(selected.row.nativeCells, row.nativeCells)) throw Error('Native class changed before opening correction draft');
    await selected.locator.getByRole('checkbox').check();
    if (await editPage.locator('tr.el-table__row input[type="checkbox"]:checked').count() !== 1) throw Error('Exactly one native class must be selected');
    const assertSelected = async () => {
      const checked = editPage.locator('tr.el-table__row').filter({has: editPage.locator('input[type="checkbox"]:checked')});
      if (await checked.count() !== 1 || !isDeepStrictEqual(nativeClassCells((await checked.locator('td').allTextContents()).map(s => s.trim())), row.nativeCells)) throw Error('Selected native class changed');
    };
    await assertSelected();
    await editPage.getByRole('button', {name: '일괄 수정', exact: true}).click();
    const form = editPage.locator('.el-dialog').filter({has: editPage.getByText('수업 일괄 수정', {exact: true})});
    const blocks = form.locator('.bulk-update-lectures-form-element');
    const block = blocks.filter({has: editPage.getByText('취소 가능 시간', {exact: true})});
    if (await block.count() !== 1 || await blocks.locator('input[type="checkbox"]:checked').count() !== 0) throw Error('Unexpected preselected native edit fields');
    await block.getByRole('checkbox').check();
    const inputs = block.getByRole('spinbutton');
    const values = [policy.leadHours, policy.leadMinutes];
    if (await inputs.count() !== 2) throw Error('Native cancellation input format changed');
    for (let i = 0; i < 2; i++) {
      const current = Number(await inputs.nth(i).inputValue());
      if (current !== 0 || !Number.isInteger(values[i]) || values[i] < 0 || values[i] > (i ? 59 : 99)) throw Error('Unexpected initial cancellation input');
      for (let n = 0; n < values[i]; n++) await block.locator('.el-input-number').nth(i).locator('.el-input-number__increase').click();
      if (Number(await inputs.nth(i).inputValue()) !== values[i]) throw Error('Cancellation draft did not match');
    }
    if (await blocks.locator('input[type="checkbox"]:checked').count() !== 1) throw Error('Non-cancellation field enabled');
    await form.getByRole('button', {name: '확인', exact: true}).click();
    const confirmation = editPage.locator('.el-message-box__wrapper');
    await confirmation.waitFor({state: 'visible'});
    const expected = `1개의 수업이 다음과 같이 수정됩니다.취소 가능 시간: 수업시작 ${policy.leadHours}시간 ${policy.leadMinutes}분 전까지계속 하시겠습니까?`;
    if (compact(await confirmation.locator('.el-message-box__message').innerText()) !== compact(expected)) throw Error('Native final confirmation differs from approved cutoff-only change');
    const proof = await beforeSubmit();
    await assertSelected();
    if (await blocks.locator('input[type="checkbox"]:checked').count() !== 1 || Number(await inputs.nth(0).inputValue()) !== values[0] || Number(await inputs.nth(1).inputValue()) !== values[1]) throw Error('Draft changed after checkpoint');
    if (previewOnly) {
      await confirmation.getByRole('button', {name: '취소', exact: true}).click();
      await form.getByRole('button', {name: '취소', exact: true}).click();
      return {previewVerified: true, accepted: false};
    }
    if (proof?.ok !== true || !Number.isFinite(proof.expiresAt)) throw Error('Fresh transport proof missing');
    arm = {key: key(row), deadline: policy.expectedDeadline, expiresAt: proof.expiresAt}; transport = null; transportRequest = null;
    const receipt = editPage.waitForResponse(r => transportRequest && r.request() === transportRequest, {timeout: 20000}).catch(() => null);
    try {
      await confirmation.getByRole('button', {name: '확인', exact: true}).click({timeout: 10000});
      const response = await receipt;
      if (!transport || blockedMutation || !response?.ok() || await response.finished()) throw Error('Native correction transport unknown; do not retry');
      return {accepted: true, transport};
    } finally {arm = null;}
  }
  return {initialize, exportClasses, readClass, correctClass};
}
