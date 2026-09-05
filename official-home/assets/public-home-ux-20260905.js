(() => {
  "use strict";

  const preview = document.querySelector("[data-home-preview]");
  if (!preview) return;

  // Keep the direct preview link usable without JavaScript and load YouTube only on intent.
  preview.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();

    const frame = document.createElement("iframe");
    frame.src = preview.href;
    frame.title = "체어 지지와 움직임 ACH9 미리보기";
    frame.width = "560";
    frame.height = "315";
    frame.allow = "encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    preview.replaceWith(frame);
    frame.focus();
  });
})();
