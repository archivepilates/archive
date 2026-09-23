import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret } from "../config/secrets";
import { nowTimestamp } from "../utils/date";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { currentAutomaticMemberExclusionReason } from "../alimtalk/recipientExclusion";
import { hasExplicitAlimtalkTestOverride, isAlimtalkTestRecipient } from "../alimtalk/testRecipients";
import { loadMembershipWelcomeHistory } from "./membershipWelcomeHistory";
import { loadMembershipProviderHistory, loadMembershipWelcomeTemplate } from "./membershipWelcomeProvider";
import { normalizeMembershipPhone } from "./membershipContractPolicy";
import { MEMBERSHIP_WELCOME_TEMPLATE } from "./membershipWelcomePolicy";
import { membershipWelcomeReadbackIssue } from "./membershipWelcomeReadback";
import {
  dispatchMembershipWelcome,
  membershipActivationScopeIssue,
  queueMembershipWelcome,
  MEMBERSHIP_AUTOMATION_SETTINGS,
  MEMBERSHIP_CONTRACT_COLLECTION,
  type MembershipWelcomeDependencies,
} from "./membershipWelcomeQueue";

async function providerGet(url: string, timeoutMs = 20_000) {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", solapiApiSecret.value())
    .update(date + salt)
    .digest("hex");
  const response = await fetch(url, {
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${solapiApiKey.value()}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`SOLAPI read failed (${response.status})`);
  return response.json();
}

function dependencies(): MembershipWelcomeDependencies {
  return {
    db,
    now: () => new Date(),
    timestamp: nowTimestamp,
    async loadEvidence(source, ignoreCandidateId) {
      const persistedCandidate = ignoreCandidateId
        ? (await refs.alimtalkCandidate(ignoreCandidateId).get()).data()
        : undefined;
      const currentSourceIssue = membershipWelcomeReadbackIssue(source, new Date(), persistedCandidate);
      if (currentSourceIssue) return { recipientIssue: currentSourceIssue, history: {}, template: {} };
      const phone = normalizeMembershipPhone(source.completion.memberPhone);
      const memberId = source.completion.memberId;
      const profile = (await refs.memberProfile(memberId).get()).data();
      const candidate = {
        type: "membership_welcome",
        studioId: source.studioId,
        memberId,
        memberPhone: phone,
        memberName: source.memberName,
        payload: {},
      } as AlimtalkCandidateDoc;
      const config = (await db.doc(MEMBERSHIP_AUTOMATION_SETTINGS).get()).data();
      const canaryRecipient =
        config?.activationScope === "canary" &&
        membershipActivationScopeIssue(config, memberId) === "";
      let recipientIssue =
        !profile ||
        profile.studioId !== source.studioId ||
        profile.name !== source.memberName ||
        normalizeMembershipPhone(profile.phone) !== phone
          ? "current_canonical_member_mismatch"
          : "";
      if (
        !recipientIssue &&
        (isAlimtalkTestRecipient(candidate) || /강사|스텝|직원|staff/i.test(String(profile?.memberGrade || "")))
      )
        recipientIssue = "staff_or_instructor_excluded";
      if (!recipientIssue && !canaryRecipient)
        recipientIssue = await currentAutomaticMemberExclusionReason(candidate);
      if (recipientIssue) return { recipientIssue, history: {}, template: {} };
      const local = await loadMembershipWelcomeHistory(db, {
        studioId: source.studioId,
        memberId,
        phone,
        ignoreCandidateId,
      });
      if (!local.complete) return { recipientIssue: local.reason, history: {}, template: {} };
      if (
        local.records.some(
          (record) =>
            record.attempted || ["accepted", "delivered", "queued", "sending", "unknown"].includes(record.status),
        )
      ) {
        return { recipientIssue: "welcome_already_sent_pending_or_ambiguous", history: {}, template: {} };
      }
      // Coverage must be independently audited before promotion; retention gaps fail closed.
      const coverage = config?.providerHistoryCoverage;
      const deadline = Date.now() + 25_000;
      const boundedGet = (url: string) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Provider history deadline exceeded");
        return providerGet(url, Math.min(20_000, remaining));
      };
      const provider = await loadMembershipProviderHistory(boundedGet, {
        phone,
        startAt: coverage?.startAt,
        now: new Date().toISOString(),
        ...(coverage?.nonWelcomeTemplateAllowlist !== undefined
          ? { nonWelcomeTemplateAllowlist: coverage.nonWelcomeTemplateAllowlist }
          : {}),
        coverageVerified:
          coverage?.allWelcomeVersions === true &&
          coverage?.noRetentionGap === true &&
          coverage?.verified === true &&
          typeof coverage?.auditId === "string" &&
          !!coverage.auditId,
      });
      const template = provider.complete ? await loadMembershipWelcomeTemplate(providerGet) : {};
      return {
        recipientIssue: "",
        template,
        history: {
          ...local,
          records: [...local.records, ...provider.records],
          authoritative: true,
          complete: local.complete && provider.complete,
          allVersions: true,
          allTime: provider.complete,
          memberAliasesComplete: local.complete,
          providerComplete: provider.complete,
          studioId: source.studioId,
          phone,
          checkedAt: new Date().toISOString(),
        },
      };
    },
  };
}

/** Uses the existing queue cadence. Disabled configuration does not scan member data. */
export async function reconcileMembershipWelcomeQueue() {
  const config = (await db.doc(MEMBERSHIP_AUTOMATION_SETTINGS).get()).data();
  if (
    config?.enabled !== true ||
    config?.mode !== "live" ||
    config?.sourcePromoted !== true ||
    config?.nativeE2eVerified !== true
  )
    return;
  const snap = await db.collection(MEMBERSHIP_CONTRACT_COLLECTION).where("welcomeStatus", "==", "ready").limit(1).get();
  for (const doc of snap.docs) {
    try {
      const result = await queueMembershipWelcome(dependencies(), doc.id);
      if (result.status === "blocked")
        await doc.ref.update({ welcomeStatus: "review", welcomeReason: result.reason, updatedAt: nowTimestamp() });
    } catch (err) {
      logger.error("Membership welcome reconciliation failed", {
        contractId: doc.id,
        error: err instanceof Error ? err.message : "unknown",
      });
      await doc.ref
        .update({ welcomeStatus: "review", welcomeReason: "reconciliation_failed", updatedAt: nowTimestamp() })
        .catch(() => undefined);
    }
  }
}

export async function sendMembershipWelcome<T extends { messageId: string }>(
  candidate: AlimtalkCandidateDoc,
  transport: () => Promise<T>,
) {
  if (
    candidate.type !== "membership_welcome" ||
    candidate.templateCode !== MEMBERSHIP_WELCOME_TEMPLATE.templateId ||
    hasExplicitAlimtalkTestOverride(candidate)
  )
    throw new Error("membership_welcome_override_forbidden");
  return dispatchMembershipWelcome(dependencies(), candidate, transport);
}
