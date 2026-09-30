#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sourceReader, sourceRoot, root, hash } from "./lib/alimtalk-catalog-source.mjs";
import { purposes, supplemental, timingBasisLabels } from "./lib/alimtalk-catalog-metadata.mjs";

export const catalogFile = "core/assets/alimtalk-catalog.json";
const coverageFile = "scripts/fixtures/alimtalk-catalog-known-provider.json";
const source = (name) => `${sourceRoot}${name}.ts`;
const templatesPath = source("alimtalk/templates");
const rulesPath = source("alimtalk/templateTargetRules");
const noticePath = source("alimtalk/ticketNoticePolicy");

export async function buildCatalog() {
  const reader = sourceReader();
  const templates = reader.constant(templatesPath, "ALIMTALK_TEMPLATES");
  const rules = reader.constant(rulesPath, "ALIMTALK_TEMPLATE_TARGET_RULES");
  const noticePolicy = reader.constant(noticePath, "TICKET_NOTICE_POLICY");
  const factContracts = reader.constant(noticePath, "REVIEWED_TICKET_FACT_CONTRACTS");
  const timezone = reader.constant(source("config/constants"), "TIMEZONE");
  const careTypes = reader.constant(source("alimtalk/dedupe"), "MEMBER_CARE_TYPES");
  assert.ok(!careTypes.includes("reservation_open"), "Reservation-open must stay outside member-care cooldown");
  assert.equal(noticePolicy.purpose, "ticket_facts");
  assert.equal(noticePolicy.followupPurchaseExcludes, false);
  const coverage = JSON.parse(await fs.readFile(path.join(root, coverageFile), "utf8"));
  assert.equal(coverage.templates.length, 23);
  assert.equal(new Set(coverage.templates.map((row) => row.templateId)).size, 23);
  const known = new Map(coverage.templates.map((row) => [row.templateId, row]));
  const history = reader.constant("core/assets/app.js", "ALIMTALK_TEMPLATE_LABELS_BY_CODE");
  const daily = reader.schedule(source("exports/alimtalk"), "scheduledQueueAndSendAlimtalkDaily");
  const reservation = reader.schedule(source("exports/alimtalk"), "scheduledQueueAndSendReservationOpenAlimtalk");
  const staffSurvey = reader.schedule(source("exports/privateChart"), "scheduledProcessStaffSurveyAlimtalks");
  const staffChart = reader.schedule(source("exports/privateChart"), "scheduledSendTodayPrivateLessonChartAlimtalks");
  const surveyPath = source("privateSurvey/privateSurveyResponse");
  const chartPath = source("privateLessonChart/privateLessonChart");
  const staffTimingSource = reader.excerpt(surveyPath, "staffSurveyNotificationDueAt");
  // Staff timing is not exported as policy data. Fail on drift before retaining its summary.
  assert.match(staffTimingSource, /T09:00:00\+09:00/);
  assert.match(staffTimingSource, /due\.setDate\(due\.getDate\(\) - 1\)/);
  assert.match(staffTimingSource, /startMs - 60 \* 60 \* 1000/);
  const staffMetadata = {
    staff_private_survey: { targetRules: ["제출된 프라이빗 사전설문에 연결된 담당강사"], timing: "D-1 09:00부터 수업 시작 전", schedule: staffSurvey, refs: [reader.reference(surveyPath, "staffSurveyNotificationDueAt"), reader.reference(surveyPath, "isStaffSurveyAlimtalkDue")] },
    staff_group_survey: { targetRules: ["제출된 첫 그룹수업 설문에 연결된 담당강사"], timing: "수업 1시간 전부터 수업 시작 전", schedule: staffSurvey, refs: [reader.reference(surveyPath, "staffSurveyNotificationDueAt"), reader.reference(surveyPath, "isStaffSurveyAlimtalkDue")] },
    staff_private_chart: { targetRules: ["당일 유효한 프라이빗 수업 요청이 있는 담당강사", "취소·중복 예약 제외, 담당강사별 하루 1회"], timing: "수업 당일, 담당강사별 통합 안내", schedule: staffChart, refs: [reader.reference(chartPath, "sendTodayPrivateLessonChartAlimtalks"), reader.reference(chartPath, "sendDailyPrivateLessonChartAlimtalksForDate")] },
  };
  const rows = [];
  for (const [type, template] of Object.entries(templates)) {
    assert.ok(purposes[type], `Add an editorial purpose for new source template ${type}`);
    const rule = rules[type] || null;
    const staff = staffMetadata[type];
    assert.ok(rule || staff, `Missing target policy for ${type}`);
    const factOnly = noticePolicy.types.includes(type);
    const archived = ["new_member", "onsite_welcome"].includes(type);
    const schedule = archived ? null : staff?.schedule || (type === "reservation_open" ? reservation : ["ticket_expiring", "remaining_low", "private_count_low", "private_ticket_expiring", "long_absence", "private_survey", "group_survey", "instructor_lesson_material"].includes(type) ? daily : null);
    const targetRules = rule?.targetRules || staff.targetRules;
    const policy = rule ? structuredClone(rule) : { targetRules, exclusionRules: [], sourceDatePolicy: "staff_workflow" };
    if (factOnly) {
      assert.ok(factContracts[template.code], `Unreviewed fact template ${template.code}`);
      assert.ok(targetRules.includes(noticePolicy.targetRule), `Target-rule parity pending for ${type}: main must connect TICKET_NOTICE_POLICY`);
      assert.ok(!policy.exclusionRules.some((text) => /다른 현재 또는 사용예정 동일 유형 유효 수강권 보유/.test(text)), `Obsolete followup exclusion in ${type}`);
    }
    const refs = [reader.reference(templatesPath, "ALIMTALK_TEMPLATES"), ...(rule ? [reader.reference(rulesPath, "ALIMTALK_TEMPLATE_TARGET_RULES")] : staff.refs), ...(schedule ? [schedule.source] : []), ...(factOnly ? [reader.reference(noticePath, "TICKET_NOTICE_POLICY"), reader.reference(noticePath, "REVIEWED_TICKET_FACT_CONTRACTS")] : [])];
    rows.push({
      id: template.code || `source:${type}`, type, code: template.code, label: template.label,
      providerInventoryName: known.get(template.code)?.name || null,
      knownProvider: known.has(template.code),
      implementation: archived ? "archived" : known.has(template.code) ? "source_connected" : "source_only",
      sourceConfiguredStatus: template.status,
      purpose: purposes[type], purposeId: factOnly ? noticePolicy.purpose : type,
      timing: archived ? "신규 발송 종료 · 과거 이력 보존" : staff?.timing || timingBasisLabels[policy.sourceDatePolicy],
      schedule: schedule ? { expression: schedule.expression, timezone } : null,
      targetRules, policy,
      factNotice: factOnly ? { ...noticePolicy, contractFingerprint: factContracts[template.code], reviewState: "reviewed_fact_only", changedTemplateAction: "pending_template_review" } : null,
      careGroup: careTypes.includes(type),
      providerApproval: { status: "UNKNOWN", checkedAt: null, evidence: "not_read_in_this_catalog" },
      deployment: { status: "UNVERIFIED", checkedAt: null },
      sources: refs,
    });
  }
  const seen = new Set(rows.map((row) => row.code));
  for (const [code, label] of new Map([...Object.entries(history), ...coverage.templates.map((row) => [row.templateId, row.name])])) {
    if (seen.has(code)) continue;
    const extra = supplemental[code] || { state: "archived", purpose: "이전 버전 안내 · 이력 보존", target: "현재 ALIMTALK_TEMPLATES 매핑 없음", timing: "현재 발송 시기 정의 없음" };
    rows.push({
      id: code, type: null, code, label, providerInventoryName: known.get(code)?.name || null,
      knownProvider: known.has(code), implementation: extra.state, sourceConfiguredStatus: null,
      purpose: extra.purpose, purposeId: extra.state, timing: extra.timing, schedule: null,
      targetRules: [extra.target], policy: null, factNotice: null, careGroup: false,
      providerApproval: { status: "UNKNOWN", checkedAt: null, evidence: "not_read_in_this_catalog" },
      deployment: { status: "UNVERIFIED", checkedAt: null },
      sources: history[code] ? [reader.reference("core/assets/app.js", "ALIMTALK_TEMPLATE_LABELS_BY_CODE")] : [{ path: coverageFile, symbol: "templates (coverage only)", line: 1 }],
    });
    seen.add(code);
  }
  for (const name of ["alimtalk/rebuildAlimtalkCandidates", "alimtalk/renewalSendGuard", "alimtalk/longAbsencePolicy", "alimtalk/approvalGate", "alimtalk/approvalPolicy", "alimtalk/approvalStore", "alimtalk/queueDailyAlimtalk", "alimtalk/processAlimtalkQueue", "alimtalk/eligibility"]) reader.touch(source(name));
  const sourceFingerprints = reader.fingerprints();
  for (const file of [coverageFile, "scripts/lib/alimtalk-catalog-metadata.mjs", "scripts/lib/alimtalk-catalog-source.mjs", "scripts/generate-alimtalk-catalog.mjs"])
    sourceFingerprints.push({ path: file, sha256: hash(await fs.readFile(path.join(root, file))) });
  sourceFingerprints.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 1,
    policyFingerprint: hash(JSON.stringify(sourceFingerprints)),
    sourceMode: "repository_defaults_no_environment_or_live_reads",
    coverage: { observedAt: coverage.observedAt, knownProviderCount: known.size, sourceOnlyCount: rows.filter((row) => !row.knownProvider).length, note: coverage.basis },
    deployment: { status: "UNVERIFIED" },
    sourceFingerprints,
    rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const catalog = await buildCatalog();
  const output = `${JSON.stringify(catalog, null, 2)}\n`;
  if (process.argv.includes("--check")) assert.equal(await fs.readFile(path.join(root, catalogFile), "utf8"), output, "Catalog is stale. Regenerate after policy edits.");
  else await fs.writeFile(path.join(root, catalogFile), output);
  console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} ${catalog.rows.length} rows; known provider ${catalog.coverage.knownProviderCount}; ${catalog.policyFingerprint}`);
}
