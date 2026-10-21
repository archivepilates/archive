import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const planSource = read("core/assets/core-read-plan.js");
const { operationalReadPlan } = await import(`data:text/javascript,${encodeURIComponent(planSource)}`);
const plan = ids => operationalReadPlan({ querySelector: selector => selector.split(", ").some(id => ids.includes(id.slice(1))) });

test("unrelated operator routes do not read global operations collections", () => {
  for (const id of ["privateProgressList", "staffHrList", "recommendedMealQueue", "refundCaseList", "memberRegistrationList", "instructorLessonRegistrationList", "businessMonthSelect", "messagesCandidateList"]) {
    assert.deepEqual(plan([id]), { lane: false, automation: false, imports: false, quality: false }, id);
  }
});

test("home health, member quality and dedicated operations pages retain their source reads", () => {
  assert.deepEqual(plan(["homeDecisionList"]), { lane: false, automation: true, imports: true, quality: true });
  for (const id of ["membersTable", "memberDetailName", "qualityList"]) assert.equal(plan([id]).quality, true);
  assert.equal(plan(["automationList"]).automation, true);
  assert.equal(plan(["importsTable"]).imports, true);
  assert.equal(plan(["laneStatus"]).lane, true);
});

test("every existing operations widget requests its own collection", () => {
  const htmls = fs.readdirSync(new URL("core/", root), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => new URL(`core/${entry.name}/index.html`, root))
    .filter(path => fs.existsSync(path));
  for (const file of htmls) {
    const ids = [...fs.readFileSync(file, "utf8").matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    if (ids.includes("automationList")) assert.equal(plan(ids).automation, true);
    if (ids.includes("importsTable")) assert.equal(plan(ids).imports, true);
    if (ids.includes("qualityList")) assert.equal(plan(ids).quality, true);
  }
});

test("static SDK hints are top-level only and match the runtime version", () => {
  const source = read("core/firebase-config.js");
  function execute(embedded) {
    const links = [];
    const window = {};
    window.parent = embedded ? {} : window;
    vm.runInNewContext(source, { window, document: { createElement: () => ({}), head: { append: link => links.push(link) } } });
    return { window, links };
  }
  const top = execute(false);
  assert.equal(top.links.filter(link => link.rel === "preconnect").length, 1);
  assert.deepEqual(top.links.filter(link => link.rel === "modulepreload").map(link => link.href),
    ["app", "firestore", "auth", "functions"].map(name => `https://www.gstatic.com/firebasejs/${top.window.ARCHIVE_CORE_FIREBASE_VERSION}/firebase-${name}.js`));
  assert.equal(execute(true).links.length, 0);
  assert.match(read("core/assets/app.js"), /globalThis\.ARCHIVE_CORE_FIREBASE_VERSION \|\| "10\.14\.1"/);
});

test("early navigation follows fresh access and finalization cannot tear down a newer destination", () => {
  const app = read("core/assets/app.js");
  const refresh = app.slice(app.indexOf("async function refresh()"));
  assert.ok(refresh.indexOf("await prepareCoreAccess(runtime, user)") < refresh.indexOf("await publishNavigation();"));
  assert.ok(refresh.indexOf("await publishNavigation();") < refresh.indexOf("operationalReadPlan(document)"));
  assert.match(refresh, /if \(!navigationPublished\) await finishCoreNavigation/);
  const access = read("core/assets/core-instructor-access.js");
  assert.ok(access.indexOf("await view.onReady?.();") < access.indexOf('"getCoreInstructorWorkspace"'));
});

test("verified instructors hide the loading block without relying on descendant style invalidation", () => {
  assert.match(read("core/assets/styles.css"), /html\[data-core-access="instructor"\]\[data-core-instructor-uid\]\[data-core-instructor-staff-id\] \.core-access-loading/);
  assert.match(read("core/assets/styles.css"), /html:not\(\[data-core-access="manager"\]\) \.shell \{\s*display: none !important;/);
});
