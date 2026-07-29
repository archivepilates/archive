(function () {
  "use strict";

  var VERSION = "2026-07-29c";
  var STYLE_ID = "archive-pilates-knitido-shipping-style";
  var CATEGORY_NOTICE_ID = "archive-pilates-knitido-shipping-notice";
  var DETAIL_NOTICE_ATTR = "data-archive-pilates-knitido-shipping-detail";

  function isKnitidoCategory() {
    var path = String(window.location.pathname || "").replace(/\/$/, "");
    if (path !== "/16" && path !== "/shop") return false;
    try {
      return new URLSearchParams(window.location.search || "").get("ap_shop") === "knitido";
    } catch (error) {
      return false;
    }
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-archive-pilates-knitido-shipping-style", VERSION);
    style.textContent = [
      "html body .ap-knitido-shipping-notice{margin:28px 0 4px;padding:24px;border:1px solid #ded6cc;background:#fffdfa;color:#1f1b18;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR','Segoe UI',sans-serif;letter-spacing:0;word-break:keep-all}",
      "html body .ap-knitido-shipping-notice-label{margin:0 0 7px;color:#9a3324;font-size:12px;font-weight:900;line-height:1.4;letter-spacing:.12em}",
      "html body .ap-knitido-shipping-notice h2{margin:0 0 17px;color:#171412;font-size:clamp(20px,2.2vw,28px);font-weight:850;line-height:1.3;letter-spacing:0}",
      "html body .ap-knitido-shipping-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0;border-top:1px solid #e7e1d8}",
      "html body .ap-knitido-shipping-fact{min-width:0;padding:16px 16px 2px 0}",
      "html body .ap-knitido-shipping-fact+.ap-knitido-shipping-fact{padding-left:16px;border-left:1px solid #e7e1d8}",
      "html body .ap-knitido-shipping-fact dt{margin:0 0 6px;color:#756b62;font-size:12px;font-weight:750;line-height:1.45}",
      "html body .ap-knitido-shipping-fact dd{margin:0;color:#211d1a;font-size:14px;font-weight:760;line-height:1.55}",
      "html body .ap-knitido-shipping-note{margin:15px 0 0;color:#6b625a;font-size:13px;line-height:1.72}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail{margin:4px 0 18px;padding:18px 20px;border:1px solid #ded6cc;background:#fffdfa;color:#211d1a;box-sizing:border-box}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:0}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail div{min-width:0;padding:0 14px}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail div:first-child{padding-left:0}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail div+div{border-left:1px solid #e7e1d8}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail dt{margin:0 0 5px;color:#756b62;font-size:12px;font-weight:750;line-height:1.45}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail dd{margin:0;color:#211d1a;font-size:14px;font-weight:760;line-height:1.55}",
      "html body .archive-knitido-product .ap-knitido-shipping-detail p{margin:14px 0 0;color:#6b625a;font-size:13px;line-height:1.72}",
      "@media(max-width:760px){html body .ap-knitido-shipping-notice{margin-top:24px;padding:20px 18px}html body .ap-knitido-shipping-facts{grid-template-columns:repeat(2,minmax(0,1fr))}html body .ap-knitido-shipping-fact:nth-child(3){padding-left:0;border-left:0;border-top:1px solid #e7e1d8}html body .ap-knitido-shipping-fact:nth-child(4){border-top:1px solid #e7e1d8}html body .archive-knitido-product .ap-knitido-shipping-detail dl{grid-template-columns:1fr}html body .archive-knitido-product .ap-knitido-shipping-detail div{padding:11px 0}html body .archive-knitido-product .ap-knitido-shipping-detail div:first-child{padding-top:0}html body .archive-knitido-product .ap-knitido-shipping-detail div+div{border-left:0;border-top:1px solid #e7e1d8}}",
      "@media(max-width:420px){html body .ap-knitido-shipping-facts{grid-template-columns:1fr}html body .ap-knitido-shipping-fact{padding:13px 0}html body .ap-knitido-shipping-fact+.ap-knitido-shipping-fact{padding-left:0;border-left:0;border-top:1px solid #e7e1d8}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function shippingFactsHtml(includeFee) {
    var facts = [
      ["평균 배송일", "결제 완료 후 영업일 기준 2~3일"],
      ["출고 일정", "재고 확인 후 영업일 기준 1~2일 이내"],
      ["최대 배송 완료일", "결제일로부터 14일 이내"]
    ];
    if (includeFee) facts.push(["기본 배송비", "3,000원 · 조건부 무료배송 없음"]);

    return (
      '<dl class="ap-knitido-shipping-facts">' +
      facts
        .map(function (fact) {
          return (
            '<div class="ap-knitido-shipping-fact"><dt>' +
            fact[0] +
            "</dt><dd>" +
            fact[1] +
            "</dd></div>"
          );
        })
        .join("") +
      "</dl>"
    );
  }

  function categoryNoticeHtml() {
    return (
      '<section id="' +
      CATEGORY_NOTICE_ID +
      '" class="ap-knitido-shipping-notice" data-archive-pilates-knitido-shipping="' +
      VERSION +
      '" aria-labelledby="archive-pilates-knitido-shipping-title">' +
      '<p class="ap-knitido-shipping-notice-label">배송 안내</p>' +
      '<h2 id="archive-pilates-knitido-shipping-title">니티도 실물상품 배송 기준</h2>' +
      shippingFactsHtml(true) +
      '<p class="ap-knitido-shipping-note">주말·공휴일 주문, 도서산간 지역 및 택배사 사정에 따라 배송이 지연될 수 있습니다. 지연이 예상되면 사전에 안내하며, 결제일로부터 14일 이내 배송이 어려운 경우 취소·환불을 지원합니다.</p>' +
      "</section>"
    );
  }

  function ensureCategoryNotice() {
    var existing = document.getElementById(CATEGORY_NOTICE_ID);
    if (!isKnitidoCategory()) {
      if (existing) existing.remove();
      return;
    }

    var intro = document.getElementById("ap-knitido-brand-intro");
    if (!intro) return;
    var heading = intro.querySelector(".ap-knitido-products-heading");
    if (!heading) return;

    if (existing && existing.getAttribute("data-archive-pilates-knitido-shipping") === VERSION) {
      return;
    }
    if (existing) existing.remove();

    var holder = document.createElement("div");
    holder.innerHTML = categoryNoticeHtml();
    heading.parentNode.insertBefore(holder.firstElementChild, heading);
  }

  function detailNoticeHtml() {
    return (
      '<div class="ap-knitido-shipping-detail" ' +
      DETAIL_NOTICE_ATTR +
      '="' +
      VERSION +
      '" role="note">' +
      shippingFactsHtml(false) +
      '<p>주말·공휴일 주문, 도서산간 지역 및 택배사 사정에 따라 배송이 지연될 수 있습니다. 지연이 예상되면 사전에 안내하며, 결제일로부터 14일 이내 배송이 어려운 경우 취소·환불을 지원합니다.</p>' +
      "</div>"
    );
  }

  function findShippingSection(root) {
    var sections = Array.prototype.slice.call(root.querySelectorAll("section"));
    return (
      sections.find(function (section) {
        var heading = section.querySelector("h2,h3,h4");
        return heading && /배송\s*및\s*교환/.test(String(heading.textContent || ""));
      }) || null
    );
  }

  function ensureDetailNotices() {
    Array.prototype.slice.call(document.querySelectorAll(".archive-knitido-product")).forEach(
      function (root) {
        var section = findShippingSection(root);
        if (!section) return;

        var existing = section.querySelector("[" + DETAIL_NOTICE_ATTR + "]");
        if (existing && existing.getAttribute(DETAIL_NOTICE_ATTR) === VERSION) return;
        if (existing) existing.remove();

        var sectionText = String(section.textContent || "").replace(/\s+/g, " ");
        if (
          sectionText.indexOf("평균 배송일") !== -1 &&
          sectionText.indexOf("결제일로부터 14일 이내") !== -1
        ) {
          return;
        }

        var heading = section.querySelector("h2,h3,h4");
        if (!heading) return;
        var holder = document.createElement("div");
        holder.innerHTML = detailNoticeHtml();
        heading.insertAdjacentElement("afterend", holder.firstElementChild);
        root.setAttribute("data-archive-pilates-knitido-shipping-review", VERSION);
      }
    );
  }

  var pending = false;
  function run() {
    pending = false;
    addStyle();
    ensureCategoryNotice();
    ensureDetailNotices();
    document.documentElement.setAttribute(
      "data-archive-pilates-knitido-shipping-review",
      VERSION
    );
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.setTimeout(run, 90);
  }

  window.addEventListener("archive:shop-route-change", schedule);
  window.addEventListener("popstate", schedule);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  [180, 500, 1100, 2200, 4200, 6500].forEach(function (delay) {
    window.setTimeout(run, delay);
  });

  try {
    var observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(function () {
      observer.disconnect();
    }, 12000);
  } catch (error) {}
})();
