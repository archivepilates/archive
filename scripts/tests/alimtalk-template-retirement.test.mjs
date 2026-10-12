import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { root, sourceReader } from "../lib/alimtalk-catalog-source.mjs";

const read = name => fs.readFile(`${root}/${name}`, "utf8");
const plan = JSON.parse(await read("scripts/fixtures/alimtalk-template-retirement.json"));
const templates = sourceReader().constant("firebase/kangsain-functions/functions/src/alimtalk/templates.ts", "ALIMTALK_TEMPLATES");

test("retirement list is exact and disjoint from current automated and manual templates", () => {
  assert.equal(plan.templates.length, 5);
  assert.equal(new Set(plan.templates.map(t => t.templateId)).size, 5);
  const active = Object.values(templates).filter(t => t.status === "approved").map(t => t.code);
  for (const t of plan.templates) assert.ok(!active.includes(t.templateId));
  assert.equal(templates.onsite_welcome.status, "deleted");
  assert.equal(templates.onsite_welcome.code, "KA01TP260602101939427lPhGyuDLvFM");
  assert.equal(templates.membership_welcome.status, "approved");
});

test("deleted IDs remain history and duplicate-prevention markers", async () => {
  const history = await read("firebase/kangsain-functions/functions/src/memberSignup/membershipWelcomeHistory.ts");
  assert.ok(history.includes(templates.onsite_welcome.code));
  const dedupe = await read("firebase/kangsain-functions/functions/src/alimtalk/templates.ts");
  assert.ok(dedupe.includes("[ALIMTALK_TEMPLATES.onsite_welcome.code]"));
  const creation = await read("scripts/create-staff-private-survey-solapi-template.mjs");
  assert.ok(creation.includes(templates.staff_private_survey.code));
  assert.ok(!creation.includes("KA01TP260519093416836f1EHZYJ00uM"));
  const welcomeCreation = await read("scripts/create-membership-welcome-solapi-template.mjs");
  assert.ok(!welcomeCreation.includes("request(`${api}/${spec.referenceTemplateId}`)"));
  assert.ok(welcomeCreation.includes("request(`${api}/${spec.templateId}`)"));
});

test("provider cleanup is opt-in, bounded, backed up, and never sends or deletes canonical history", async () => {
  const code = await read("scripts/retire-unused-alimtalk-templates.mjs");
  assert.match(code, /process\.argv\.includes\("--apply"\)/);
  assert.match(code, /ensureIdle\(item\.templateId\)/);
  assert.match(code, /flag: "wx"/);
  assert.match(code, /protectedIds/);
  assert.match(code, /Deletion not independently confirmed/);
  assert.doesNotMatch(code, /send-many|\.set\(|\.update\(\{/);
  assert.equal((code.match(/\.delete\(/g) || []).length, 1);
  assert.match(code, /db\.collection\("alimtalkTemplateStates"\)\.doc\(item\.templateId\)\.delete\(\)/);
});

test("only confirmed missing templates leave the CORE catalog", async () => {
  const catalog = JSON.parse(await read("core/assets/alimtalk-catalog.json"));
  for (const t of plan.templates) {
    const row = catalog.rows.find(r => r.code === t.templateId);
    assert.equal(row.visibility.state, "hidden_deleted");
    assert.equal(row.visibility.httpStatus, 404);
    assert.equal(row.visibility.errorCode, "TemplateNotFound");
  }
  for (const type of ["membership_welcome", "group_survey", "staff_group_survey", "private_survey", "staff_private_survey", "staff_private_chart", "recommended_meal_survey", "pricing_info"])
    assert.equal(catalog.rows.find(r => r.type === type).visibility.state, "visible");
});
