import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../official-home/assets/academy-nav-20260915b.js', import.meta.url), 'utf8');

function setup() {
  function target() {
    const listeners = {};
    return {
      addEventListener: (key, fn) => { listeners[key] = fn; },
      fire: (key, event = {}) => listeners[key]?.(event),
    };
  }
  const document = target();
  const window = target();
  const summary = target();
  const panel = { contains: el => el === panel };
  const menu = Object.assign(target(), {
    open: false,
    contains: el => [summary, panel, menu].includes(el),
    querySelector: key => key === 'summary' ? summary : panel,
  });
  summary.focus = () => { document.activeElement = summary; };
  document.querySelector = () => menu;
  const hover = { matches: true };
  window.matchMedia = () => hover;
  runInNewContext(source, { document, window, queueMicrotask });
  return { document, window, summary, panel, menu, hover };
}

test('mouse hover opens; leaving closes without moving focus', () => {
  const { menu } = setup();
  menu.fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(menu.open, true);
  menu.fire('pointerleave', { pointerType: 'mouse' });
  assert.equal(menu.open, false);
});

test('touch uses native summary toggle; first mouse click after hover stays open', () => {
  const { menu, summary } = setup();
  menu.fire('pointerenter', { pointerType: 'touch' });
  assert.equal(menu.open, false);
  summary.fire('click', { pointerType: 'touch', detail: 1, preventDefault: () => assert.fail('touch blocked') });
  menu.fire('pointerenter', { pointerType: 'mouse' });
  let prevented = false;
  summary.fire('click', { pointerType: 'mouse', detail: 1, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(menu.open, true);
  summary.fire('click', { pointerType: 'mouse', detail: 1, preventDefault: () => assert.fail('second toggle blocked') });
});

test('Escape restores summary focus; outside pointer and page restore close', () => {
  const { menu, summary, panel, document, window } = setup();
  menu.open = true;
  document.activeElement = panel;
  document.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, summary);
  menu.open = true;
  document.fire('pointerdown', { target: {} });
  assert.equal(menu.open, false);
  menu.open = true;
  window.fire('pageshow');
  assert.equal(menu.open, false);
});

test('Escape dismisses hover-only menu without stealing outside focus', () => {
  const { menu, document } = setup();
  const outside = {};
  document.activeElement = outside;
  menu.fire('pointerenter', { pointerType: 'mouse' });
  document.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(menu.open, false);
  assert.equal(document.activeElement, outside);
});

test('submenu keyboard focus survives pointer leave and closes when focus exits', async () => {
  const { menu, panel, document } = setup();
  menu.open = true;
  document.activeElement = panel;
  menu.fire('pointerleave', { pointerType: 'mouse' });
  assert.equal(menu.open, true);
  document.activeElement = {};
  menu.fire('focusout', { relatedTarget: document.activeElement });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(menu.open, false);
});

test('Safari link blur to body must not remove the link before its click', () => {
  const { menu, document, panel, window } = setup();
  menu.open = true;
  document.fire('pointerdown', { target: panel });
  document.activeElement = {};
  menu.fire('focusout', { relatedTarget: null });
  assert.equal(menu.open, true);
  window.fire('blur');
  assert.equal(menu.open, false);
});
