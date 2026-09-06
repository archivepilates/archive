/* ARCHIVE PILATES: presentation only; native prices and access are never changed. */
(function () {
  'use strict';
  if (window.__apVideoCountdown20260906) return;
  var END = Date.parse('2026-10-01T00:00:00+09:00');
  var CODES = {27:'AR1',28:'ACH7',29:'ACA4',30:'AB7',31:'AR3',32:'AB6',33:'ACH6',35:'ACH5',36:'ACA2',37:'ACA3',38:'ACA1',39:'AB3',40:'ACH2',41:'AB2',42:'ACH1',43:'ACH4',44:'ACH3',45:'AB5',46:'AB1',47:'AR4',48:'AB4',49:'AB8',50:'ACH8',51:'ACA5',79:'AB9',80:'AR5',84:'ACA6',85:'ACH9'};
  function route() {
    var url = new URL(window.location.href);
    if (!/^\/17\/?$/.test(url.pathname) || url.searchParams.has('mode')) return null;
    var id = url.searchParams.get('idx');
    return id ? (CODES[id] ? 'detail' : null) : 'list';
  }
  var kind = route();
  if (!kind || Date.now() >= END) return;
  window.__apVideoCountdown20260906 = true;
  var timer, observer, observerTimeout, root, stopped = false;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var style = document.createElement('style');
  style.id = 'ap-video-countdown-style';
  style.textContent = `
    .ap-price-countdown{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:24px;margin:24px 0 32px;padding:22px 26px;border-block:1px solid #dedbd7;border-left:3px solid #ae392d;background:#fff;color:#252321;font:inherit;letter-spacing:0}
    .ap-price-countdown *{box-sizing:border-box;letter-spacing:0}
    .ap-price-countdown.ap-price-countdown--list{width:calc(100% - 30px);max-width:1250px;margin-inline:auto}
    .ap-price-countdown__copy{min-width:0}
    .ap-price-countdown__title{display:block;font-size:20px!important;font-weight:750;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere}
    .ap-price-countdown__copy p{margin:5px 0 0!important;font-size:14px!important;line-height:1.65;color:#68635f;word-break:keep-all;overflow-wrap:anywhere}
    .ap-price-countdown__clock{flex:0 0 auto;min-width:236px}
    .ap-price-countdown__label{display:block;margin-bottom:8px;font-size:12px;line-height:1.5;color:#68635f}
    .ap-price-countdown__digits{display:grid;grid-template-columns:repeat(4,max-content);justify-content:space-between;gap:14px}
    .ap-price-countdown__unit{display:flex;align-items:baseline;gap:5px;white-space:nowrap;font-size:11px;color:#68635f}
    .ap-price-countdown__number{display:inline-block;flex-shrink:0;width:2.2ch;height:1.25em;font-size:28px;font-weight:750;line-height:1.25;font-variant-numeric:tabular-nums;color:#ae392d}
    .ap-price-countdown--detail{margin:18px 0 22px;padding:17px 0;border-left:0;flex-wrap:wrap;gap:16px}
    .ap-price-countdown--detail .ap-price-countdown__title{font-size:16px!important}
    .ap-price-countdown--detail .ap-price-countdown__copy p{font-size:13px!important}
    .ap-price-countdown--detail .ap-price-countdown__number{font-size:22px}
    .ap-price-countdown--detail .ap-price-countdown__clock{min-width:216px}
    @media(max-width:767px){.ap-price-countdown{align-items:stretch;flex-direction:column;gap:18px;padding:20px 17px;margin:20px 0 26px}.ap-price-countdown__title{font-size:18px!important}.ap-price-countdown__clock{min-width:0;max-width:300px}.ap-price-countdown__digits{gap:10px}.ap-price-countdown__number{font-size:27px}.ap-price-countdown--detail{padding:16px 0;gap:13px}.ap-price-countdown--detail .ap-price-countdown__clock{min-width:0}}
    @media(prefers-reduced-motion:reduce){.ap-price-countdown *{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(style);
  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(observerTimeout);
    if (observer) observer.disconnect();
    if (root) root.remove();
    style.remove();
  }
  function tick() {
    clearTimeout(timer);
    if (stopped || route() !== kind || Date.now() >= END) { stop(); return; }
    if (document.hidden) return;
    var seconds = Math.ceil((END - Date.now()) / 1000);
    var values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
    root.querySelectorAll('.ap-price-countdown__number').forEach(function (node, index) {
      var next = String(values[index]).padStart(2, '0');
      if (node.textContent === next) return;
      var hadValue = node.textContent !== '';
      node.textContent = next;
      if (hadValue && !reduced.matches && node.animate) node.animate([{opacity:0.45,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}], {duration:180,easing:'ease-out'});
    });
    timer = setTimeout(tick, 1010 - Date.now() % 1000);
  }
  function mount() {
    if (stopped || route() !== kind || Date.now() >= END) { stop(); return true; }
    var anchor;
    if (kind === 'detail') {
      var code = CODES[new URL(location.href).searchParams.get('idx')];
      var title = document.querySelector('.view_tit');
      if (!title || !(new RegExp('\\b' + code + '\\b')).test(title.textContent)) return false;
      anchor = document.querySelector('.pay_detail');
    } else {
      anchor = document.querySelector('.ap-video-sales');
    }
    if (!anchor) return false;
    root = document.createElement('aside');
    root.className = 'ap-price-countdown ap-price-countdown--' + kind;
    root.setAttribute('aria-label', '영상 클래스 가격 변경 안내');
    root.setAttribute('data-testid', 'video-price-countdown');
    root.setAttribute('data-ap-countdown', '2026-09-06a');
    root.innerHTML = '<div class="ap-price-countdown__copy"><strong class="ap-price-countdown__title">9월 30일까지 15,000원</strong><p>10월 1일부터 영상당 20,000원으로 변경됩니다.</p></div><div class="ap-price-countdown__clock" role="timer" aria-live="off" aria-label="가격 변경: 2026년 10월 1일 0시, 한국시간"><span class="ap-price-countdown__label">가격 변경까지</span><div class="ap-price-countdown__digits" aria-hidden="true">' + ['일','시간','분','초'].map(function (unit) { return '<span class="ap-price-countdown__unit"><b class="ap-price-countdown__number"></b><span>' + unit + '</span></span>'; }).join('') + '</div></div>';
    anchor.insertAdjacentElement(kind === 'list' ? 'beforebegin' : 'afterend', root);
    if (observer) observer.disconnect();
    clearTimeout(observerTimeout);
    tick();
    return true;
  }
  function start() {
    if (mount()) return;
    // Observe only startup anchors, never the one-second digit updates.
    observer = new MutationObserver(mount);
    observer.observe(document.body, {childList:true,subtree:true});
    observerTimeout = setTimeout(function () { if (!root) stop(); }, 15000);
  }
  document.addEventListener('visibilitychange', function () { if (root && !stopped) tick(); });
  window.addEventListener('pagehide', function () { clearTimeout(timer); });
  window.addEventListener('pageshow', function () { if (root && !stopped) tick(); });
  window.addEventListener('popstate', function () { if (route() !== kind) stop(); });
  if (reduced.addEventListener) reduced.addEventListener('change', function () {
    if (reduced.matches && root && root.getAnimations) root.getAnimations({subtree:true}).forEach(function (animation) { animation.cancel(); });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
