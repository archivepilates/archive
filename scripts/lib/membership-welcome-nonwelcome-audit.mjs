import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sourceReader, sourceRoot } from "./alimtalk-catalog-source.mjs";

export const AUDIT_PROJECT = "archive-pilates";
export const AUDIT_OPERATOR = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
export const AUDIT_SETTINGS = "systemSettings/membershipContractAutomation";
export const AUDIT_FIELD = "providerHistoryCoverage.nonWelcomeTemplateAllowlist";
export const DEFAULT_NONWELCOME_SCOPE = "group_survey";
export const NONWELCOME_SCOPES = Object.freeze([
  DEFAULT_NONWELCOME_SCOPE, "reservation_open", "private_survey", "private_lesson_report",
]);
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
const reservationContractIdentity = Object.freeze({
  templateId: "KA01TP26072806273194229P2ZesQwPp",
  status: "APPROVED",
  name: "아카이브 스튜디오메이트 예약 안내 v4",
  channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA",
  emphasizeType: "IMAGE",
  imageId: "ST01FZ260728062730347ZXJsa4lUJuP",
});
const privateScopeContracts = Object.freeze({
  private_survey: {
    symbol: "PRIVATE_SURVEY_NONWELCOME_CONTRACT", sourceKey: "privateSurveyContract",
    identity: {
      templateId: "KA01TP260729144645970fv13He8mfsK", status: "APPROVED",
      name: "프라이빗 사전설문 안내 v2", channelId: "KA01PF260511123220162lk0NUjstpVl",
      messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ2605141601264576AUwmK3Bqgl",
    },
    variables: ["#{이름}"],
    buttons: [{ buttonType: "WL", buttonName: "사전설문 작성", targetOut: true,
      linkMo: "https://in.archivepilates.com/s/#{링크ID}/", linkPc: "https://in.archivepilates.com/s/#{링크ID}/" }],
  },
  private_lesson_report: {
    symbol: "PRIVATE_LESSON_REPORT_NONWELCOME_CONTRACT", sourceKey: "privateLessonReportContract",
    identity: {
      templateId: "KA01TP260528081225871Fr92FW901Vo", status: "APPROVED",
      name: "회원용_프라이빗 수업 리포트 안내 v1", channelId: "KA01PF260511123220162lk0NUjstpVl",
      messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ260528081542186AabecSODs8l",
    },
    variables: ["#{회원명}", "#{수업일시}", "#{회차}"],
    buttons: [{ buttonType: "WL", buttonName: "리포트 확인하기", targetOut: true,
      linkMo: "https://in.archivepilates.com/s/#{리포트링크ID}/", linkPc: "https://in.archivepilates.com/s/#{리포트링크ID}/" }],
  },
});
const sourceContractKey = (scope) => scope === "reservation_open"
  ? "reservationOpenContract" : privateScopeContracts[scope]?.sourceKey;
export function nonWelcomeScopeTemplateId(scope = DEFAULT_NONWELCOME_SCOPE) {
  if (!NONWELCOME_SCOPES.includes(scope)) fail("invalid_nonwelcome_audit_scope");
  if (scope === DEFAULT_NONWELCOME_SCOPE) return NONWELCOME_CONTRACT.templateId;
  return scope === "reservation_open" ? reservationContractIdentity.templateId : privateScopeContracts[scope].identity.templateId;
}

