import type { AlimtalkCandidateType } from "../types/models";
import {
  ALIMTALK_TEMPLATE_POLICIES,
  GROUP_SURVEY_BUTTON_URL_TEMPLATE,
  METHOD_MATERIAL_BUTTON_URL_TEMPLATE,
  SHORT_LINK_BUTTON_URL_TEMPLATE,
  SOLAPI_BUTTON_URL_MAX_LENGTH,
  SURVEY_DETAIL_BUTTON_URL_TEMPLATE,
  type AlimtalkButtonUrlRule,
  type AlimtalkSourceDatePolicy,
} from "./templatePolicies";

export {
  GROUP_SURVEY_BUTTON_URL_TEMPLATE,
  METHOD_MATERIAL_BUTTON_URL_TEMPLATE,
  SHORT_LINK_BUTTON_URL_TEMPLATE,
  SOLAPI_BUTTON_URL_MAX_LENGTH,
  SURVEY_DETAIL_BUTTON_URL_TEMPLATE,
  type AlimtalkButtonUrlRule,
};

export interface AlimtalkTemplateTargetRule {
  type: AlimtalkCandidateType;
  templateCode: string;
  templateLabel: string;
  targetRules: string[];
  exclusionRules: string[];
  minSourceDate?: string;
  sourceDatePolicy: AlimtalkSourceDatePolicy;
  maxAgeDays?: number;
  automationStatus: "active" | "paused" | "manual";
  requiresApprovedTemplate: boolean;
  requiresMemberPhone: boolean;
  requiresManagementNumber?: boolean;
  blocksTooLateGroupSurvey?: boolean;
  buttonUrlRules?: AlimtalkButtonUrlRule[];
}

export const ALIMTALK_TEMPLATE_TARGET_RULES: Partial<Record<AlimtalkCandidateType, AlimtalkTemplateTargetRule>> =
  Object.fromEntries(
    Object.values(ALIMTALK_TEMPLATE_POLICIES)
      .filter((policy) => policy.type)
      .map((policy) => [
      policy.type,
      {
        type: policy.type,
        templateCode: policy.code,
        templateLabel: policy.label,
        targetRules: [...policy.targetRules],
        exclusionRules: [...policy.exclusionRules],
        minSourceDate: policy.minSourceDate,
        sourceDatePolicy: policy.sourceDatePolicy,
        maxAgeDays: policy.maxAgeDays,
        automationStatus: policy.automationStatus,
        requiresApprovedTemplate: policy.requiresApprovedTemplate,
        requiresMemberPhone: policy.requiresMemberPhone,
        requiresManagementNumber: policy.requiresManagementNumber,
        blocksTooLateGroupSurvey: policy.blocksTooLateGroupSurvey,
        buttonUrlRules: policy.buttonUrlRules ? [...policy.buttonUrlRules] : undefined,
      },
    ]),
  ) as Partial<Record<AlimtalkCandidateType, AlimtalkTemplateTargetRule>>;

export function alimtalkTemplateTargetRule(type: string): AlimtalkTemplateTargetRule | null {
  return ALIMTALK_TEMPLATE_TARGET_RULES[type as AlimtalkCandidateType] || null;
}

export function renderAlimtalkButtonUrl(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce((url, [name, value]) => url.replaceAll(name, value), template);
}

export function solapiButtonUrlLengthIssue(input: {
  rules?: AlimtalkButtonUrlRule[];
  variables: Record<string, string>;
}): string {
  for (const rule of input.rules || []) {
    const url = renderAlimtalkButtonUrl(rule.template, input.variables);
    if (url.length > rule.maxLength)
      return `${rule.label} URL ${url.length}자: SOLAPI 버튼 URL은 ${rule.maxLength}자 이하`;
  }
  return "";
}

export function surveyDetailButtonUrlLengthIssue(
  responseId: string,
  accessToken: string,
  shortLinkId = "sv-000000000000",
): string {
  return solapiButtonUrlLengthIssue({
    rules: [
      {
        label: "설문 확인하기 버튼",
        template: SURVEY_DETAIL_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
      {
        label: "설문 확인하기 버튼",
        template: SHORT_LINK_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    variables: {
      "#{설문ID}": responseId,
      "#{접근토큰}": accessToken,
      "#{링크ID}": shortLinkId,
    },
  });
}
