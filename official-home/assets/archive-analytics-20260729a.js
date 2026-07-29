(function () {
  "use strict";

  var VERSION = "2026-07-29a";
  var MEASUREMENT_ID = String(window.ARCHIVE_PUBLIC_GA4_ID || "").trim();
  var SCRIPT_ID = "archive-pilates-google-tag";
  var LINKER_DOMAINS = ["archivepilates.com", "archivepilates.imweb.me"];

  if (!/^G-[A-Z0-9]+$/.test(MEASUREMENT_ID)) {
    window.apArchiveTrack = function () {};
    window.__apArchiveAnalyticsQueue = [];
    document.documentElement.setAttribute(
      "data-archive-pilates-analytics",
      VERSION + "-pending-public-stream"
    );
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function () {
      window.dataLayer.push(arguments);
    };

  if (!document.getElementById(SCRIPT_ID)) {
    var tag = document.createElement("script");
    tag.id = SCRIPT_ID;
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    (document.head || document.documentElement).appendChild(tag);
  }

  if (!window.__archivePilatesAnalyticsConfigured) {
    window.__archivePilatesAnalyticsConfigured = true;
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      linker: { domains: LINKER_DOMAINS },
      cookie_domain: "auto"
    });
  }

  window.apArchiveTrack = function (eventName, parameters) {
    if (!eventName) return;
    window.gtag("event", eventName, parameters || {});
  };
  var queuedEvents = window.__apArchiveAnalyticsQueue || [];
  window.__apArchiveAnalyticsQueue = [];
  queuedEvents.forEach(function (entry) {
    if (!entry || !entry.eventName) return;
    window.apArchiveTrack(entry.eventName, entry.parameters);
  });

  function placement(anchor) {
    if (anchor.closest(".hero")) return "hero";
    if (anchor.closest(".site-header")) return "header";
    if (anchor.closest(".class-grid")) return "class_section";
    return "page";
  }

  document.addEventListener(
    "click",
    function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      var href = anchor.getAttribute("href") || "";
      var absolute = "";
      try {
        absolute = new URL(href, window.location.href).href;
      } catch (error) {
        return;
      }
      if (
        absolute.indexOf("https://archivepilates.imweb.me/17") !== 0 &&
        !/\/videos(?:[?#]|$)/.test(absolute)
      ) {
        return;
      }
      window.apArchiveTrack("video_shop_click", {
        link_url: absolute,
        link_text: String(anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
        placement: placement(anchor)
      });
    },
    true
  );

  document.documentElement.setAttribute("data-archive-pilates-analytics", VERSION);
})();
