(function () {
  "use strict";

  var VERSION = "2026-09-06a";
  var STYLE_ID = "ap-video-discovery-style";
  var LIST_ID = "ap-video-discovery-all";
  var ROUTE_ATTR = "data-ap-video-discovery-route";
  var observer;
  var observerTimer;
  var pendingTimer;
  var intersection;
  var intersectionTimer;
  var filterState;
  var passes = 0;

  // Codes/titles: imweb-video-sales-20260730b.js CATALOG. Instructor labels:
  // public /17/?idx=<id> .goods_summary, read 2026-09-05. Never infer a person
  // from a thumbnail or turn the collective label into an individual name.
  // AB6, ACH6 and AB5: Minjin confirmed by the operator on 2026-09-06.
  // Product 34 is in CATALOG but absent from the live list; no instructor assumed.
  var CATALOG = {
    27: ["AR1", "리포머 척추 정렬 & 코어 컨트롤", "민진쌤"],
    28: ["ACH7", "체어 흉추가동성", "은영쌤"],
    29: ["ACA4", "캐딜락 흉추가동성", "민진쌤"],
    30: ["AB7", "바렐 요추안정화", "민진쌤"],
    31: ["AR3", "리포머 요추안정화", "은영쌤"],
    32: ["AB6", "바렐 직장인 증후군", "민진쌤"],
    33: ["ACH6", "체어 직장인 증후군", "민진쌤"],
    34: ["AR2-1", "리포머 챌린지 동작 빌드업", ""],
    35: ["ACH5", "체어 고강도 필라테스", "은영쌤"],
    36: ["ACA2", "캐딜락 경추보호 코어강화", "민진쌤"],
    37: ["ACA3", "캐딜락 고강도 필라테스", "은영쌤"],
    38: ["ACA1", "캐딜락 보상패턴 바로잡기", "민진쌤"],
    39: ["AB3", "바렐 척추 유연성 & 어깨 안정화", "민진쌤"],
    40: ["ACH2", "체어 림프 순환 & 척추 컨트롤", "민진쌤"],
    41: ["AB2", "바렐 척추 신장 & 복부 컨트롤", "민진쌤"],
    42: ["ACH1", "체어 골반 & 체간 안정화", "민진쌤"],
    43: ["ACH4", "체어 골반 안정화 & 비대칭 교정", "민진쌤"],
    44: ["ACH3", "체어 정렬 인지 & 체간 안정화", "민진쌤"],
    45: ["AB5", "바렐 크로스패턴", "민진쌤"],
    46: ["AB1", "바렐 척추 신장 & 흉곽 안정화", "민진쌤"],
    47: ["AR4", "리포머 순환", "민진쌤"],
    48: ["AB4", "바렐 전신 근막 FLOW", "민진쌤"],
    49: ["AB8", "바렐 순환", "은영쌤"],
    50: ["ACH8", "체어 호흡", "민진쌤"],
    51: ["ACA5", "캐딜락 호흡", "은영쌤"],
    79: ["AB9", "바렐 골반·고관절", "민진쌤"],
    80: ["AR5", "리포머 골반·고관절", "은영쌤"],
    84: ["ACA6", "캐딜락 지지와 움직임", "민진쌤"],
    85: ["ACH9", "체어 지지와 움직임", "은영쌤"]
  };

  function route() {
    // Positive route allowlist excludes classroom, watch, auth and other shops.
    var path = window.location.pathname.replace(/\/+$/, "");
    var params = new URLSearchParams(window.location.search);
    if (path !== "/17" || params.has("mode")) return "";
    if (!params.has("idx")) return "list";
    return /^\d+$/.test(params.get("idx")) && CATALOG[params.get("idx")] ? "detail" : "";
  }

  if (!route() || window.__apVideoDiscovery20260905) return;
  window.__apVideoDiscovery20260905 = VERSION;

  function text(node) {
    return String(node && node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function element(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    if (value) node.textContent = value;
    return node;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = element("style", "");
    style.id = STYLE_ID;
    var list = "html[" + ROUTE_ATTR + "='list'] body ";
    var detail = "html[" + ROUTE_ATTR + "='detail'] body ";
    style.textContent = [
      ".apvd-jump,.apvd-filters{display:none}",
      list + ".apvd-jump{display:inline-flex;align-items:center;min-height:54px;max-width:100%;margin-top:12px;color:#862e2e!important;font-size:15px;font-weight:700;text-decoration:underline!important;text-underline-offset:4px;letter-spacing:0;overflow-wrap:anywhere}",
      list + ".apvd-filters{display:block;min-width:0;margin:0 0 24px;padding:20px 0 0;border-top:1px solid #dedede;color:#222;scroll-margin-top:220px}",
      list + ".apvd-filters *{box-sizing:border-box;min-width:0;letter-spacing:0}",
      list + ".apvd-filters h2{margin:0 0 16px;font-size:24px;line-height:1.35;font-weight:750}",
      list + ".apvd-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}",
      list + ".apvd-field{display:flex;flex-direction:column;gap:6px;margin:0;font-size:13px;font-weight:650;color:#444}",
      list + ".apvd-field:last-child{grid-column:1/-1}",
      list + ".apvd-field select{display:block;width:100%;max-width:100%;height:54px;min-height:54px;margin:0;padding:8px 26px 8px 10px;border:1px solid #aaa;border-radius:4px;background-color:#fff;color:#222;font-family:inherit;font-size:16px;line-height:1.4;appearance:auto}",
      list + ".apvd-filter-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;min-height:52px;margin-top:8px}",
      list + ".apvd-count{margin:0;font-size:14px;color:#555}",
      list + ".apvd-reset{min-height:54px;padding:8px 0 8px 14px;border:0;background:transparent;color:#333;font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}",
      list + ".apvd-reset:disabled{color:#777;text-decoration:none;cursor:default}",
      list + ".apvd-empty{margin:12px 0 20px;color:#444;font-size:15px;line-height:1.65;word-break:keep-all;overflow-wrap:anywhere}",
      list + ".shop-item._shop_item[data-apvd-list-card]:not([data-apvd-filtered]){display:block!important}",
      list + "[data-apvd-filtered],[data-apvd-all-replaced]{display:none!important}",
      list + ".apvd-filters [hidden]{display:none!important}",
      list + ".apvd-curated{margin-bottom:28px;color:#222}",
      list + ".apvd-curated .ap-video-sales__section{padding:24px 0;border-color:#dedede}",
      list + ".apvd-curated h2{font-size:24px;line-height:1.35;letter-spacing:0}",
      list + ".apvd-curated .ap-video-sales__eyebrow," + list + ".apvd-curated .ap-video-sales__rank{letter-spacing:0}",
      list + ".apvd-curated .ap-video-sales__best-card{background:#fff;border-color:#ddd;transform:none}",
      list + ".apvd-curated .ap-video-sales__route{border:0;border-top:1px solid #ddd;padding:16px 0;background:transparent}",
      list + ".apvd-curated .ap-video-sales__route h3{font-size:18px;line-height:1.4}",
      list + ".apvd-curated .ap-video-sales__route p{min-height:0}",
      list + ".apvd-topics{border:0;padding:0}",
      list + ".apvd-topics>summary{min-height:54px;padding:14px 0;color:#333;font-size:15px;font-weight:650;cursor:pointer;list-style:revert}",
      list + ".apvd-topics .ap-video-sales__routes{margin-top:10px}",
      list + ".apvd-topics:not([open])>.ap-video-sales__routes{display:none}",
      list + ".apvd-curated .ap-video-sales__route-links{align-items:stretch}",
      list + ".apvd-curated .ap-video-sales__route-links a{min-height:54px;max-width:100%;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;letter-spacing:0}",
      list + ".apvd-jump:focus-visible," + list + ".apvd-filters :focus-visible," + list + ".apvd-curated :focus-visible{outline:2px solid #862e2e!important;outline-offset:3px!important}",
      detail + ".apvd-preview-heading{margin:24px 0 10px!important;font-size:18px!important;font-weight:700;line-height:1.4;letter-spacing:0}",
      detail + ".apvd-preview{position:relative!important;display:block;width:100%;max-width:960px;aspect-ratio:16/9;height:auto!important;padding:0!important;margin:0 0 26px!important;background:#111;box-sizing:border-box}",
      detail + ".apvd-preview>iframe{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;max-width:100%!important;border:0!important}",
      detail + "[data-apvd-duplicate-thumbnail]{display:none!important}",
      detail + ".apvd-preview-section>h2{font-size:24px!important;line-height:1.4!important;letter-spacing:0;word-break:keep-all;overflow-wrap:anywhere}",
      "@media(min-width:768px){" + list + ".apvd-fields{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)}" + list + ".apvd-field:last-child{grid-column:auto}}",
      "@media(max-width:767px){",
      list + ".apvd-curated .ap-video-sales__head{grid-template-columns:minmax(0,1fr);gap:8px;margin-bottom:14px}",
      list + ".apvd-curated h2{font-size:22px}",
      list + ".apvd-curated .ap-video-sales__copy{font-size:14px;line-height:1.6}",
      list + ".apvd-curated .ap-video-sales__best{grid-template-columns:minmax(0,1fr);gap:10px}",
      list + ".apvd-curated .ap-video-sales__best-card{display:grid;grid-template-columns:minmax(0,32%) minmax(0,1fr);align-items:center}",
      list + ".apvd-curated .ap-video-sales__media{width:100%;aspect-ratio:4/3;margin:0;align-self:start}",
      list + ".apvd-curated .ap-video-sales__media img{object-fit:contain;background:#f1f1f1}",
      list + ".apvd-curated .ap-video-sales__rank{left:0;top:0;padding:4px;font-size:10px}",
      list + ".apvd-curated .ap-video-sales__best-body{min-height:0;min-width:0;padding:10px}",
      list + ".apvd-curated .ap-video-sales__best-body strong{font-size:15px;line-height:1.45;word-break:keep-all;overflow-wrap:anywhere}",
      list + ".apvd-curated .ap-video-sales__reason{margin:5px 0 7px;font-size:12px;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere}",
      list + ".apvd-curated .ap-video-sales__price{font-size:12px;line-height:1.5}",
      list + ".apvd-curated .ap-video-sales__routes{grid-template-columns:minmax(0,1fr);gap:4px}",
      detail + ".apvd-preview-section>h2{font-size:22px!important}",
      "}",
      "@media(prefers-reduced-motion:reduce){" + list + ".apvd-curated a{transition:none!important;transform:none!important}}"
    ].join("");
    document.head.appendChild(style);
  }

  function readProduct(card) {
    var data = {};
    try {
      data = JSON.parse(card.getAttribute("data-product-properties") || "{}");
    } catch (error) {}
    if (!data || typeof data !== "object") data = {};
    var idx = Number(data.idx);
    if (!Number.isInteger(idx) || idx <= 0) {
      var link = card.querySelector("a[href*='idx=']");
      try { idx = Number(new URL(link.href).searchParams.get("idx")); }
      catch (error) { return null; }
    }
    if (!Number.isInteger(idx) || idx <= 0) return null;
    var name = typeof data.name === "string" ? data.name.trim() : text(card.querySelector(".shop-title,h2"));
    var code = name.match(/\(([A-Z][A-Z0-9-]*)\)/);
    var known = CATALOG[idx];
    // Current product data wins; a reused id/code mismatch inherits no metadata.
    if (!known || !code || known[0] !== code[1]) known = null;
    var title = name.replace(/^\[온라인\]\s*/, "").replace(/^ARCHIVE METHOD\s*/, "")
      .replace(/\s*\([A-Z][A-Z0-9-]*\).*$/, "").replace(/\s+\d+D\s*이용권.*$/, "").trim();
    var equipment = title.match(/^(리포머|체어|캐딜락|바렐)(?:\s*[·:]\s*|\s+)/);
    var sourceInstructor = typeof data.instructor === "string" ? data.instructor : data.instructor_name;
    if (known && (idx === 32 || idx === 33 || idx === 45) && typeof sourceInstructor === "string" && sourceInstructor.trim() === "아카이브 강사진") sourceInstructor = "";
    return {
      card: card,
      idx: idx,
      equipment: equipment ? equipment[1] : "",
      instructor: typeof sourceInstructor === "string" && sourceInstructor.trim() ? sourceInstructor.trim() : known ? known[2] : "",
      topic: equipment ? title.slice(equipment[0].length).trim() : ""
    };
  }

  function applyFilters() {
    if (!filterState || route() !== "list") return;
    var count = 0;
    var active = false;
    var values = {};
    filterState.fields.forEach(function (field) {
      values[field.key] = field.select.value;
      if (field.select.value) active = true;
    });
    filterState.items.forEach(function (item) {
      var matches = filterState.fields.every(function (field) {
        return !values[field.key] || item[field.key] === values[field.key];
      });
      if (matches) {
        count += 1;
        item.card.removeAttribute("data-apvd-filtered");
      } else if (!item.card.hasAttribute("data-apvd-filtered")) {
        item.card.setAttribute("data-apvd-filtered", "");
      }
    });
    var label = count + "편 / " + filterState.items.length + "편";
    if (filterState.count.textContent !== label) filterState.count.textContent = label;
    filterState.empty.hidden = count !== 0;
    filterState.reset.disabled = !active;
  }

  function resetFilters() {
    if (!filterState) return;
    filterState.fields.forEach(function (field) { field.select.value = ""; });
    applyFilters();
  }

  function ensureFilters(main) {
    var grid = Array.prototype.find.call(main.querySelectorAll(".shop-grid"), function (candidate) {
      return Array.prototype.some.call(candidate.querySelectorAll(".shop-item._shop_item"), readProduct);
    });
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".shop-item._shop_item"));
    var items = cards.map(readProduct).filter(Boolean);
    if (!items.length) return;
    // Legacy ap_equipment writes inline display values on this same public list.
    // Scope visibility ownership to actual list cards and preserve the URL choice.
    items.forEach(function (item) {
      if (!item.card.hasAttribute("data-apvd-list-card")) item.card.setAttribute("data-apvd-list-card", "");
    });
    if (!filterState || !filterState.panel.isConnected || filterState.grid !== grid) {
      if (filterState && filterState.panel.isConnected) filterState.panel.remove();
      var panel = element("section", "apvd-filters");
      panel.id = LIST_ID;
      panel.tabIndex = -1;
      panel.setAttribute("aria-labelledby", LIST_ID + "-title");
      var heading = element("h2", "", "전체 영상");
      heading.id = LIST_ID + "-title";
      panel.appendChild(heading);
      var fields = element("div", "apvd-fields");
      panel.appendChild(fields);
      var foot = element("div", "apvd-filter-foot");
      var count = element("p", "apvd-count");
      count.setAttribute("role", "status");
      count.setAttribute("aria-live", "polite");
      count.setAttribute("aria-atomic", "true");
      var reset = element("button", "apvd-reset", "필터 초기화");
      reset.type = "button";
      reset.addEventListener("click", resetFilters);
      foot.appendChild(count);
      foot.appendChild(reset);
      panel.appendChild(foot);
      var empty = element("p", "apvd-empty", "선택한 조건에 맞는 영상이 없습니다.");
      empty.hidden = true;
      panel.appendChild(empty);
      grid.before(panel);
      filterState = { grid: grid, panel: panel, items: items, fields: [], count: count, empty: empty, reset: reset };
      [["equipment", "기구"], ["instructor", "강사"], ["topic", "주제"]].forEach(function (entry) {
        var label = element("label", "apvd-field");
        label.appendChild(element("span", "", entry[1]));
        var select = element("select", "");
        select.setAttribute("aria-label", entry[1]);
        label.appendChild(select);
        fields.appendChild(label);
        select.addEventListener("change", applyFilters);
        filterState.fields.push({ key: entry[0], select: select, label: label, signature: null });
      });
    }
    filterState.items = items;
    filterState.fields.forEach(function (field) {
      var options = Array.from(new Set(items.map(function (item) { return item[field.key]; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, "ko"); });
      var signature = JSON.stringify(options);
      if (signature === field.signature) return;
      var selected = field.select.value;
      if (field.signature === null && field.key === "equipment") {
        var equipmentByKey = { reformer: "리포머", cadillac: "캐딜락", barrel: "바렐", chair: "체어" };
        selected = equipmentByKey[new URLSearchParams(window.location.search).get("ap_equipment")] || "";
      }
      field.select.replaceChildren(new Option("전체", ""));
      options.forEach(function (value) { field.select.add(new Option(value, value)); });
      field.select.value = options.indexOf(selected) >= 0 ? selected : "";
      field.label.hidden = !options.length;
      field.signature = signature;
    });
    applyFilters();
    var intro = main.querySelector(".ap-listing-intro[data-ap-listing-intro='video']");
    if (intro && !intro.querySelector(".apvd-jump")) {
      var jump = element("a", "apvd-jump", "전체 영상 바로 보기");
      jump.href = "#" + LIST_ID;
      jump.addEventListener("click", function (event) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        resetFilters();
        // Imweb delegates hash links to its own animated scroll handler. Keep
        // this one explicit and instantaneous, with no scroll-loop correction.
        window.history.replaceState(window.history.state, "", "#" + LIST_ID);
        filterState.panel.scrollIntoView({ behavior: "instant", block: "start" });
        filterState.panel.focus({ preventScroll: true });
      });
      intro.appendChild(jump);
    }
    var oldHeading = main.querySelector(".ap-video-sales__all");
    if (oldHeading && !oldHeading.hasAttribute("data-apvd-all-replaced")) oldHeading.setAttribute("data-apvd-all-replaced", "");
    if (document.documentElement.getAttribute("data-ap-video-discovery-ready") !== "list") document.documentElement.setAttribute("data-ap-video-discovery-ready", "list");
  }

  function ensureRecommendations(main) {
    var root = main.querySelector(".ap-video-sales");
    if (!root) return;
    root.classList.add("apvd-curated");
    var routes = root.querySelector(".ap-video-sales__routes");
    if (!routes || routes.parentElement.classList.contains("apvd-topics")) return;
    var disclosure = element("details", "apvd-topics");
    disclosure.open = window.matchMedia("(min-width:768px)").matches;
    disclosure.appendChild(element("summary", "", "주제별 추천 보기"));
    routes.before(disclosure);
    disclosure.appendChild(routes);
  }

  function previewId(frame) {
    try {
      var url = new URL(frame.getAttribute("src"), window.location.href);
      if (url.protocol !== "https:" || !/^(www\.)?youtube(-nocookie)?\.com$/.test(url.hostname)) return "";
      var match = url.pathname.match(/^\/embed\/([\w-]{11})$/);
      return match && /preview|미리보기/i.test(frame.title) ? match[1] : "";
    } catch (error) { return ""; }
  }

  function ensurePreviews(main) {
    var product = CATALOG[new URLSearchParams(window.location.search).get("idx")];
    if (!product) return;
    var code = "(" + product[0] + ")";
    var title = main.querySelector("h1.view_tit");
    if (!title || text(title).indexOf(code) < 0) return;
    // Imweb renders separate desktop/mobile detail bodies with duplicate IDs.
    // Work within each real product section, never in templates or watch pages.
    Array.prototype.forEach.call(main.querySelectorAll(".shop_view_body .archive-online-product"), function (section) {
      if (section.classList.contains("apvd-preview-section")) return;
      var heading = section.querySelector(":scope > h2");
      var cta = section.querySelector(":scope > [data-archive-pilates-watch-cta]");
      var frames = section.querySelectorAll("iframe");
      if (!heading || text(heading).indexOf(code) < 0 || !cta || frames.length !== 1) return;
      var frame = frames[0];
      var id = previewId(frame);
      var wrapper = frame.parentElement;
      if (!id || wrapper.parentElement !== section || wrapper.children.length !== 1 || text(wrapper)) return;
      var thumbnail = Array.prototype.find.call(section.querySelectorAll(":scope > figure"), function (figure) {
        var img = figure.querySelector("img");
        if (!img || figure.children.length !== 1 || text(figure)) return false;
        try {
          var url = new URL(img.getAttribute("src"), window.location.href);
          return url.hostname === "i.ytimg.com" && url.pathname.split("/")[2] === id && img.alt.indexOf(code) >= 0 && img.alt.indexOf("미리보기") >= 0;
        } catch (error) { return false; }
      });
      // The preview label, matching thumbnail and section code must agree.
      if (!thumbnail) return;
      var previewHeading = element("h3", "apvd-preview-heading", "미리보기");
      cta.before(previewHeading);
      cta.before(wrapper);
      wrapper.classList.add("apvd-preview");
      thumbnail.setAttribute("data-apvd-duplicate-thumbnail", "");
      section.classList.add("apvd-preview-section");
      section.setAttribute("data-ap-video-preview-ready", "true");
    });
    if (main.querySelector(".archive-online-product[data-ap-video-preview-ready='true']") && document.documentElement.getAttribute("data-ap-video-discovery-ready") !== "detail") document.documentElement.setAttribute("data-ap-video-discovery-ready", "detail");
    // Display-only summary token; do not rewrite CTA, policy, rights or links.
    Array.prototype.forEach.call(main.querySelectorAll(".goods_summary .fr-view"), function (summary) {
      if (summary.children.length) return;
      var original = text(summary);
      var shorter = original.replace(/회원그룹 이용권 (\d+일 시청)/g, "$1");
      if (shorter !== original) summary.textContent = shorter;
    });
  }

  function run() {
    pendingTimer = null;
    var current = route();
    if (!current) {
      stopObserving();
      document.documentElement.removeAttribute(ROUTE_ATTR);
      document.documentElement.removeAttribute("data-ap-video-discovery-ready");
      return;
    }
    var main = document.querySelector("main");
    if (!main || main.querySelector(".ap-watch,.apc-grid")) return;
    installStyle();
    if (document.documentElement.getAttribute(ROUTE_ATTR) !== current) {
      document.documentElement.removeAttribute("data-ap-video-discovery-ready");
      document.documentElement.setAttribute(ROUTE_ATTR, current);
    }
    if (current === "list") {
      ensureFilters(main);
      ensureRecommendations(main);
    } else {
      ensurePreviews(main);
    }
  }

  function stopObserving() {
    if (observer) observer.disconnect();
    observer = null;
    window.clearTimeout(observerTimer);
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function schedule() {
    if (pendingTimer || passes >= 40) return;
    pendingTimer = window.setTimeout(function () { passes += 1; run(); }, 120);
  }

  function observe() {
    stopObserving();
    if (!route()) return;
    passes = 0;
    run();
    var main = document.querySelector("main");
    if (!main) return;
    observer = new MutationObserver(function (records) {
      var relevant = ".ap-listing-intro,.ap-video-sales,.shop-grid,.shop-item._shop_item,.archive-online-product,iframe";
      if (records.some(function (record) {
        return Array.prototype.some.call(record.addedNodes, function (node) {
          return node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant));
        });
      })) schedule();
    });
    observer.observe(main, { childList: true, subtree: true });
    observerTimer = window.setTimeout(stopObserving, 12000);
  }

  function start() {
    observe();
    // No scroll handler or layout reads. A one-shot intersection wakes a bounded
    // mutation window for Imweb's lazy mobile/desktop product detail injection.
    if (route() !== "detail" || !window.IntersectionObserver || intersection) return;
    intersection = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        intersection.unobserve(entry.target);
        observe();
      });
    }, { rootMargin: "300px" });
    Array.prototype.forEach.call(document.querySelectorAll("main .shop_view_body"), function (body) { intersection.observe(body); });
    intersectionTimer = window.setTimeout(function () { intersection.disconnect(); }, 60000);
  }

  document.addEventListener("click", function (event) {
    if (route() !== "detail") return;
    var link = event.target.closest && event.target.closest("a[href='#prod_detail_detail']");
    if (link) observe();
  });
  window.addEventListener("pageshow", start);
  window.addEventListener("popstate", start);
  window.addEventListener("pagehide", function () {
    stopObserving();
    if (intersection) intersection.disconnect();
    intersection = null;
    window.clearTimeout(intersectionTimer);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