function expectedContract(source, scope) {
  nonWelcomeScopeTemplateId(scope);
  if (scope === DEFAULT_NONWELCOME_SCOPE) return NONWELCOME_CONTRACT;
  if (Object.hasOwn(privateScopeContracts, scope)) {
    const expected = privateScopeContracts[scope], contract = source?.[expected.sourceKey];
    if (!record(contract) ||
        !isDeepStrictEqual(Object.keys(contract).sort(), Object.keys(NONWELCOME_CONTRACT).sort()) ||
        Object.entries(expected.identity).some(([key, value]) => contract[key] !== value) ||
        !text(contract.content) || expected.variables.some((variable) => !contract.content.includes(variable)) ||
        !isDeepStrictEqual(contract.buttons, expected.buttons)) fail(`${scope}_static_contract_required`);
    return contract;
  }
  const contract = source?.reservationOpenContract;
  const urls = ["https://archivepilates.notion.site/notice", "https://archivepilates.notion.site/studiomate"];
  if (!record(contract) ||
      !isDeepStrictEqual(Object.keys(contract).sort(), Object.keys(NONWELCOME_CONTRACT).sort()) ||
      Object.entries(reservationContractIdentity).some(([key, value]) => contract[key] !== value) ||
      !text(contract.content) || !contract.content.includes("#{이름}") || !contract.content.includes("#{예약주차}") ||
      !Array.isArray(contract.buttons) || contract.buttons.length !== urls.length ||
      contract.buttons.some((button, index) => !record(button) ||
        !isDeepStrictEqual(Object.keys(button).sort(), Object.keys(NONWELCOME_CONTRACT.buttons[0]).sort()) ||
        button.buttonType !== "WL" || !text(button.buttonName) || typeof button.targetOut !== "boolean" ||
        button.linkMo !== urls[index] || button.linkPc !== urls[index]))
    fail("reservation_open_static_contract_required");
  return contract;
}
const utc = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Static AST inspection only: no backend execution, environment resolution or credentials.
export function readNonWelcomeAuditSource(scope = DEFAULT_NONWELCOME_SCOPE, reader = sourceReader()) {
  nonWelcomeScopeTemplateId(scope);
  const templates = reader.constant(`${sourceRoot}alimtalk/templates.ts`, "ALIMTALK_TEMPLATES");
  const welcomeIds = reader.constant(`${sourceRoot}memberSignup/membershipWelcomeHistory.ts`, "MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS");
  const welcome = reader.constant(`${sourceRoot}memberSignup/membershipWelcomePolicy.ts`, "MEMBERSHIP_WELCOME_TEMPLATE");
  let reservationOpenContract;
  if (scope === "reservation_open") {
    try {
      reservationOpenContract = reader.constant(`${sourceRoot}alimtalk/templates.ts`, "RESERVATION_OPEN_ALIMTALK_TEMPLATE");
    } catch {
      fail("reservation_open_static_contract_required");
    }
    if (templates.reservation_open?.code !== reservationContractIdentity.templateId)
      fail("nonwelcome_source_attestation_invalid");
  }
  const privateContract = privateScopeContracts[scope];
  let scopedContract;
  if (privateContract) {
    try {
      scopedContract = reader.constant(`${sourceRoot}alimtalk/templates.ts`, privateContract.symbol);
    } catch {
      fail(`${scope}_static_contract_required`);
    }
    if (templates[scope]?.code !== privateContract.identity.templateId)
      fail("nonwelcome_source_attestation_invalid");
  }
  const source = {
    groupSurveyId: templates.group_survey?.code,
    ...(scope === "reservation_open" ? { reservationOpenContract } : {}),
    ...(privateContract ? { [privateContract.sourceKey]: scopedContract } : {}),
    welcomeIds: [...new Set([...welcomeIds, welcome.templateId, welcome.referenceTemplateId,
      ...["membership_welcome", "new_member", "onsite_welcome"].map((key) => templates[key]?.code).filter(Boolean)])],
    sourceHash: auditHash(reader.fingerprints()),
  };
  validateNonWelcomeAuditSource(source, scope);
  return source;
}

export function validateNonWelcomeAuditSource(source, scope = DEFAULT_NONWELCOME_SCOPE) {
  const contract = expectedContract(source, scope);
  if (!record(source) || source.groupSurveyId !== NONWELCOME_CONTRACT.templateId ||
      !Array.isArray(source.welcomeIds) || !source.welcomeIds.length || !source.welcomeIds.every(id) ||
      source.welcomeIds.includes(source.groupSurveyId) || source.welcomeIds.includes(contract.templateId) || !digest(source.sourceHash))
    fail("nonwelcome_source_attestation_invalid");
}

