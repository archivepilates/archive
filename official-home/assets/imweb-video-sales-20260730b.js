(function () {
  "use strict";

  var VERSION = "2026-07-30b";
  var ORIGIN = "https://archivepilates.com";
  var ANALYTICS_ASSET = ORIGIN + "/assets/archive-analytics-20260729a.js?v=" + VERSION;
  var STYLE_ID = "archive-pilates-video-sales-style";
  var ROOT_CLASS = "ap-video-sales";
  var scheduled = false;

  var CATALOG = {
    27: { code: "AR1", title: "리포머 척추 정렬 & 코어 컨트롤", price: 15000 },
    28: { code: "ACH7", title: "체어 흉추가동성", price: 15000 },
    29: { code: "ACA4", title: "캐딜락 흉추가동성", price: 15000 },
    30: { code: "AB7", title: "바렐 요추안정화", price: 15000 },
    31: { code: "AR3", title: "리포머 요추안정화", price: 15000 },
    32: { code: "AB6", title: "바렐 직장인 증후군", price: 15000 },
    33: { code: "ACH6", title: "체어 직장인 증후군", price: 15000 },
    34: { code: "AR2-1", title: "리포머 챌린지 동작 빌드업", price: 15000 },
    35: { code: "ACH5", title: "체어 고강도 필라테스", price: 15000 },
    36: { code: "ACA2", title: "캐딜락 경추보호 코어강화", price: 15000 },
    37: { code: "ACA3", title: "캐딜락 고강도 필라테스", price: 15000 },
    38: { code: "ACA1", title: "캐딜락 보상패턴 바로잡기", price: 15000 },
    39: { code: "AB3", title: "바렐 척추 유연성 & 어깨 안정화", price: 15000 },
    40: { code: "ACH2", title: "체어 림프 순환 & 척추 컨트롤", price: 15000 },
    41: { code: "AB2", title: "바렐 척추 신장 & 복부 컨트롤", price: 15000 },
    42: { code: "ACH1", title: "체어 골반 & 체간 안정화", price: 15000 },
    43: { code: "ACH4", title: "체어 골반 안정화 & 비대칭 교정", price: 15000 },
    44: { code: "ACH3", title: "체어 정렬 인지 & 체간 안정화", price: 15000 },
    45: { code: "AB5", title: "바렐 크로스패턴", price: 15000 },
    46: { code: "AB1", title: "바렐 척추 신장 & 흉곽 안정화", price: 15000 },
    47: { code: "AR4", title: "리포머 순환", price: 15000 },
    48: { code: "AB4", title: "바렐 전신 근막 FLOW", price: 15000 },
    49: { code: "AB8", title: "바렐 순환", price: 15000 },
    50: { code: "ACH8", title: "체어 호흡", price: 15000 },
    51: { code: "ACA5", title: "캐딜락 호흡", price: 15000 },
    79: { code: "AB9", title: "바렐 골반·고관절", price: 15000 },
    80: { code: "AR5", title: "리포머 골반·고관절", price: 15000 }
  };

  var BEST = [
    { idx: 44, label: "BEST 01", reason: "정렬 인지에서 체간 안정화로 이어지는 시작점" },
    { idx: 79, label: "BEST 02", reason: "최근 가장 빠르게 선택된 주제" },
    { idx: 47, label: "BEST 03", reason: "다른 기구로 확장하기 좋은 FLOW" }
  ];

  var ROUTES = [
    {
      title: "호흡과 중심",
      copy: "호흡을 움직임에 연결하고 중심을 다시 세웁니다.",
      items: [50, 51]
    },
    {
      title: "골반·고관절",
      copy: "골반의 위치와 고관절 움직임을 기구별로 비교합니다.",
      items: [79, 80]
    },
    {
      title: "순환과 FLOW",
      copy: "동작 사이의 연결과 회복까지 끊기지 않게 구성합니다.",
      items: [49, 47]
    },
    {
      title: "정렬과 코어",
      copy: "보상 패턴을 관찰하고 체간 안정화로 이어갑니다.",
      items: [27, 44]
    }
  ];

  var NEXT_BY_CODE = {
    ACH8: 51,
    ACA5: 44,
    AB9: 80,
    AR5: 79,
    AB8: 47,
    AR4: 49,
    AR1: 44,
    ACH3: 27
  };
  var NEXT_PRIORITY = ["ACH8", "AB9", "AB8", "AR1", "ACA5", "AR5", "AR4", "ACH3"];

  function currentPath() {
    return String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  }

  function currentIndex() {
    var raw = new URLSearchParams(window.location.search || "").get("idx");
    var idx = Number(raw || 0);
    return Number.isFinite(idx) ? idx : 0;
  }

  function productUrl(idx) {
    return "/17/?idx=" + idx;
  }

  function itemPayload(idx, listId, listName) {
    var product = CATALOG[idx];
    if (!product) return null;
    return {
      item_id: product.code,
      item_name: product.title,
      item_brand: "ARCHIVE PILATES",
      item_category: "온라인 클래스",
      item_list_id: listId || undefined,
      item_list_name: listName || undefined,
      price: product.price,
      currency: "KRW",
      quantity: 1
    };
  }

  function track(eventName, parameters) {
    if (typeof window.apArchiveTrack === "function") {
      window.apArchiveTrack(eventName, parameters || {});
      return;
    }
    window.__apArchiveAnalyticsQueue = window.__apArchiveAnalyticsQueue || [];
    window.__apArchiveAnalyticsQueue.push({
      eventName: eventName,
      parameters: parameters || {}
    });
  }

  function loadAnalytics() {
    if (typeof window.apArchiveTrack === "function") return;
    if (document.querySelector('script[data-archive-pilates-analytics-loader="' + VERSION + '"]')) return;
    var script = document.createElement("script");
    script.src = ANALYTICS_ASSET;
    script.defer = true;
    script.setAttribute("data-archive-pilates-analytics-loader", VERSION);
    (document.head || document.documentElement).appendChild(script);
  }

  function formatPrice(value) {
    try {
      return Number(value || 0).toLocaleString("ko-KR") + "원";
    } catch (error) {
      return String(value || 0) + "원";
    }
  }

  function liveProducts() {
    var products = {};
    Array.prototype.slice.call(document.querySelectorAll(".shop-item._shop_item")).forEach(function (item) {
      var data = {};
      try {
        data = JSON.parse(item.getAttribute("data-product-properties") || "{}");
      } catch (error) {}
      var idx = Number(data.idx || 0);
      if (!idx || !CATALOG[idx]) return;
      products[idx] = {
        idx: idx,
        name: data.name || CATALOG[idx].title,
        image: data.image_url || "",
        price: Number(data.price || CATALOG[idx].price)
      };
    });
    return products;
  }

  function installStyle() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.setAttribute("data-archive-pilates-video-sales-style", VERSION);
    style.textContent = [
      "html body ." + ROOT_CLASS + "{width:min(1250px,calc(100% - 36px));margin:0 auto clamp(38px,6vw,78px);box-sizing:border-box;color:#1b1815}",
      "html body ." + ROOT_CLASS + " *{box-sizing:border-box}",
      "html body ." + ROOT_CLASS + "__section{padding:clamp(32px,5vw,58px) 0;border-top:1px solid #ded6cc}",
      "html body ." + ROOT_CLASS + "__head{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,460px);gap:24px;align-items:end;margin:0 0 24px}",
      "html body ." + ROOT_CLASS + "__eyebrow{margin:0 0 8px;color:#9a3324;font-size:12px;font-weight:850;line-height:1.35;letter-spacing:.12em}",
      "html body ." + ROOT_CLASS + " h2{margin:0;color:#171412;font-size:clamp(26px,3vw,38px);font-weight:850;line-height:1.18;letter-spacing:0;word-break:keep-all}",
      "html body ." + ROOT_CLASS + "__copy{margin:0;color:#675e57;font-size:15px;font-weight:500;line-height:1.7;word-break:keep-all}",
      "html body ." + ROOT_CLASS + "__best{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}",
      "html body ." + ROOT_CLASS + "__best-card{display:flex;min-width:0;flex-direction:column;border:1px solid #ded6cc;background:#fffdfa;color:#171412!important;text-decoration:none!important;transition:transform .2s ease,border-color .2s ease}",
      "html body ." + ROOT_CLASS + "__best-card:hover,html body ." + ROOT_CLASS + "__best-card:focus-visible{transform:translateY(-3px);border-color:#171412;outline:none}",
      "html body ." + ROOT_CLASS + "__media{position:relative;aspect-ratio:16/9;overflow:hidden;background:#ede7df}",
      "html body ." + ROOT_CLASS + "__media img{display:block;width:100%;height:100%;object-fit:cover}",
      "html body ." + ROOT_CLASS + "__rank{position:absolute;left:12px;top:12px;padding:7px 9px;background:#171412;color:#fff;font-size:11px;font-weight:850;line-height:1;letter-spacing:.08em}",
      "html body ." + ROOT_CLASS + "__best-body{display:flex;min-height:154px;flex-direction:column;padding:18px}",
      "html body ." + ROOT_CLASS + "__best-body strong{font-size:19px;line-height:1.38;letter-spacing:0;word-break:keep-all}",
      "html body ." + ROOT_CLASS + "__reason{margin:9px 0 20px;color:#675e57;font-size:14px;line-height:1.55}",
      "html body ." + ROOT_CLASS + "__price{margin-top:auto;color:#211d1a;font-size:14px;font-weight:850}",
      "html body ." + ROOT_CLASS + "__routes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}",
      "html body ." + ROOT_CLASS + "__route{min-width:0;padding:22px;border:1px solid #ded6cc;background:#fffdfa}",
      "html body ." + ROOT_CLASS + "__route h3{margin:0 0 8px;font-size:20px;line-height:1.35;letter-spacing:0}",
      "html body ." + ROOT_CLASS + "__route p{min-height:48px;margin:0 0 18px;color:#675e57;font-size:14px;line-height:1.6}",
      "html body ." + ROOT_CLASS + "__route-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      "html body ." + ROOT_CLASS + "__route-links a{display:inline-flex;min-height:44px;align-items:center;padding:9px 12px;border:1px solid #cfc5bb;background:#fff;color:#1b1815!important;text-decoration:none!important;font-size:13px;font-weight:850}",
      "html body ." + ROOT_CLASS + "__route-links a:hover,html body ." + ROOT_CLASS + "__route-links a:focus-visible{border-color:#9a3324;color:#9a3324!important;outline:none}",
      "html body ." + ROOT_CLASS + "__all{display:flex;align-items:end;justify-content:space-between;gap:18px;margin:clamp(38px,6vw,72px) 0 18px;padding-top:clamp(30px,4vw,48px);border-top:1px solid #ded6cc}",
      "html body ." + ROOT_CLASS + "__all p{margin:0;color:#675e57;font-size:14px;line-height:1.6}",
      ".ap-next-video{max-width:1080px;margin:24px auto 0;padding:22px;border:1px solid #ded6cc;background:#fbf7f1;color:#181614}",
      ".ap-next-video__eyebrow{margin:0 0 8px;color:#9a3324;font-size:11px;font-weight:900;letter-spacing:.1em}",
      ".ap-next-video__row{display:flex;align-items:end;justify-content:space-between;gap:18px}.ap-next-video h2{margin:0 0 7px;font-size:21px;line-height:1.35;letter-spacing:0}.ap-next-video p{margin:0;color:#675e57;line-height:1.6}",
      ".ap-next-video__link{display:inline-flex;min-height:44px;flex:0 0 auto;align-items:center;justify-content:center;padding:10px 15px;border:1px solid #181614;background:#181614;color:#fff!important;text-decoration:none!important;font-weight:850}",
      "@media(max-width:760px){html body ." + ROOT_CLASS + "{width:calc(100% - 30px)}html body ." + ROOT_CLASS + "__head{grid-template-columns:1fr;gap:12px}html body ." + ROOT_CLASS + "__best{grid-template-columns:1fr}html body ." + ROOT_CLASS + "__best-body{min-height:0}html body ." + ROOT_CLASS + "__routes{grid-template-columns:1fr}html body ." + ROOT_CLASS + "__route p{min-height:0}html body ." + ROOT_CLASS + "__all{display:block}html body ." + ROOT_CLASS + "__all p{margin-top:8px}.ap-next-video{margin:22px 15px 0;padding:19px}.ap-next-video__row{display:block}.ap-next-video__link{width:100%;margin-top:16px}}",
      "@media(prefers-reduced-motion:reduce){html body ." + ROOT_CLASS + "__best-card{transition:none!important;transform:none!important}}"
    ].join("");
  }

  function bestCard(entry, product) {
    var catalog = CATALOG[entry.idx];
    var image = product && product.image ? product.image : "";
    return [
      '<a class="' + ROOT_CLASS + '__best-card" href="' + productUrl(entry.idx) + '" data-ap-sales-item="' + entry.idx + '" data-ap-sales-list="video_best">',
      '<span class="' + ROOT_CLASS + '__media">',
      image
        ? '<img src="' + image.replace(/"/g, "&quot;") + '" alt="' + catalog.title + '" width="800" height="450" loading="lazy">'
        : "",
      '<span class="' + ROOT_CLASS + '__rank">' + entry.label + "</span>",
      "</span>",
      '<span class="' + ROOT_CLASS + '__best-body">',
      "<strong>" + catalog.title + "</strong>",
      '<span class="' + ROOT_CLASS + '__reason">' + entry.reason + "</span>",
      '<span class="' + ROOT_CLASS + '__price">' + catalog.code + " · " + formatPrice(catalog.price) + "</span>",
      "</span>",
      "</a>"
    ].join("");
  }

  function routeCard(route) {
    var links = route.items
      .map(function (idx) {
        var product = CATALOG[idx];
        return (
          '<a href="' +
          productUrl(idx) +
          '" data-ap-sales-item="' +
          idx +
          '" data-ap-sales-list="video_topic_routes">' +
          product.code +
          " · " +
          product.title.replace(/^(리포머|캐딜락|바렐|체어)\s*/, "") +
          "</a>"
        );
      })
      .join('<span aria-hidden="true">→</span>');
    return [
      '<article class="' + ROOT_CLASS + '__route">',
      "<h3>" + route.title + "</h3>",
      "<p>" + route.copy + "</p>",
      '<nav class="' + ROOT_CLASS + '__route-links" aria-label="' + route.title + ' 추천 순서">' + links + "</nav>",
      "</article>"
    ].join("");
  }

  function ensureCurated() {
    if (currentPath() !== "/17" || currentIndex()) return;
    var products = liveProducts();
    if (Object.keys(products).length < 8) return;
    var main = document.querySelector("main");
    if (!main) return;

    var root = main.querySelector("." + ROOT_CLASS);
    if (!root) {
      root = document.createElement("section");
      root.className = ROOT_CLASS;
      root.setAttribute("aria-label", "영상구매 추천");
      var intro = main.querySelector(".ap-listing-intro[data-ap-listing-intro='video']");
      if (intro) intro.insertAdjacentElement("afterend", root);
      else main.insertBefore(root, main.firstChild);
    }

    if (root.getAttribute("data-archive-pilates-video-sales") !== VERSION) {
      root.innerHTML = [
        '<section class="' + ROOT_CLASS + '__section" aria-labelledby="ap-video-best-title">',
        '<div class="' + ROOT_CLASS + '__head"><div><p class="' + ROOT_CLASS + '__eyebrow">START HERE</p><h2 id="ap-video-best-title">처음이라면 이 세 편부터</h2></div>',
        '<p class="' + ROOT_CLASS + '__copy">구매 기록과 주제 확장성을 기준으로 고른 시작점입니다. 한 편을 보고 같은 주제를 다른 기구로 이어 보세요.</p></div>',
        '<div class="' + ROOT_CLASS + '__best">' +
          BEST.map(function (entry) {
            return bestCard(entry, products[entry.idx]);
          }).join("") +
          "</div></section>",
        '<section class="' + ROOT_CLASS + '__section" aria-labelledby="ap-video-route-title">',
        '<div class="' + ROOT_CLASS + '__head"><div><p class="' + ROOT_CLASS + '__eyebrow">LEARNING PATH</p><h2 id="ap-video-route-title">지금 필요한 방향으로 찾기</h2></div>',
        '<p class="' + ROOT_CLASS + '__copy">기구 이름보다 수업에서 풀고 싶은 문제를 먼저 고르면 다음 영상까지 자연스럽게 연결됩니다.</p></div>',
        '<div class="' + ROOT_CLASS + '__routes">' + ROUTES.map(routeCard).join("") + "</div>",
        '<div class="' + ROOT_CLASS + '__all"><div><p class="' + ROOT_CLASS + '__eyebrow">ALL CLASSES</p><h2>전체 영상</h2></div><p>기구별 전체 수업은 아래 목록에서 확인할 수 있습니다.</p></div>',
        "</section>"
      ].join("");
      root.setAttribute("data-archive-pilates-video-sales", VERSION);
    }

    if (!document.documentElement.hasAttribute("data-ap-ga-list-video")) {
      document.documentElement.setAttribute("data-ap-ga-list-video", VERSION);
      var items = Object.keys(products)
        .map(Number)
        .map(function (idx) {
          return itemPayload(idx, "video_all", "전체 온라인 클래스");
        })
        .filter(Boolean);
      track("view_item_list", {
        item_list_id: "video_all",
        item_list_name: "전체 온라인 클래스",
        currency: "KRW",
        items: items
      });
    }
  }

  function recommendationFromCodes(codes) {
    var owned = {};
    codes.forEach(function (code) {
      owned[code] = true;
    });
    for (var i = 0; i < NEXT_PRIORITY.length; i += 1) {
      var sourceCode = NEXT_PRIORITY[i];
      var idx = NEXT_BY_CODE[sourceCode];
      if (owned[sourceCode] && idx && !owned[CATALOG[idx].code]) {
        return { sourceCode: sourceCode, idx: idx };
      }
    }
    return null;
  }

  function recommendationMarkup(recommendation, context) {
    var product = CATALOG[recommendation.idx];
    return [
      '<aside class="ap-next-video" data-archive-pilates-next-video="' + VERSION + '" data-ap-next-context="' + context + '">',
      '<p class="ap-next-video__eyebrow">NEXT CLASS</p>',
      '<div class="ap-next-video__row"><div><h2>다음 추천 · ' + product.title + "</h2>",
      "<p>" + recommendation.sourceCode + " 다음에 같은 주제를 다른 기구로 이어 보세요.</p></div>",
      '<a class="ap-next-video__link" href="' + productUrl(recommendation.idx) + '" data-ap-next-item="' + recommendation.idx + '">추천 영상 보기</a></div>',
      "</aside>"
    ].join("");
  }

  function ensureClassroomRecommendation() {
    var path = currentPath();
    if (path !== "/48" && path !== "/my-classroom") return;
    var grid = document.querySelector(".apc-grid");
    if (!grid || grid.hidden || document.querySelector(".ap-next-video[data-ap-next-context='classroom']")) return;
    var codes = Array.prototype.slice.call(grid.querySelectorAll(".apc-code")).map(function (node) {
      return String(node.textContent || "").trim();
    });
    var recommendation = recommendationFromCodes(codes);
    if (!recommendation) return;
    grid.insertAdjacentHTML("afterend", recommendationMarkup(recommendation, "classroom"));
  }

  function ensureWatchRecommendation() {
    if (!document.querySelector(".ap-watch")) return;
    if (document.querySelector(".ap-next-video[data-ap-next-context='watch']")) return;
    var codeNode = document.querySelector("[data-archive-pilates-watch-code],.ap-watch__eyebrow,.ap-watch__meta");
    var text = String(codeNode && codeNode.textContent ? codeNode.textContent : document.title || "");
    var sourceCode = Object.keys(NEXT_BY_CODE).find(function (code) {
      return text.indexOf(code) >= 0 || currentPath().indexOf(code.toLowerCase()) >= 0;
    });
    if (!sourceCode) return;
    var recommendation = { sourceCode: sourceCode, idx: NEXT_BY_CODE[sourceCode] };
    var watch = document.querySelector(".ap-watch");
    watch.insertAdjacentHTML("afterend", recommendationMarkup(recommendation, "watch"));
  }

  function sendDetailView() {
    var idx = currentIndex();
    if (!idx || !CATALOG[idx]) return;
    var marker = "data-ap-ga-detail-" + idx;
    if (document.documentElement.hasAttribute(marker)) return;
    document.documentElement.setAttribute(marker, VERSION);
    track("view_item", {
      currency: "KRW",
      value: CATALOG[idx].price,
      items: [itemPayload(idx, "video_detail", "온라인 클래스 상세")]
    });
  }

  function onClick(event) {
    var anchor = event.target && event.target.closest ? event.target.closest("a[href],button") : null;
    if (!anchor) return;
    var itemNode = anchor.closest("[data-ap-sales-item]");
    if (itemNode) {
      var itemIdx = Number(itemNode.getAttribute("data-ap-sales-item") || 0);
      var listId = itemNode.getAttribute("data-ap-sales-list") || "video_all";
      track("select_item", {
        item_list_id: listId,
        item_list_name: listId === "video_best" ? "영상 베스트 3" : "주제별 학습 경로",
        items: [itemPayload(itemIdx, listId, listId)]
      });
      return;
    }
    var nativeLink = anchor.closest(".shop-item._shop_item a[href*='idx=']");
    if (nativeLink) {
      var nativeUrl = new URL(nativeLink.href, window.location.href);
      var nativeIdx = Number(nativeUrl.searchParams.get("idx") || 0);
      if (CATALOG[nativeIdx]) {
        track("select_item", {
          item_list_id: "video_all",
          item_list_name: "전체 온라인 클래스",
          items: [itemPayload(nativeIdx, "video_all", "전체 온라인 클래스")]
        });
      }
      return;
    }
    var nextLink = anchor.closest("[data-ap-next-item]");
    if (nextLink) {
      var nextIdx = Number(nextLink.getAttribute("data-ap-next-item") || 0);
      track("next_product_click", {
        source_context: nextLink.closest("[data-ap-next-context]")
          ? nextLink.closest("[data-ap-next-context]").getAttribute("data-ap-next-context")
          : "unknown",
        items: [itemPayload(nextIdx, "next_video", "다음 추천 영상")]
      });
      return;
    }
    var idx = currentIndex();
    var label = String(anchor.textContent || "").replace(/\s+/g, " ").trim();
    if (idx && CATALOG[idx] && /(구매하기|바로구매|결제하기)/.test(label)) {
      track("begin_checkout", {
        currency: "KRW",
        value: CATALOG[idx].price,
        items: [itemPayload(idx, "video_detail", "온라인 클래스 상세")]
      });
    }
  }

  function run() {
    scheduled = false;
    loadAnalytics();
    installStyle();
    ensureCurated();
    ensureClassroomRecommendation();
    ensureWatchRecommendation();
    sendDetailView();
    document.documentElement.setAttribute("data-archive-pilates-video-sales-runtime", VERSION);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(run);
  }

  document.addEventListener("click", onClick, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  window.addEventListener("pageshow", run);
  window.addEventListener("popstate", run);
  [200, 600, 1200, 2400, 4800, 7600].forEach(function (delay) {
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
