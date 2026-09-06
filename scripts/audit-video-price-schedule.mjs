import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const ids = [27,28,29,30,31,32,33,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,79,80,84,85];
const unit = 'u2026051698c99ea234719';
const dir = new URL('../artifacts/video-price-schedule-20260906/', import.meta.url);
const mode = process.argv[2];
assert(['before', 'after', 'check'].includes(mode), 'Use before, after, or check');
mkdirSync(dir, { recursive: true });
const rows = [];
for (const id of (process.argv[3] ? [Number(process.argv[3])] : ids)) {
  assert(ids.includes(id));
  const result = JSON.parse(execFileSync('imweb', ['--output', 'json', 'product', 'get', String(id), '--unit-code', unit], {encoding:'utf8'}));
  const p = result.data;
  assert.equal(p?.prodNo, id);
  assert.equal(p.prodStatus, 'sale');
  assert.equal(p.prodType, 'subscribe');
  assert.equal(p.prodDigitalData.subscribeData.period, 40);
  const file = new URL(`${mode === 'before' ? 'before' : 'after'}-${id}.json`, dir);
  if (mode === 'before') {
    assert.equal(p.price,15000);
    assert.equal(p.discountOptions?.period || 'N','N');
    writeFileSync(file, JSON.stringify(p,null,2)+'\n', {flag:'wx',mode:0o600});
  } else {
    const previous=JSON.parse(readFileSync(new URL(`before-${id}.json`, dir),'utf8'));
    const changes=Object.keys(p).filter(k=>JSON.stringify(p[k])!==JSON.stringify(previous[k]));
    // The native editor normalizes dormant zero-value point fields on save.
    const normalized=changes.filter(k=>['givePointType','givePointValueType'].includes(k));
    if(normalized.length){
      assert.equal(previous.givePointType,'');
      assert.equal(previous.givePointValue,0);
      assert.equal(p.givePointValue,0);
      assert.equal(p.givePointType,'common');
      assert.equal(p.givePointValueType,'percent');
    }
    const unexpected=changes.filter(k=>!['price','priceOrg','periodDiscount','discountOptions','editTime',...normalized].includes(k));
    assert.deepEqual(unexpected, [], `Unexpected changes on ${id}`);
    assert.deepEqual({...p.discountOptions,period:'N'},previous.discountOptions || {coupon:'N',period:'N',point:'N',shopping_group_dc:'N'});
    if (mode==='after') assert.equal(p.price,20000);
    writeFileSync(file,JSON.stringify(p,null,2)+'\n',{mode:0o600});
    rows.push({id,changes,price:p.price,periodDiscount:p.periodDiscount,discountOptions:p.discountOptions});
  }
  console.log(JSON.stringify({id,price:p.price,discount:p.discountOptions?.period || 'unset',saved:mode}));
}
if(rows.length) console.log(JSON.stringify(rows,null,2));
