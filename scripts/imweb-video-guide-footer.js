(() => {
  const key = '__apVideoGuideFooter20260913';
  if (window[key]) {
    window[key].start();
    return;
  }
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const expected = [
    '<교환 및 반품 가능 기간>',
    '- 계약내용에 관한 서면을 받은 날부터 7일. 다만, 그 서면을 받은 때보다 재화등의 공급이 늦게 이루어진 경우에는 재화등을 공급받거나 재화등의 공급이 시작된 날부터 7일',
    '- 공급받은 상품 및 용역의 내용이 표시﹒광고의 내용과 다르거나 계약내용과 다르게 이행된 경우에는 그 재화등을 공급받은 날 부터 3개월 이내, 그 사실을 안 날 또는 알 수 있었던 날부터 30일이내',
  ];
  const managed = new Map();
  function matches(root) {
    const product = Array.from(root.children).find(node =>
      node.matches('.archive-online-product') &&
      node.querySelector('[data-ap-video-guide="2026-09-13"]'));
    if (!product) return [];
    const first = product.nextElementSibling;
    if (!first) return [];
    const nodes = first.tagName === 'DIV'
      ? Array.from(first.children)
      : [first, first.nextElementSibling, first.nextElementSibling?.nextElementSibling];
    // Fail open if the legacy footer contains anything beyond the verified copy.
    if (nodes.length !== 3 || !nodes.every((node, i) => node?.tagName === 'P' &&
        node.children.length === 0 && normalize(node.textContent) === expected[i])) return [];
    return nodes;
  }
  function inspect() {
    const valid = new Set(Array.from(document.querySelectorAll('#prod_detail_body')).flatMap(matches));
    for (const [node, original] of managed) {
      if (valid.has(node)) continue;
      node.hidden = original.hidden;
      if (original.display) node.style.setProperty('display', original.display, original.priority);
      else node.style.removeProperty('display');
      delete node.dataset.apDuplicateLegal;
      managed.delete(node);
    }
    for (const node of valid) {
      if (managed.has(node)) continue;
      managed.set(node, { hidden: node.hidden, display: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') });
      node.dataset.apDuplicateLegal = '2026-09-13';
      node.hidden = true;
      node.style.setProperty('display', 'none', 'important');
    }
  }
  const observer = new MutationObserver(inspect);
  let observing = false;
  function start() {
    inspect();
    if (!observing && document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      observing = true;
    }
  }
  window[key] = { start };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  window.addEventListener('pagehide', () => { observer.disconnect(); observing = false; });
  window.addEventListener('pageshow', start);
})();