export function nonWelcomeTemplateIssue(template, source, scope = DEFAULT_NONWELCOME_SCOPE) {
  validateNonWelcomeAuditSource(source, scope);
  const contract = expectedContract(source, scope);
  if (!record(template)) return "nonwelcome_template_missing";
  if (source.welcomeIds.includes(template.templateId)) return "welcome_template_forbidden";
  for (const key of Object.keys(contract).filter((key) => key !== "buttons")) {
    if (template[key] !== contract[key]) return `nonwelcome_template_${key}_mismatch`;
  }
  if (!Array.isArray(template.buttons) || template.buttons.length !== contract.buttons.length)
    return "nonwelcome_template_buttons_mismatch";
  const optional = ["linkAnd", "linkIos", "chatExtra"];
  for (const [index, expected] of contract.buttons.entries()) {
    const button = template.buttons[index];
    if (!record(button) || Object.entries(expected).some(([key, value]) => button[key] !== value) ||
        optional.some((key) => button[key] != null && button[key] !== "") ||
        Object.keys(button).some((key) => !Object.hasOwn(expected, key) && !optional.includes(key)))
      return "nonwelcome_template_buttons_mismatch";
  }
  if (template.quickReplies != null && (!Array.isArray(template.quickReplies) || template.quickReplies.length))
    return "nonwelcome_template_quick_replies_mismatch";
  if (optional.some((key) => template[key] != null && template[key] !== ""))
    return "nonwelcome_template_optional_links_mismatch";
  return "";
}

export function validateExistingNonWelcomeAllowlist(value, source, scope = DEFAULT_NONWELCOME_SCOPE) {
  validateNonWelcomeAuditSource(source, scope);
  if (value === undefined) return;
  if (!record(value) || value.independentlyAudited !== true || !text(value.auditId) ||
      !Array.isArray(value.templateIds) || !value.templateIds.every(id) ||
      new Set(value.templateIds).size !== value.templateIds.length ||
      value.templateIds.some((entry) => source.welcomeIds.includes(entry)))
    fail("invalid_existing_nonwelcome_allowlist");
  if (value.scopedAudits !== undefined) {
    if (!record(value.scopedAudits)) fail("invalid_existing_nonwelcome_audit_metadata");
    for (const knownScope of NONWELCOME_SCOPES) {
      if (!Object.hasOwn(value.scopedAudits, knownScope)) continue;
      const audit = value.scopedAudits[knownScope];
      const contract = knownScope === DEFAULT_NONWELCOME_SCOPE || source[sourceContractKey(knownScope)]
        ? expectedContract(source, knownScope) : null;
      if (!record(audit) || !digest(audit.contractHash) ||
          audit.auditId !== `membership-welcome-nonwelcome-${audit.contractHash}` ||
          (contract && audit.contractHash !== auditHash(contract)) ||
          audit.templateId !== nonWelcomeScopeTemplateId(knownScope) || !value.templateIds.includes(audit.templateId) ||
          !utc(audit.auditedAt) || !digest(audit.sourceHash))
        fail("invalid_existing_nonwelcome_audit_metadata");
    }
  }
  if (value.auditId === NONWELCOME_AUDIT_ID && !value.scopedAudits?.[DEFAULT_NONWELCOME_SCOPE])
    fail("invalid_existing_nonwelcome_audit_metadata");
  for (const knownScope of NONWELCOME_SCOPES.filter((entry) => entry !== DEFAULT_NONWELCOME_SCOPE)) {
    const contract = source[sourceContractKey(knownScope)];
    if (contract && value.auditId === `membership-welcome-nonwelcome-${auditHash(contract)}` &&
        !value.scopedAudits?.[knownScope]) fail("invalid_existing_nonwelcome_audit_metadata");
  }
}

