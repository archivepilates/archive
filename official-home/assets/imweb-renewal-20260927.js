(function () {
  "use strict";
  if (window.__apRenewal20260927 || /^\/admin|^\/_\//.test(location.pathname)) return;
  window.__apRenewal20260927 = true;
  var observer, timer, pending;
  function each(selector, fn) { document.querySelectorAll(selector).forEach(fn); }
  function home() {
    if (!/^\/(?:index)?\/?$/.test(location.pathname)) return;
    var root = document.getElementById("archive-pilates-site");
    if (!root) return;
    document.documentElement.setAttribute("data-ap-renewal-home", "true");
    var nativeMain = root.closest("main");
    if (nativeMain) nativeMain.querySelectorAll(":scope > .inside > .doz_row").forEach(function (row) { row.classList.add("ap-renewal-home-row"); });
    var classes = root.querySelector("#apb-class"), review = root.querySelector("#apb-review");
    if (classes && review && !classes.dataset.apRenewalOrder) {
      review.before(classes);
      classes.dataset.apRenewalOrder = "true";
    }
    each("#apb-home .apb-actions a", function (link) {
      var path = new URL(link.href, location.href).pathname.replace(/\/$/, "");
      var label = path === "/18" ? "강사레슨 예약" : path === "/17" ? "강사레슨 영상구매" : "";
      if (label && link.textContent !== label) link.textContent = label;
    });
  }
  function knitido() {
    var root = document.querySelector(".ap-knitido-brand-intro");
    if (!root || root.querySelector(".ap-renewal-story")) return;
    var story = root.querySelector(".ap-knitido-brand-story");
    if (!story) return;
    var details = document.createElement("details");
    details.className = "ap-renewal-story";
    var summary = document.createElement("summary");
    summary.textContent = "아카이브가 바라본 니티도 이야기";
    details.appendChild(summary);
    story.before(details);
    details.appendChild(story);
    var note = root.querySelector(".ap-knitido-brand-note");
    if (note) details.appendChild(note);
  }
  function detailTitle() {
    if (!/^\/17\/?$/.test(location.pathname) || !new URLSearchParams(location.search).has("idx")) return;
    each(".goods_detail h1.view_tit, .goods_form h1.view_tit", function (heading) {
      if (heading.dataset.apRenewalTitle) return;
      // Preserve controls such as the wishlist button and the product code.
      Array.from(heading.childNodes).forEach(function (node) {
        if (node.nodeType !== 3) return;
        node.textContent = node.textContent.replace(/\[온라인\]\s*ARCHIVE METHOD\s*/g, "").replace(/\s*40D 이용권/g, "");
      });
      heading.dataset.apRenewalTitle = "true";
    });
  }
  function lessonStatus() {
    if (!/^\/18\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("idx") !== "1") return;
    var options = document.querySelector("#prod_options");
    if (!options || document.querySelector(".ap-renewal-schedule")) return;
    var rows = Array.from(options.querySelectorAll(".dropdown-menu .dropdown-item > a._requireOption"));
    if (!rows.length) return;
    var block = document.createElement("section");
    block.className = "ap-renewal-schedule";
    block.setAttribute("aria-label", "수강일별 모집 현황");
    var heading = document.createElement("h2");
    heading.textContent = "수강일별 모집 현황";
    block.appendChild(heading);
    var anyClosed = false;
    rows.forEach(function (option) {
      var text = option.textContent.replace(/\s+/g, " ").trim();
      var soldOut = /품절/.test(text);
      anyClosed = anyClosed || soldOut;
      var row = document.createElement("p");
      row.textContent = text.replace(/\s*\(품절\)/g, "") + " · " + (soldOut ? "예약 마감" : "예약 가능");
      block.appendChild(row);
    });
    if (anyClosed) {
      var waitlist = document.createElement("a");
      waitlist.href = "https://pf.kakao.com/_AHdvn/chat";
      waitlist.textContent = "마감일 대기 신청";
      block.appendChild(waitlist);
    }
    var productBodies = document.querySelectorAll(".shop_view_body");
    // Imweb keeps separate desktop/mobile bodies; each inherits its native visibility.
    if (productBodies.length) productBodies.forEach(function (body, index) { body.prepend(index ? block.cloneNode(true) : block); });
    else options.before(block);
  }
  function run() {
    pending = false;
    document.documentElement.setAttribute("data-ap-renewal", "2026-09-27a");
    home();
    detailTitle();
    knitido();
    lessonStatus();
  }
  function start() {
    if (observer) observer.disconnect();
    clearTimeout(timer);
    run();
    observer = new MutationObserver(function (records) {
      if (pending || !records.some(function (r) { return r.addedNodes.length; })) return;
      pending = true;
      requestAnimationFrame(run);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(function () { observer.disconnect(); }, 12000);
  }
  document.addEventListener("archive:shop-route-change", start);
  window.addEventListener("pageshow", start);
  window.addEventListener("pagehide", function () { if (observer) observer.disconnect(); clearTimeout(timer); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
