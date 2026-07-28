(function () {
  "use strict";

  var VERSION = "2026-07-28d";
  var STYLE_ID = "archive-pilates-wishlist-style";
  var RED = "#e1261c";
  var syncPromises = {};
  var observer = null;
  var scheduled = false;

  function installStyle() {
    var existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-archive-pilates-wishlist-style", VERSION);
    style.textContent = [
      ":root{--ap-wish-red:" + RED + "}",
      ".ap-wish-button{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;border:1px solid rgba(17,17,17,.13);border-radius:50%;background:rgba(255,255,255,.94);color:#111!important;box-shadow:0 3px 14px rgba(17,17,17,.08);cursor:pointer;line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:color .16s ease,border-color .16s ease,background-color .16s ease,box-shadow .16s ease}",
      ".ap-wish-button:hover{border-color:rgba(17,17,17,.28);box-shadow:0 5px 18px rgba(17,17,17,.13)}",
      ".ap-wish-button:focus-visible{outline:2px solid var(--ap-wish-red);outline-offset:3px}",
      ".ap-wish-button:disabled{cursor:wait;opacity:.62}",
      ".ap-wish-button.is-active{color:var(--ap-wish-red)!important;border-color:rgba(225,38,28,.34);background:#fff}",
      ".ap-wish-button svg{display:block;width:22px;height:22px;overflow:visible;pointer-events:none}",
      ".ap-wish-button path{fill:transparent!important;stroke:currentColor!important;stroke-width:1.85;stroke-linecap:round;stroke-linejoin:round;transition:fill .16s ease,stroke .16s ease}",
      ".ap-wish-button.is-active path{fill:currentColor!important}",
      ".ap-wish-button.is-popping svg{animation:ap-wish-pop .34s cubic-bezier(.2,.85,.35,1)}",
      "@keyframes ap-wish-pop{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1)}}",
      ".ap-wish-native-hidden{display:none!important}",
      "h1.ap-wish-detail-title{position:relative!important;display:block!important;min-height:44px!important;padding-right:56px!important}",
      "h1.ap-wish-detail-title>.ap-wish-button{position:absolute;top:50%;right:0;transform:translateY(-50%);vertical-align:middle}",
      "@media(max-width:767px){.ap-wish-button{box-shadow:0 2px 10px rgba(17,17,17,.09)}}",
      "@media(min-width:768px) and (max-width:1099px){.ap-wish-button{width:52px;height:52px;min-width:52px;min-height:52px;flex-basis:52px}.ap-wish-button svg{width:25px;height:25px}h1.ap-wish-detail-title{min-height:52px!important;padding-right:64px!important}}",
      "@media(prefers-reduced-motion:reduce){.ap-wish-button,.ap-wish-button path{transition-property:color,fill,stroke,border-color,background-color!important}.ap-wish-button.is-popping svg{animation:none!important}}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function heartSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg>';
  }

  function setState(button, active, animate) {
    if (!button) return;
    button.classList.toggle("is-active", Boolean(active));
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-label", active ? "관심상품에서 제거" : "관심상품에 추가");
    button.title = active ? "관심상품에서 제거" : "관심상품에 추가";
    if (animate && active) {
      button.classList.remove("is-popping");
      void button.offsetWidth;
      button.classList.add("is-popping");
      window.setTimeout(function () {
        button.classList.remove("is-popping");
      }, 380);
    }
  }

  function setAllStates(productCode, active, animate) {
    Array.prototype.slice.call(document.querySelectorAll('.ap-wish-button[data-product-code="' + productCode + '"]')).forEach(function (button) {
      setState(button, active, animate);
    });
  }

  function createButton(meta, placement) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "ap-wish-button ap-wish-" + placement;
    button.setAttribute("data-product-code", meta.code);
    button.setAttribute("data-product-idx", String(meta.idx || ""));
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "관심상품에 추가");
    button.title = "관심상품에 추가";
    button.innerHTML = heartSvg();
    return button;
  }

  function loginBackToken(href) {
    try {
      var url = new URL(href || location.href, location.href);
      return encodeURIComponent(window.btoa(url.pathname + url.search + url.hash));
    } catch (error) {
      return "";
    }
  }

  function openLogin(href) {
    if (window.SITE_MEMBER && typeof window.SITE_MEMBER.openLogin === "function") {
      window.SITE_MEMBER.openLogin(loginBackToken(href));
      return;
    }
    location.href = "/login";
  }

  function toggleFromCard(meta, button) {
    var jq = window.jQuery || window.$;
    if (!jq || typeof jq.ajax !== "function") {
      location.href = meta.href;
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("data-ap-wish-touched", "1");
    jq.ajax({
      type: "POST",
      data: { prod_code: meta.code },
      url: "/shop/add_prod_wish.cm",
      dataType: "json",
      success: function (response) {
        if (response && response.msg === "SUCCESS") {
          var active = response.res === "add";
          setAllStates(meta.code, active, active);
          return;
        }
        if (response && response.msg === "NON_MEMBERS") {
          openLogin(meta.href);
          return;
        }
        if (response && response.msg) window.alert(response.msg);
      },
      error: function () {
        window.alert("관심상품 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      },
      complete: function () {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }

  function selectedFromHtml(html, productCode) {
    try {
      var parsed = new DOMParser().parseFromString(html, "text/html");
      var nativeIcon = parsed.querySelector(".wish-icon-" + productCode);
      return nativeIcon ? nativeIcon.classList.contains("im-ico-liked") : null;
    } catch (error) {
      return null;
    }
  }

  function requestRemoteState(meta) {
    if (!window.fetch || !window.DOMParser) return Promise.resolve(null);
    if (!syncPromises[meta.code]) {
      syncPromises[meta.code] = window.fetch(meta.href, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      }).then(function (response) {
        if (!response.ok) throw new Error("wishlist state request failed");
        return response.text();
      }).then(function (html) {
        return selectedFromHtml(html, meta.code);
      }).catch(function () {
        return null;
      });
    }
    return syncPromises[meta.code];
  }

  function syncCardState(button, meta) {
    requestRemoteState(meta).then(function (active) {
      if (active === null || button.getAttribute("data-ap-wish-touched") === "1") return;
      setAllStates(meta.code, active, false);
      button.setAttribute("data-ap-wish-synced", "1");
    });
  }

  function observeCard(button, meta) {
    if (!("IntersectionObserver" in window)) {
      syncCardState(button, meta);
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          var data = entry.target.__apWishMeta;
          if (data) syncCardState(entry.target, data);
        });
      }, { rootMargin: "120px 0px" });
    }
    button.__apWishMeta = meta;
    observer.observe(button);
  }

  function parseNativeMeta(card) {
    try {
      var data = JSON.parse(card.getAttribute("data-product-properties") || "{}");
      var link = card.querySelector('a[href*="idx="]');
      if (!data.code || !data.idx || !link) return null;
      return {
        code: String(data.code),
        idx: Number(data.idx),
        name: String(data.name || "상품"),
        href: new URL(link.getAttribute("href"), location.href).href
      };
    } catch (error) {
      return null;
    }
  }

  function nativeMetaByIndex() {
    var map = {};
    Array.prototype.slice.call(document.querySelectorAll("[data-product-properties]")).forEach(function (card) {
      var meta = parseNativeMeta(card);
      if (meta) map[meta.idx] = meta;
    });
    return map;
  }

  function installNativeCards() {
    Array.prototype.slice.call(document.querySelectorAll(".shop-item[data-product-properties]")).forEach(function (card) {
      var meta = parseNativeMeta(card);
      if (!meta) return;
      var host = card.querySelector(".item-wrap") || card;
      host.classList.add("ap-wish-card-host");
      if (host.querySelector(':scope > .ap-wish-button[data-product-code="' + meta.code + '"]')) return;

      var button = createButton(meta, "card");
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleFromCard(meta, button);
      });
      host.appendChild(button);
      observeCard(button, meta);
    });
  }

  function installCustomCards() {
    var byIndex = nativeMetaByIndex();
    Array.prototype.slice.call(document.querySelectorAll(".ap-knitido-product-card")).forEach(function (card) {
      var match = (card.getAttribute("href") || "").match(/[?&]idx=(\d+)/);
      var meta = match ? byIndex[Number(match[1])] : null;
      if (!meta) return;

      var shell = card.parentElement;
      if (!shell || !shell.classList.contains("ap-wish-custom-shell")) {
        shell = document.createElement("div");
        shell.className = "ap-wish-custom-shell";
        card.parentNode.insertBefore(shell, card);
        shell.appendChild(card);
      }
      if (shell.querySelector(':scope > .ap-wish-button[data-product-code="' + meta.code + '"]')) return;

      var button = createButton(meta, "card");
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleFromCard(meta, button);
      });
      shell.appendChild(button);
      observeCard(button, meta);
    });
  }

  function detailMeta() {
    var nativeIcon = document.querySelector("._wish_button_icon[class*='wish-icon-']");
    if (!nativeIcon) return null;
    var productCode = Array.prototype.slice.call(nativeIcon.classList).find(function (name) {
      return name.indexOf("wish-icon-") === 0;
    });
    productCode = productCode ? productCode.replace("wish-icon-", "") : "";
    if (!productCode) return null;
    var idx = new URLSearchParams(location.search).get("idx") || "";
    return {
      code: productCode,
      idx: idx,
      name: (document.querySelector("h1.view_tit") || {}).textContent || "상품",
      href: location.href
    };
  }

  function nativeDetailState(productCode) {
    var icon = document.querySelector(".wish-icon-" + productCode);
    return Boolean(icon && icon.classList.contains("im-ico-liked"));
  }

  function installDetailButton() {
    var title = document.querySelector("h1.view_tit");
    var meta = detailMeta();
    if (!title || !meta) return;

    Array.prototype.slice.call(document.querySelectorAll("._wish_button.like_box")).forEach(function (nativeButton) {
      nativeButton.classList.add("ap-wish-native-hidden");
      nativeButton.setAttribute("aria-hidden", "true");
      nativeButton.setAttribute("tabindex", "-1");
    });

    title.classList.add("ap-wish-detail-title");
    var button = title.querySelector(':scope > .ap-wish-button[data-product-code="' + meta.code + '"]');
    if (!button) {
      button = createButton(meta, "detail");
      var nsIcon = title.querySelector(":scope > .ns-icon");
      title.insertBefore(button, nsIcon || null);
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        if (window.SITE_SHOP_DETAIL && typeof window.SITE_SHOP_DETAIL.addProdWish === "function") {
          window.SITE_SHOP_DETAIL.addProdWish(meta.code, loginBackToken(meta.href));
        } else {
          toggleFromCard(meta, button);
        }
        [60, 240, 800].forEach(function (delay, index) {
          window.setTimeout(function () {
            var active = nativeDetailState(meta.code);
            setAllStates(meta.code, active, index === 0 && active);
            if (index === 2) {
              button.disabled = false;
              button.removeAttribute("aria-busy");
            }
          }, delay);
        });
      });
    }
    setState(button, nativeDetailState(meta.code), false);

    Array.prototype.slice.call(document.querySelectorAll(".wish-icon-" + meta.code)).forEach(function (nativeIcon) {
      if (nativeIcon.getAttribute("data-ap-wish-observed") === VERSION) return;
      nativeIcon.setAttribute("data-ap-wish-observed", VERSION);
      try {
        new MutationObserver(function () {
          setAllStates(meta.code, nativeDetailState(meta.code), false);
        }).observe(nativeIcon, { attributes: true, attributeFilter: ["class"] });
      } catch (error) {}
    });
  }

  function removeCardControls() {
    Array.prototype.slice.call(document.querySelectorAll(".ap-wish-card")).forEach(function (button) {
      button.remove();
    });
    Array.prototype.slice.call(document.querySelectorAll(".ap-wish-card-host")).forEach(function (host) {
      host.classList.remove("ap-wish-card-host");
    });
    Array.prototype.slice.call(document.querySelectorAll(".ap-wish-custom-shell")).forEach(function (shell) {
      var card = shell.querySelector(":scope > .ap-knitido-product-card");
      if (card && shell.parentNode) shell.parentNode.insertBefore(card, shell);
      shell.remove();
    });
  }

  function run() {
    scheduled = false;
    removeCardControls();
    installDetailButton();
    document.documentElement.setAttribute("data-archive-pilates-wishlist", VERSION);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(run);
  }

  installStyle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  window.addEventListener("pageshow", run);
  try {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  } catch (error) {}
})();