export function validateNonWelcomeAuditConfig(config, source, scope = DEFAULT_NONWELCOME_SCOPE) {
  validateNonWelcomeAuditSource(source, scope);
  if (!record(config) || config.enabled !== true || config.mode !== "live" ||
      config.sourcePromoted !== true || config.nativeE2eVerified !== true)
    fail("enabled_live_promoted_e2e_required");
  const coverage = config.providerHistoryCoverage;
  if (!record(coverage) || coverage.verified !== true || coverage.allWelcomeVersions !== true ||
      coverage.noRetentionGap !== true || !text(coverage.auditId)) fail("general_history_coverage_required");
  validateExistingNonWelcomeAllowlist(coverage.nonWelcomeTemplateAllowlist, source, scope);
}

export function buildNonWelcomeAllowlist({ config, template, source, auditedAt, scope = DEFAULT_NONWELCOME_SCOPE }) {
  validateNonWelcomeAuditConfig(config, source, scope);
  if (!utc(auditedAt)) fail("invalid_nonwelcome_audit_timestamp");
  const issue = nonWelcomeTemplateIssue(template, source, scope);
  if (issue) fail(issue);
  const existing = config.providerHistoryCoverage.nonWelcomeTemplateAllowlist;
  const contract = expectedContract(source, scope);
  const contractHash = auditHash(contract);
  const scopedAudit = { auditId: `membership-welcome-nonwelcome-${contractHash}`, templateId: contract.templateId,
    contractHash, auditedAt, sourceHash: source.sourceHash };
  // Existing independent attestations are retained, not re-certified by this scoped audit.
  return {
    ...existing,
    independentlyAudited: true,
    auditId: existing?.auditId ?? scopedAudit.auditId,
    templateIds: [...new Set([...(existing?.templateIds ?? []), contract.templateId])],
    scopedAudits: { ...existing?.scopedAudits, [scope]: scopedAudit },
  };
}

function sameSnapshot(initial, current) {
  return initial.exists === true && current.exists === true && initial.updateTime && current.updateTime &&
    isDeepStrictEqual(initial.updateTime, current.updateTime) && isDeepStrictEqual(initial.data(), current.data());
}

// The only possible write is a field-path update in a transaction on this one settings doc.
export async function auditMembershipWelcomeNonWelcome({ db, providerGet, apply = false,
  scope = DEFAULT_NONWELCOME_SCOPE, readSource = readNonWelcomeAuditSource, now = () => new Date().toISOString() }) {
  if (typeof apply !== "boolean") fail("invalid_apply_flag");
  nonWelcomeScopeTemplateId(scope);
  const source = readSource(scope);
  validateNonWelcomeAuditSource(source, scope);
  const ref = db.doc(AUDIT_SETTINGS);
  const initial = await ref.get();
  if (!initial.exists || !initial.updateTime) fail("existing_settings_update_time_required");
  const config = initial.data();
  validateNonWelcomeAuditConfig(config, source, scope);
  const template = await providerGet(`https://api.solapi.com/kakao/v2/templates/${nonWelcomeScopeTemplateId(scope)}`);
  const allowlist = buildNonWelcomeAllowlist({ config, template, source, auditedAt: now(), scope });
  const check = (current) => {
    if (!sameSnapshot(initial, current)) fail("settings_changed_retry_read_only");
    if (!isDeepStrictEqual(source, readSource(scope))) fail("audit_source_changed_retry_read_only");
    validateNonWelcomeAuditConfig(current.data(), source, scope);
  };
  if (apply) {
    await db.runTransaction(async (tx) => {
      check(await tx.get(ref));
      tx.update(ref, { [AUDIT_FIELD]: allowlist });
    });
  } else check(await ref.get());
  return { applied: apply, templateIds: allowlist.templateIds, audit: allowlist.scopedAudits[scope] };
}
