(function () {
  "use strict";
  if (!/^\/(16|shop)\/?$/.test(location.pathname)) return;
  if (window.apKnitidoDiscovery) return;
  window.apKnitidoDiscovery = true;

  function enhance() {
    var root = document.querySelector(".ap-knitido-brand-intro");
    if (!root || root.querySelector(".ap-knitido-filters")) return;
    var grid = root.querySelector(".ap-knitido-product-grid");
    var heading = root.querySelector(".ap-knitido-products-heading");
    var lead = root.querySelector(".ap-knitido-brand-lead");
    if (!grid || !heading || !lead) return;
    heading.id = "knitido-products";
    heading.tabIndex = -1;
    var jump = document.createElement("a");
    jump.className = "ap-knitido-jump";
    jump.href = "#knitido-products";
    jump.textContent = "니티도 상품 바로 보기";
    jump.addEventListener("click", function (event) {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: "instant", block: "start" });
    });
    lead.insertAdjacentElement("afterend", jump);

    var cards = Array.from(grid.querySelectorAll(".ap-knitido-product-card"));
    var entries = cards.map(function (card) {
      var title = card.querySelector("strong").textContent.trim();
      var size = title.match(/\d{2}\s*-\s*\d{2}\s*cm/);
      return { card: card, size: size ? size[0].replace(/\s/g, "") : "", color: title.split("·").slice(1).join("·").trim() };
    });
    var controls = document.createElement("form");
    controls.className = "ap-knitido-filters";
    controls.setAttribute("aria-label", "니티도 상품 필터");
    controls.addEventListener("submit", function (event) { event.preventDefault(); });
    function select(name, labelText) {
      var label = document.createElement("label");
      label.append(document.createTextNode(labelText));
      var input = document.createElement("select");
      input.name = name;
      input.setAttribute("aria-label", labelText);
      input.add(new Option("전체 " + labelText, ""));
      Array.from(new Set(entries.map(function (entry) { return entry[name]; }).filter(Boolean))).sort().forEach(function (value) {
        input.add(new Option(value, value));
      });
      label.append(input);
      controls.append(label);
      return input;
    }
    var size = select("size", "사이즈");
    var color = select("color", "색상");
    var reset = document.createElement("button");
    reset.type = "reset";
    reset.textContent = "초기화";
    controls.append(reset);
    var status = document.createElement("p");
    status.className = "ap-knitido-filter-status";
    status.setAttribute("role", "status");
    controls.append(status);
    heading.insertAdjacentElement("afterend", controls);
    var empty = document.createElement("p");
    empty.className = "ap-knitido-filter-empty";
    empty.textContent = "선택한 조건의 상품이 없습니다.";
    empty.hidden = true;
    grid.insertAdjacentElement("afterend", empty);
    function filter() {
      var count = 0;
      entries.forEach(function (entry) {
        var visible = (!size.value || size.value === entry.size) && (!color.value || color.value === entry.color);
        entry.card.hidden = !visible;
        if (visible) count += 1;
      });
      status.textContent = count + "개 상품";
      empty.hidden = count !== 0;
    }
    controls.addEventListener("change", filter);
    controls.addEventListener("reset", function (event) {
      event.preventDefault();
      size.value = "";
      color.value = "";
      filter();
    });
    filter();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, { once: true });
  else enhance();
  var pending = false;
  var observer = new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; enhance(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { observer.disconnect(); }, 12000);
  window.addEventListener("pageshow", enhance);
  window.addEventListener("popstate", enhance);
  document.addEventListener("click", function (event) {
    if (!event.target.closest || !event.target.closest(".ap-shop-subcategory a,.ap-knitido-side-link")) return;
    [0, 200, 800].forEach(function (delay) { setTimeout(enhance, delay); });
  });
})();
