(function () {
  "use strict";
  if (!/^\/(16|shop)\/?$/.test(location.pathname)) return;
  if (window.apKnitidoStoryImages) return;
  window.apKnitidoStoryImages = true;
  var sources = [
    { alt: "니티도 리브랜딩 론칭에 함께한 구성원 단체 사진", name: "team", height: 853 },
    { alt: "일본 와카야마 해안 지역을 배경으로 걷는 사람", name: "coast", height: 853 },
    { alt: "니티도 제조 현장에서 편직기를 점검하는 모습", name: "factory", height: 854 }
  ];
  function enhance() {
    // Legacy unit scripts can rebuild the story after the SEO footer renders it.
    var images = document.querySelectorAll(".ap-knitido-brand-intro .ap-knitido-brand-media img");
    images.forEach(function (image) {
      var source = sources.find(function (item) { return item.alt === image.alt; });
      if (!source) return;
      var base = "https://archivepilates.com/assets/knitido-" + source.name + "-20260905-";
      var srcset = base + "640.webp 640w, " + base + "1280.webp 1280w";
      if (image.getAttribute("src") === base + "1280.webp" && image.getAttribute("srcset") === srcset) return;
      image.width = 1280;
      image.height = source.height;
      image.decoding = "async";
      image.sizes = "(max-width: 860px) calc(100vw - 32px), 590px";
      image.srcset = srcset;
      image.src = base + "1280.webp";
    });
  }
  var observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { observer.disconnect(); }, 12000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, { once: true });
  enhance();
  window.addEventListener("pageshow", enhance);
  window.addEventListener("archive:shop-route-change", enhance);
  window.addEventListener("popstate", enhance);
})();
