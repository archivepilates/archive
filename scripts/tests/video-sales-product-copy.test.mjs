import test from 'node:test';
import assert from 'node:assert/strict';
import { productCopy, renderProduct } from '../video-sales-product-copy.mjs';

test('both product descriptions retain a dedicated preview, protected watch link and classroom', () => {
  for (const [no,p] of Object.entries(productCopy)) {
    const html = renderProduct(no);
    assert.equal((html.match(/<iframe/g) || []).length,1);
    assert(html.includes(`/embed/${p.preview}?rel=0`));
    assert(html.includes(`/archive-method-watch-${p.code.toLowerCase()}`));
    assert(html.includes('https://archivepilates.imweb.me/48'));
    assert(html.includes('40일'));
    assert(!/Es-G6_WekWo|qdS2a3KXnmU/.test(html));
  }
});
test('recommendations preserve product identity and disclose separate purchase', () => {
  for (const [no,p] of Object.entries(productCopy)) {
    const html = renderProduct(no);
    assert(html.includes(`/17/?idx=${p.next}&amp;utm_source=product`));
    assert(html.includes('별도 구매 상품'));
    assert(html.includes('자동 적용되지 않습니다'));
    for (const term of ['관찰 기준','교정과 조절','실제 큐잉']) assert(html.includes(term));
    assert(!/무료 구매|통증 치료|완치|자세 완벽/.test(html));
  }
});
test('only the exact products are supported', () => {
  for (const no of [1,87,90,'__proto__']) assert.throws(()=>renderProduct(no));
});
