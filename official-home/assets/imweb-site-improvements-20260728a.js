(function () {
  "use strict";

  var VERSION = "2026-07-28a";
  var STYLE_ID = "archive-pilates-listing-layout-style";
  var INTRO_CLASS = "ap-listing-intro";
  var pending = false;

  function path() {
    return String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  }

  function route() {
    var currentPath = path();
    if (currentPath === "/17") return "video";
    if (currentPath === "/16") {
      var mode = new URLSearchParams(window.location.search || "").get("ap_shop") || "all";
      if (mode === "all") return "shop";
    }
    return "";
  }

  function installStyle() {
    var style = document.getElementById(STYLE_ID);
    var css = [
      "html body ." + INTRO_CLASS + "{width:min(1250px,calc(100% - 36px));margin:clamp(24px,3vw,44px) auto 18px;padding:0;box-sizing:border-box;color:#211d1a}",
      "html body ." + INTRO_CLASS + "__kicker{margin:0 0 8px;color:#9a3324;font-size:12px;font-weight:850;line-height:1.35;letter-spacing:.12em;text-transform:uppercase}",
      "html body ." + INTRO_CLASS + " h1{margin:0;color:#171412;font-size:34px;font-weight:800;line-height:1.18;letter-spacing:0;word-break:keep-all}",
      "html body ." + INTRO_CLASS + "__copy{max-width:660px;margin:10px 0 0;color:#675e57;font-size:15px;font-weight:500;line-height:1.72;letter-spacing:0;word-break:keep-all}",
      "html[data-ap-listing-density='shop'] body main .shop-grid .thumb-row>.shop-item._shop_item,html[data-ap-listing-density='video'] body main .shop-grid .thumb-row>.shop-item._shop_item{min-width:0!important}",
      "@media(min-width:1100px){html[data-ap-listing-density='shop'] body main .shop-grid .thumb-row>.shop-item._shop_item{width:25%!important}html[data-ap-listing-density='video'] body main .shop-grid .thumb-row>.shop-item._shop_item{width:33.333333%!important}}",
      "@media(min-width:640px) and (max-width:1099px){html[data-ap-listing-density='shop'] body main .shop-grid .thumb-row>.shop-item._shop_item{width:33.333333%!important}html[data-ap-listing-density='video'] body main .shop-grid .thumb-row>.shop-item._shop_item{width:50%!important}}",
      "@media(max-width:639px){html body ." + INTRO_CLASS + "{width:calc(100% - 32px);margin:22px auto 14px}html body ." + INTRO_CLASS + " h1{font-size:28px}html body ." + INTRO_CLASS + "__copy{margin-top:8px;font-size:14px;line-height:1.65}html[data-ap-listing-density='shop'] body main .shop-grid .thumb-row>.shop-item._shop_item,html[data-ap-listing-density='video'] body main .shop-grid .thumb-row>.shop-item._shop_item{width:50%!important}}",
      "@media(prefers-reduced-motion:reduce){html body ." + INTRO_CLASS + "{scroll-behavior:auto!important}}"
    ].join("");

    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.setAttribute("data-archive-pilates-listing-layout-style", VERSION);
    if (style.textContent !== css) style.textContent = css;
  }

  function introMarkup(currentRoute) {
    if (currentRoute === "shop") {
      return [
        '<p class="' + INTRO_CLASS + '__kicker">ARCHIVE SELECT</p>',
        "<h1>판매상품</h1>",
        '<p class="' + INTRO_CLASS + '__copy">수업과 일상의 감각을 세심하게 이어 주는 제품을 아카이브의 기준으로 소개합니다.</p>'
      ].join("");
    }
    return [
      '<p class="' + INTRO_CLASS + '__kicker">ARCHIVE METHOD</p>',
      "<h1>영상구매</h1>",
      '<p class="' + INTRO_CLASS + '__copy">기구별 클래스를 구매 계정으로 40일 동안 반복 학습할 수 있습니다.</p>'
    ].join("");
  }

  function removeIntrosExcept(currentRoute) {
    Array.prototype.slice.call(document.querySelectorAll("." + INTRO_CLASS)).forEach(function (intro) {
      if (!currentRoute || intro.getAttribute("data-ap-listing-intro") !== currentRoute) intro.remove();
    });
  }

  function ensureIntro(currentRoute) {
    if (!currentRoute) return;
    var main = document.querySelector("main");
    if (!main) return;

    var intro = main.querySelector("." + INTRO_CLASS + '[data-ap-listing-intro="' + currentRoute + '"]');
    if (!intro) {
      intro = document.createElement("section");
      intro.className = INTRO_CLASS;
      intro.setAttribute("data-ap-listing-intro", currentRoute);
      intro.setAttribute("aria-labelledby", "ap-listing-title-" + currentRoute);
      intro.innerHTML = introMarkup(currentRoute);
      var heading = intro.querySelector("h1");
      if (heading) heading.id = "ap-listing-title-" + currentRoute;

      if (currentRoute === "shop") {
        var subcategory = main.querySelector(".ap-shop-subcategory");
        if (subcategory) subcategory.insertAdjacentElement("afterend", intro);
        else main.insertBefore(intro, main.firstChild);
      } else {
        main.insertBefore(intro, main.firstChild);
      }
    }
    intro.setAttribute("data-archive-pilates-listing-layout", VERSION);
  }

  function run() {
    pending = false;
    installStyle();
    var currentRoute = route();
    removeIntrosExcept(currentRoute);
    if (currentRoute) {
      document.documentElement.setAttribute("data-ap-listing-density", currentRoute);
      ensureIntro(currentRoute);
    } else {
      document.documentElement.removeAttribute("data-ap-listing-density");
    }
    document.documentElement.setAttribute("data-archive-pilates-site-improvements", VERSION);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(run);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  window.addEventListener("pageshow", run);
  window.addEventListener("popstate", run);
  [120, 400, 900, 1800, 3200, 5200].forEach(function (delay) {
    window.setTimeout(run, delay);
  });
  try {
    var observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(function () {
      observer.disconnect();
    }, 9000);
  } catch (error) {}
})();
