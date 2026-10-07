import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../../core/private/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../core/private/private.css", import.meta.url), "utf8");

test("private redesign retains runtime and accessible tab contracts", () => {
  for (const id of ["connectionLabel", "connectionDetail", "refreshButton", "privateScopeTabs", "privateTodayTab", "privateOverdueTab", "privateScopePanel", "privatePendingCount", "privatePreStageCount", "privatePostStageCount", "privateCompleteStageCount", "privateInstructorPendingStatus", "privateInstructorPendingList", "privateProgressStatus", "privateProgressList"]) {
    assert.equal([...html.matchAll(new RegExp('id="' + id + '"', "g"))].length, 1, id);
  }
  assert.match(html, /data-firestore-dashboard data-private-dashboard/);
  assert.match(html, /src="\.\.\/firebase-config.js"/);
  assert.match(html, /type="module" src="\.\.\/assets\/app.js"/);
  for (const scope of ["today", "overdue"]) assert.match(html, new RegExp('role="tab"[^>]+data-private-scope="' + scope + '"[^>]+aria-controls="privateScopePanel"'));
});

test("private redesign styles are isolated and preserve dynamic stage variants", () => {
  assert.match(html, /href="\.\/private.css"/);
  assert.match(html, /class="private-page"/);
  assert.doesNotMatch(css, /overflow-x:\s*(hidden|clip)|font-size:\s*[^;]*vw|!important/);
  for (const stage of ["recording", "preparing", "review", "report_review", "complete", "delivered"]) assert.ok(css.includes(`.private-page .stage-${stage} .stage-column-header`));
  assert.match(css, /\.private-page \.stage-board > \.empty-state/);
  assert.match(css, /\.private-page summary[^}]+min-height: 44px/s);
});

test("loading counts are unknown, not a false zero", () => {
  for (const id of ["privatePendingCount", "privatePreStageCount", "privatePostStageCount", "privateCompleteStageCount"]) assert.match(html, new RegExp('id="' + id + '">—<'));
  assert.ok(html.indexOf('id="privateProgressList"') < html.indexOf('id="privateInstructorPendingList"'));
});
