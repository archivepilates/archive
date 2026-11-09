import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildMemberInquiryContract } from "../build-member-inquiry-contract.mjs";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("shared inquiry contract and both public/operator schemas cannot drift", () => {
  assert.equal(buildMemberInquiryContract({ check: true }).length, 3);
});
test("inquiry feature-only repairs remain owned by functions-app", () => {
  for (const file of ["policy.ts", "service.ts", "handlers.ts", "contract.ts"])
    assert.deepEqual(codebasesForFile("firebase/kangsain-functions/functions/src/memberInquiries/" + file), ["functions-app"]);
});
test("inquiry runtime contracts are packaged inside physical Functions roots", () => {
  for (const file of ["policy.ts", "service.ts"])
    assert(!fs.readFileSync("firebase/kangsain-functions/functions/src/memberInquiries/" + file, "utf8").includes("packages/contracts"));
  assert(fs.readFileSync("scripts/prepare-functions-codebase.mjs", "utf8").includes("buildMemberInquiryContract({ check: true })"));
});
test("help hosting is isolated and existing sites have no inquiry API replacement", () => {
  const config = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
  const help = config.hosting.filter(site => site.site === "archive-pilates-help");
  assert.equal(help.length, 1); assert.equal(help[0].public, "help");
  assert.equal(help[0].rewrites[0].source, "/api/inquiries");
  assert.equal(help[0].rewrites[0].function.functionId, "memberInquiryApi");
  for (const site of config.hosting.filter(site => site.site !== "archive-pilates-help"))
    assert(!site.rewrites?.some(rule => rule.function?.functionId === "memberInquiryApi"));
});
