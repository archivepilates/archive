import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { monthlySettlementArtifacts, monthlySettlementIndexPath } from "../lib/system-health-schedule-evidence.mjs";

const require = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../run-system-health-check.mjs", import.meta.url), "utf8");
const tree = ts.createSourceFile("health.mjs", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "checkLaunchAgents");
assert.ok(declaration);
const now = new Date("2026-11-03T01:00:00Z");
const home = "/synthetic";
const finalPath = monthlySettlementIndexPath(home, now);
const stamp = "2026-11-02T00:00:00Z";

async function inspect({ finalExists = false, reviewExists = true, exitCode = 1, plistExists = true, loaded = true } = {}) {
  const findings = [], checked = [], statuses = [];
  const item = { id: "monthly-settlement-statements", label: "synthetic", title: "월말정산 명세서",
    area: "settlement", resultFile: finalPath, maxAgeMinutes: 40 * 24 * 60, plist: "/synthetic/worker.plist", repair: "none" };
  const inspect = vm.runInNewContext(`${declaration.getText(tree)}\ncheckLaunchAgents`, {
    HOME: home, now, AUTOMATIONS: [item], checked, completedChecks: new Set(),
    existsSync: () => plistExists,
    monthlySettlementArtifacts: (home, date) => monthlySettlementArtifacts(home, date,
      file => file.endsWith("_INDEX_검토본.html") ? reviewExists : finalExists),
    launchAgentState: () => ({ loaded, state: "not running", runs: 1, lastExitCode: exitCode }),
    latestEvidence: () => ({ path: finalPath, exists: finalExists, ageMinutes: finalExists ? 10 : null,
      mtimeIso: finalExists ? stamp : null }),
    addFinding: finding => findings.push(finding), REPAIR: false, READ_ONLY: false, runId: "synthetic",
    db: {}, recordAutomationStatus: async (_db, status) => { statuses.push(status); },
  });
  await inspect();
  return { findings, checked, statuses };
}

test("review evidence improves explanations without changing legacy settlement finding identities", async () => {
  const result = await inspect();
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].title, "Monthly settlement statements 최근 실행 실패");
  assert.equal(result.findings[0].cause, "LaunchAgent last exit code 1");
  assert.equal(result.findings[1].title, "Monthly settlement statements 실행 결과 최신성 확인 필요");
  assert.equal(result.findings[1].cause, "정상 완료된 실행 결과를 찾지 못했습니다.");
  for (const finding of result.findings) {
    assert.equal(finding.area, "settlement");
    assert.equal(finding.sourceRefs[0], finalPath);
    assert.equal(finding.autoRepairable, false);
  }
  assert.match(result.findings[1].impact, /검토본은 있지만 확정 INDEX는 없습니다/);
  assert.equal(result.checked[0].settlementEvidence.state, "review_only");
  assert.equal(result.statuses[0].lastRunAt, null);
  assert.equal(result.statuses[0].status, "failed");
});

test("missing drafts never manufacture completion and a final artifact cannot erase failed execution", async () => {
  const missing = await inspect({ reviewExists: false });
  assert.equal(missing.findings.length, 2);
  assert.equal(missing.checked[0].settlementEvidence.state, "missing");
  const final = await inspect({ finalExists: true });
  assert.equal(final.findings.length, 1);
  assert.equal(final.findings[0].cause, "LaunchAgent last exit code 1");
  assert.equal(final.statuses[0].status, "failed");
  assert.equal(final.statuses[0].lastRunAt, stamp);
});

test("missing or unloaded LaunchAgents also preserve their historical finding identity", async () => {
  const missing = await inspect({ plistExists: false });
  assert.equal(missing.findings.length, 1);
  assert.equal(missing.findings[0].title, "Monthly settlement statements LaunchAgent plist 없음");
  assert.equal(missing.findings[0].cause, "/synthetic/worker.plist 파일이 없습니다.");
  const unloaded = await inspect({ loaded: false });
  assert.equal(unloaded.findings[0].title, "Monthly settlement statements LaunchAgent 미로드");
  assert.equal(unloaded.findings[0].cause, "launchctl print에서 서비스를 찾지 못했습니다.");
});
