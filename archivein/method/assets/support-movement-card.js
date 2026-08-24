(() => {
  "use strict";

  const tabs = Array.from(document.querySelectorAll("[data-method-tab]"));
  const panes = Array.from(document.querySelectorAll("[data-method-pane]"));
  const progress = document.getElementById("progress");
  const topButton = document.getElementById("topbtn");

  function activateTab(id) {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.methodTab === id;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });
    panes.forEach((pane) => {
      const isActive = pane.dataset.methodPane === id;
      pane.classList.toggle("on", isActive);
      pane.hidden = !isActive;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.methodTab || ""));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      activateTab(next.dataset.methodTab || "");
      next.focus();
    });
  });

  window.addEventListener(
    "scroll",
    () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (progress) progress.style.width = `${scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0}%`;
      topButton?.classList.toggle("on", window.scrollY > 260);
    },
    { passive: true },
  );

  topButton?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
})();
