import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sourceReader, sourceRoot } from "./alimtalk-catalog-source.mjs";

export const AUDIT_PROJECT = "archive-pilates";
export const AUDIT_OPERATOR = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
export const AUDIT_SETTINGS = "systemSettings/membershipContractAutomation";
export const AUDIT_FIELD = "providerHistoryCoverage.nonWelcomeTemplateAllowlist";
export const NONWELCOME_CONTRACT = Object.freeze({
  templateId: "KA01TP2605210729364330NbhZVAu9zA",
  status: "APPROVED",
  name: "아카이브 그룹 첫 수업 사전확인 안내 v1",
  channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA",
  emphasizeType: "IMAGE",
  imageId: "ST01FZ2605210807341668tVH8tDXSj8",
  content: "#{이름}님,\n\n예약하신 아카이브에서의\n첫 그룹수업을\n편안하게 시작하실 수 있도록\n사전 확인 설문을 부탁드립니다.\n\n수업 전 통증, 질환,\n운동 경험 등 강사가 확인할\n내용을 간단히 작성해 주세요.\n\n해당 안내는 #{이름}님이 예약하신\n첫 그룹수업 준비를 위해\n1회 발송됩니다.",
  buttons: Object.freeze([Object.freeze({
    buttonType: "WL", buttonName: "사전확인 작성",
    linkMo: "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}",
    linkPc: "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}",
    targetOut: true,
  })]),
});

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && !!value && value === value.trim();
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = (reason) => { throw new Error(reason); };
const stable = (value) => JSON.stringify(value, (_, entry) => record(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
export const auditHash = (value) => createHash("sha256").update(stable(value)).digest("hex");
export const NONWELCOME_CONTRACT_HASH = auditHash(NONWELCOME_CONTRACT);
export const NONWELCOME_AUDIT_ID = `membership-welcome-nonwelcome-${NONWELCOME_CONTRACT_HASH}`;
const scope = "group_survey";
const utc = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Static AST inspection only: no backend execution, environment resolution or credentials.
export function readNonWelcomeAuditSource() {
  const reader = sourceReader();
  const templates = reader.constant(`${sourceRoot}alimtalk/templates.ts`, "ALIMTALK_TEMPLATES");
  const welcomeIds = reader.constant(`${sourceRoot}memberSignup/membershipWelcomeHistory.ts`, "MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS");
  const welcome = reader.constant(`${sourceRoot}memberSignup/membershipWelcomePolicy.ts`, "MEMBERSHIP_WELCOME_TEMPLATE");
  return {
    groupSurveyId: templates.group_survey?.code,
    welcomeIds: [...new Set([...welcomeIds, welcome.templateId, welcome.referenceTemplateId,
      ...["membership_welcome", "new_member", "onsite_welcome"].map((key) => templates[key]?.code).filter(Boolean)])],
    sourceHash: auditHash(reader.fingerprints()),
  };
}

export function validateNonWelcomeAuditSource(source) {
  if (!record(source) || source.groupSurveyId !== NONWELCOME_CONTRACT.templateId ||
      !Array.isArray(source.welcomeIds) || !source.welcomeIds.length || !source.welcomeIds.every(id) ||
      source.welcomeIds.includes(source.groupSurveyId) || !digest(source.sourceHash))
    fail("nonwelcome_source_attestation_invalid");
}

export function nonWelcomeTemplateIssue(template, source) {
  validateNonWelcomeAuditSource(source);
  if (!record(template)) return "nonwelcome_template_missing";
  if (source.welcomeIds.includes(template.templateId)) return "welcome_template_forbidden";
  for (const key of Object.keys(NONWELCOME_CONTRACT).filter((key) => key !== "buttons")) {
    if (template[key] !== NONWELCOME_CONTRACT[key]) return `nonwelcome_template_${key}_mismatch`;
  }
  if (!Array.isArray(template.buttons) || template.buttons.length !== 1 || !record(template.buttons[0]))
    return "nonwelcome_template_buttons_mismatch";
  const button = template.buttons[0];
  const optional = ["linkAnd", "linkIos", "chatExtra"];
  if (Object.entries(NONWELCOME_CONTRACT.buttons[0]).some(([key, value]) => button[key] !== value) ||
      optional.some((key) => button[key] != null && button[key] !== "") ||
      Object.keys(button).some((key) => !Object.hasOwn(NONWELCOME_CONTRACT.buttons[0], key) && !optional.includes(key)))
    return "nonwelcome_template_buttons_mismatch";
  if (template.quickReplies != null && (!Array.isArray(template.quickReplies) || template.quickReplies.length))
    return "nonwelcome_template_quick_replies_mismatch";
  if (optional.some((key) => template[key] != null && template[key] !== ""))
    return "nonwelcome_template_optional_links_mismatch";
  return "";
}

export function validateExistingNonWelcomeAllowlist(value, source) {
  validateNonWelcomeAuditSource(source);
  if (value === undefined) return;
  if (!record(value) || value.independentlyAudited !== true || !text(value.auditId) ||
      !Array.isArray(value.templateIds) || !value.templateIds.every(id) ||
      new Set(value.templateIds).size !== value.templateIds.length ||
      value.templateIds.some((entry) => source.welcomeIds.includes(entry)))
    fail("invalid_existing_nonwelcome_allowlist");
  if (value.scopedAudits !== undefined) {
    if (!record(value.scopedAudits)) fail("invalid_existing_nonwelcome_audit_metadata");
    if (Object.hasOwn(value.scopedAudits, scope)) {
      const audit = value.scopedAudits[scope];
      if (!record(audit) || audit.auditId !== NONWELCOME_AUDIT_ID || audit.contractHash !== NONWELCOME_CONTRACT_HASH ||
          audit.templateId !== NONWELCOME_CONTRACT.templateId || !value.templateIds.includes(audit.templateId) ||
          !utc(audit.auditedAt) || !digest(audit.sourceHash))
        fail("invalid_existing_nonwelcome_audit_metadata");
    }
  }
  if (value.auditId === NONWELCOME_AUDIT_ID && !value.scopedAudits?.[scope])
    fail("invalid_existing_nonwelcome_audit_metadata");
}

export function validateNonWelcomeAuditConfig(config, source) {
  validateNonWelcomeAuditSource(source);
  if (!record(config) || config.enabled !== true || config.mode !== "live" ||
      config.sourcePromoted !== true || config.nativeE2eVerified !== true)
    fail("enabled_live_promoted_e2e_required");
  const coverage = config.providerHistoryCoverage;
  if (!record(coverage) || coverage.verified !== true || coverage.allWelcomeVersions !== true ||
      coverage.noRetentionGap !== true || !text(coverage.auditId)) fail("general_history_coverage_required");
  validateExistingNonWelcomeAllowlist(coverage.nonWelcomeTemplateAllowlist, source);
}

export function buildNonWelcomeAllowlist({ config, template, source, auditedAt }) {
  validateNonWelcomeAuditConfig(config, source);
  if (!utc(auditedAt)) fail("invalid_nonwelcome_audit_timestamp");
  const issue = nonWelcomeTemplateIssue(template, source);
  if (issue) fail(issue);
  const existing = config.providerHistoryCoverage.nonWelcomeTemplateAllowlist;
  const scopedAudit = { auditId: NONWELCOME_AUDIT_ID, templateId: NONWELCOME_CONTRACT.templateId,
    contractHash: NONWELCOME_CONTRACT_HASH, auditedAt, sourceHash: source.sourceHash };
  // Existing independent attestations are retained, not re-certified by this scoped audit.
  return {
    ...existing,
    independentlyAudited: true,
    auditId: existing?.auditId ?? NONWELCOME_AUDIT_ID,
    templateIds: [...new Set([...(existing?.templateIds ?? []), NONWELCOME_CONTRACT.templateId])],
    scopedAudits: { ...existing?.scopedAudits, [scope]: scopedAudit },
  };
}

function sameSnapshot(initial, current) {
  return initial.exists === true && current.exists === true && initial.updateTime && current.updateTime &&
    isDeepStrictEqual(initial.updateTime, current.updateTime) && isDeepStrictEqual(initial.data(), current.data());
}

// The only possible write is a field-path update in a transaction on this one settings doc.
export async function auditMembershipWelcomeNonWelcome({ db, providerGet, apply = false,
  readSource = readNonWelcomeAuditSource, now = () => new Date().toISOString() }) {
  if (typeof apply !== "boolean") fail("invalid_apply_flag");
  const source = readSource();
  validateNonWelcomeAuditSource(source);
  const ref = db.doc(AUDIT_SETTINGS);
  const initial = await ref.get();
  if (!initial.exists || !initial.updateTime) fail("existing_settings_update_time_required");
  const config = initial.data();
  validateNonWelcomeAuditConfig(config, source);
  const template = await providerGet(`https://api.solapi.com/kakao/v2/templates/${NONWELCOME_CONTRACT.templateId}`);
  const allowlist = buildNonWelcomeAllowlist({ config, template, source, auditedAt: now() });
  const check = (current) => {
    if (!sameSnapshot(initial, current)) fail("settings_changed_retry_read_only");
    if (!isDeepStrictEqual(source, readSource())) fail("audit_source_changed_retry_read_only");
    validateNonWelcomeAuditConfig(current.data(), source);
  };
  if (apply) {
    await db.runTransaction(async (tx) => {
      check(await tx.get(ref));
      tx.update(ref, { [AUDIT_FIELD]: allowlist });
    });
  } else check(await ref.get());
  return { applied: apply, templateIds: allowlist.templateIds, audit: allowlist.scopedAudits[scope] };
}
