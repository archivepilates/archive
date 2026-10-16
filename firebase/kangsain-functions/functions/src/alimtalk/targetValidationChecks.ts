import type { AlimtalkCandidateDoc } from "../types/models";
import { autoSendabilityIssue, inspectAutoSendabilityIssue } from "./eligibility";
import { findCompletedDuplicateForCandidate } from "./dedupe";

// Senders retain their ordering, test exceptions and atomic final guards.
export function targetEligibilityIssue(candidate: AlimtalkCandidateDoc, today: string,
  options: { readOnly?: boolean } = {}): Promise<string> {
  return options.readOnly ? inspectAutoSendabilityIssue(candidate, today) : autoSendabilityIssue(candidate, today);
}

export function targetDuplicateIssue(candidate: AlimtalkCandidateDoc, key: string,
  windowDays: number | null): Promise<string> {
  return findCompletedDuplicateForCandidate(candidate, key, windowDays);
}

export { privateSurveySendabilityIssue } from "./privateSurveySendGuard";
export { renewalCandidateSendabilityIssue } from "./renewalSendGuard";
export { longAbsenceCandidateSendabilityIssue } from "./longAbsenceSendGuard";
export { instructorLessonConfirmationSendabilityIssue } from "../instructorLessonRegistration/instructorLessonConfirmation";
