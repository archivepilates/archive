(function () {
  'use strict';
  var menu = document.querySelector('.site-header .nav-academy');
  if (!menu) return;
  var summary = menu.querySelector('summary');
  var panel = menu.querySelector('.nav-submenu');
  var hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  var openedByHover = false;

  function close() {
    menu.open = false;
    openedByHover = false;
  }

  menu.addEventListener('pointerenter', function (event) {
    if (event.pointerType !== 'mouse' || !hover.matches || menu.open) return;
    menu.open = true;
    openedByHover = true;
  });
  menu.addEventListener('pointerleave', function (event) {
    if (event.pointerType === 'mouse' && hover.matches && !panel.contains(document.activeElement)) close();
  });
  summary.addEventListener('click', function (event) {
    // A mouse click immediately after hover should not close the newly opened menu.
    if (openedByHover && event.detail > 0 && event.pointerType === 'mouse') {
      event.preventDefault();
      openedByHover = false;
    }
  });
  document.addEventListener('pointerdown', function (event) {
    if (!menu.contains(event.target)) close();
  });
  menu.addEventListener('focusout', function () {
    queueMicrotask(function () {
      if (!menu.contains(document.activeElement)) close();
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      var restoreFocus = menu.contains(document.activeElement);
      close();
      if (restoreFocus) summary.focus();
    }
  });
  window.addEventListener('pageshow', close);
})();
