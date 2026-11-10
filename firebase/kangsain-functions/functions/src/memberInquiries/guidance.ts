import guidance from './guidance.json';

export function matchingGuidance(category: string, answers: Record<string, unknown>) {
  return guidance.rules.filter(rule => rule.category === category && Object.entries(rule.when || {}).every(([key, value]) =>
    Array.isArray(answers[key]) ? (answers[key] as unknown[]).includes(value) : answers[key] === value));
}
export function guidanceEvidence(category: string, answers: Record<string, unknown>) {
  return { version: guidance.version, ruleIds: matchingGuidance(category, answers).map(rule => rule.id),
    source: 'curated_existing_notion_rules', basis:'server_rules_at_receipt',memberReadVerified:false,automaticDecision: false };
}
