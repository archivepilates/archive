(function () {
  "use strict";

  var VERSION = "2026-09-05a";
  var root = document.documentElement;
  var marker = "data-archive-pilates-header-ux";
  var readyMarker = "data-archive-pilates-public-ux-ready";
  var guard = "__archivePilatesHeaderUx20260905";
  if (!root || window[guard]) return;
  window[guard] = true;

  function enhance() {
    var header = document.getElementById("doz_header_wrap");
    if (!header) return;
    var frame = 0;
    var signature = "";
    var stableSince = 0;
    var fontsReady = !document.fonts;

    function visible(element) {
      var rect = element.getBoundingClientRect();
      var style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 ||
          rect.right > window.innerWidth + 1 || style.visibility !== "visible") return false;
      return !element.checkVisibility || element.checkVisibility({
        checkOpacity: true, checkVisibilityCSS: true
      });
    }

    function measure() {
      if (!fontsReady) return "";
      var mode = "navigation";
      var links = Array.prototype.filter.call(header.querySelectorAll(
        "#inline_header_normal ._main_menu > li > a.ap-shop-nav-link," +
        "#inline_header_normal ._main_menu > li > a.ap-shop-visual-link," +
        "#mobile_carousel_menu_0 > .nav-item > a.ap-shop-nav-link," +
        "#mobile_carousel_menu_0 > .nav-item > a.ap-shop-visual-link"
      ), visible);
      if (links.length !== 5) {
        // Imweb intentionally omits the mobile carousel on product details.
        // Preserve that template and validate its existing controls instead.
        var mobile = header.querySelector("#inline_header_mobile");
        if (!document.body.classList.contains("shop_view") || !mobile ||
            !visible(mobile) || mobile.querySelector("#mobile_carousel_menu")) return "";
        links = Array.prototype.filter.call(mobile.querySelectorAll(
          ".icon_type_menu a, .logo_title > a, a[href='/shop_cart'], .search_btn a"
        ), visible);
        if (links.length !== 4) return "";
        mode = "native-product-detail";
      }
      var boxes = links.map(function (link) {
        var rect = link.getBoundingClientRect();
        return [link.getAttribute("href"), Math.round(rect.x), Math.round(rect.y),
          Math.round(rect.width), Math.round(rect.height)];
      });
      if (boxes.some(function (box) { return box[3] < 44 || box[4] < 44; })) return "";
      return mode + ":" + window.innerWidth + ":" + JSON.stringify(boxes);
    }

    function check(now) {
      frame = 0;
      var next = measure();
      if (!next || next !== signature) {
        root.removeAttribute(readyMarker);
        signature = next;
        stableSince = now;
      }
      // Frame checks run only during a layout change, never as a polling loop.
      if (!next) return;
      if (now - stableSince < 160) {
        frame = requestAnimationFrame(check);
        return;
      }
      root.setAttribute(marker, VERSION);
      root.setAttribute("data-archive-pilates-header-ux-mode", next.split(":")[0]);
      root.setAttribute("data-archive-pilates-header-ux-width", String(window.innerWidth));
      root.setAttribute(readyMarker, VERSION);
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(check);
    }

    // Observe only native header layout; never rewrite menus or call controllers.
    var mutations = new MutationObserver(schedule);
    mutations.observe(header, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "style", "hidden"]
    });
    if (window.ResizeObserver) {
      var sizes = new ResizeObserver(schedule);
      sizes.observe(header);
      header.querySelectorAll(".inline-col-group-center").forEach(function (column) {
        sizes.observe(column);
      });
    }
    window.addEventListener("resize", function () {
      root.removeAttribute(readyMarker);
      signature = "";
      schedule();
    }, { passive: true });
    window.addEventListener("pageshow", schedule);
    if (document.fonts) document.fonts.ready.then(function () { fontsReady = true; schedule(); });
    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }
})();
