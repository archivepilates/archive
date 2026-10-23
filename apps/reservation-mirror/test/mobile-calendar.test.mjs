import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('mobile week does not restore the oversized seven-column minimum', () => {
  assert.doesNotMatch(css, /7\s*\*\s*124px|(?:min-width|width)\s*:\s*912px/);
});
test('native calendar scrolling is not overridden by outer-scroll workarounds', () => {
  assert.doesNotMatch(css, /overflow\s*:\s*visible\s*!important|height\s*:\s*auto\s*!important/);
  assert.doesNotMatch(app, /initializeCalendarScroll|scrollCalendarDay/);
});
test('compact calendar uses its bounded parent and native morning scroll', () => {
  assert.match(app, /height: window\.matchMedia\('\(max-width: 900px\)'\)\.matches \? '100%' : 'auto'/);
  assert.match(app, /scrollTime: '08:00:00', scrollTimeReset: true/);
  assert.match(css, /height:min\(40rem,max\(24rem,calc\(100svh - 17rem\)\)\)/);
});
test('morning positioning does not remove overnight classes from the calendar', () => {
  assert.match(app, /slotMinTime: '00:00:00', slotMaxTime: '24:00:00'/);
});
test('pending resize scroll waits for an authorized visible workspace', () => {
  assert.match(app, /calendarScrollPending && page === 'calendar' && calendar && user && sessionReady && !forbidden && !\$\('workspace'\)\.hidden/);
});
test('desktop retains weekdays while more-link keyboard handling stays native', () => {
  assert.match(app, /calendar-header-weekday/);
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.calendar-header-weekday\{display:none\}/);
  assert.match(app, /moreLinkDidMount\(info\) \{\s*info\.el\.setAttribute\('role', 'button'\);\s*info\.el\.setAttribute\('aria-label', '겹친 수업 더 보기'\);\s*\}/);
});
