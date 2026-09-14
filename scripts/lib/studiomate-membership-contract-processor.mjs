import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./studiomate-login.mjs";
import {
  captureStudioMateNativeApiClient,
  readCompleteStudioMateContractHistory,
  readExactStudioMateMember,
  readStudioMateTemplateTerms,
  readStudioMateTemplates,
  readStudioMateUserTickets,
} from "./studiomate-native-contract-source.mjs";
import { resolveContractCandidateGroups } from "./studiomate-membership-contract-observer.mjs";
import { selectNativeMembershipContractCandidate } from "./studiomate-membership-contract-native-selection.mjs";
import {
  executeStudioMateMembershipContract,
  MEMBERSHIP_CONTRACT_TEMPLATES,
} from "./studiomate-native-contract-writer.mjs";

const SETTINGS = "systemSettings/membershipContractAutomation";
const HINT_ROOT = "workLanes/studiomate-membership-contract-automation/purchaseHints";
const JOBS = "studiomateMembershipContractJobs";
const CONTRACTS = "studiomateMembershipContracts";

export async function runStudioMateMembershipContractCandidates({
  db,
  rows,
  discovery,
  sealPath,
} = {}) {
  const result = {
    status: "disabled",
    checked: 0,
    waiting: 0,
    signed: 0,
    review: 0,
    studioMateWrites: 0,
    alimtalkSends: 0,
  };
  const config = (await db.doc(SETTINGS).get()).data();
  if (
    process.env.STUDIOMATE_MEMBERSHIP_CONTRACT_WRITER !== "enabled" ||
    config?.contractWriterEnabled !== true ||
    config?.mode !== "live" ||
    config?.sourcePromoted !== true ||
    config?.nativeE2eVerified !== true ||
    config?.studioId !== "5330"
  )
    return result;
  if (
    !Array.isArray(discovery?.candidateFingerprints) ||
    !discovery.candidateFingerprints.length ||
    !discovery.previousDownloadedAt ||
    !discovery.sourceDownloadedAt
  )
    return { ...result, status: "idle" };
  const groups = resolveContractCandidateGroups(
    rows,
    discovery.candidateFingerprints,
  );
  if (groups.length !== discovery.candidateFingerprints.length || groups.length > 5)
    return {
      ...result,
      status: "review",
      review: groups.length,
      reason: "candidate_phone_reconstruction_mismatch",
    };

  let context;
  let release;
  try {
    release = await acquireStudioMateBrowserLock({
      owner: "membership-contract-writer",
      waitMs: 10_000,
    });
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(
      path.join(os.homedir(), "ArchiveIN/automation/browser-profile"),
      { headless: true },
    );
    const page = context.pages()[0] || (await context.newPage());
    const api = await captureStudioMateNativeApiClient(page, {
      ensureLoggedIn: (target) =>
        ensureStudioMateLoggedIn(target, { headless: true }),
    });
    const availableTemplates = await readStudioMateTemplates(api);
    const templateCache = new Map();
    result.status = "checked";
    for (const group of groups) {
      result.checked += 1;
      const hint = discovery.candidateHints?.find(
        (item) => item.phoneFingerprint === group.phoneFingerprint,
      );
      try {
        const memberResult = await readExactStudioMateMember(api, group.phone);
        if (memberResult.status !== "verified" || memberResult.member.inactive) {
          await markHint(db, hint?.hintId, "review", memberResult.reason || "inactive_member");
          result.review += 1;
          continue;
        }
        const [ticketRead, contractHistory] = await Promise.all([
          readStudioMateUserTickets(api, memberResult.member.memberId),
          readCompleteStudioMateContractHistory(api, {
            phone: group.phone,
            startDate: config.contractHistoryStartDate || "2023-01-01",
          }),
        ]);
        const selected = selectNativeMembershipContractCandidate({
          group,
          member: memberResult.member,
          ticketRead,
          contractHistory,
          previousDownloadedAt: discovery.previousDownloadedAt,
          sourceDownloadedAt: discovery.sourceDownloadedAt,
          config,
        });
        if (selected.status !== "eligible") {
          await markHint(db, hint?.hintId, "review", selected.reason);
          result.review += 1;
          continue;
        }
        const templateRule = MEMBERSHIP_CONTRACT_TEMPLATES[selected.selection.action];
        const listedTemplate = availableTemplates.find(
          (item) => item.id === templateRule.id && item.title === templateRule.title,
        );
        if (!listedTemplate) throw new Error("approved_contract_template_missing");
        let loaded = templateCache.get(templateRule.id);
        if (!loaded) {
          loaded = await readStudioMateTemplateTerms(api, templateRule.id);
          templateCache.set(templateRule.id, loaded);
        }
        const staff = {
          id: String(config.contractStaffId || ""),
          name: String(config.contractStaffName || "").trim(),
        };
        const journal = firestoreJournal(db);
        const outcome = await executeStudioMateMembershipContract({
          api,
          journal,
          selection: selected.selection,
          member: memberResult.member,
          ticket: selected.ticket,
          staff,
          template: loaded.template,
          terms: loaded.terms,
          sealPath,
        });
        if (["waiting", "signed", "existing"].includes(outcome.status)) {
          if (outcome.status !== "existing") result.studioMateWrites += 1;
          if (outcome.status === "waiting") result.waiting += 1;
          if (outcome.status === "signed") result.signed += 1;
          await persistContractSource({
            db,
            contractId: outcome.contractId,
            member: memberResult.member,
            ticket: selected.ticket,
            selection: selected.selection,
            template: loaded.template,
          });
          await markHint(db, hint?.hintId, "processed", outcome.reason, {
            contractId: outcome.contractId,
            jobKey: selected.selection.jobKey,
          });
        } else {
          await markHint(db, hint?.hintId, "review", outcome.reason);
          result.review += 1;
        }
      } catch (error) {
        await markHint(
          db,
          hint?.hintId,
          "review",
          safeReason(error),
        );
        result.review += 1;
      }
    }
    return result;
  } finally {
    try {
      await context?.close();
    } finally {
      await release?.();
    }
  }
}

function firestoreJournal(db) {
  return {
    async claim({ jobKey, payloadHash, selection }) {
      const ref = db.collection(JOBS).doc(jobKey);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const data = snap.data();
          if (data.payloadHash !== payloadHash)
            return { status: "rejected", reason: "job_payload_mismatch" };
          if (data.stage === "complete")
            return {
              status: "complete",
              payloadHash,
              contractId: data.contractId,
            };
          return {
            status: "resume",
            payloadHash,
            contractId: data.contractId || "",
          };
        }
        tx.create(ref, {
          schemaVersion: 1,
          jobKey,
          payloadHash,
          stage: "claimed",
          studioId: selection.studioId,
          memberId: selection.memberId,
          userTicketId: selection.userTicketId,
          productId: selection.productId,
          action: selection.action,
          sourceCapturedAt: selection.now,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return { status: "claimed", payloadHash, contractId: "" };
      });
    },
    async stage(jobKey, stage, fields = {}) {
      const ref = db.collection(JOBS).doc(jobKey);
      await ref.set(
        {
          stage,
          ...sanitizeJournalFields(fields),
          updatedAt: new Date(),
        },
        { merge: true },
      );
    },
  };
}

async function persistContractSource({
  db,
  contractId,
  member,
  ticket,
  selection,
  template,
}) {
  const checkedAt = new Date().toISOString();
  const readIdentity = {
    verified: true,
    complete: true,
    checkedAt,
    studioId: selection.studioId,
    memberId: selection.memberId,
  };
  const binding = {
    verified: true,
    studioId: selection.studioId,
    contractId,
    title: template.title,
    memberPhone: selection.memberPhone,
    memberId: selection.memberId,
    userTicketId: selection.userTicketId,
    productId: selection.productId,
    contractAction: selection.action,
    selectionJobKey: selection.jobKey,
    selectedAt: selection.now,
    expectedPaidAmount: ticket.payment.paidAmount,
    previousObservations: [],
  };
  const nativeReadback = {
    member: {
      ...readIdentity,
      source: "studiomate_native_member",
      phone: member.phone,
      phoneMatchCount: 1,
      classification: "member",
      currentRecipientEligible: member.inactive !== true,
    },
    ticket: {
      ...readIdentity,
      source: "studiomate_native_ticket",
      userTicketId: ticket.userTicketId,
      productId: ticket.productId,
      classification: "regular",
      status: ticket.status,
      refunded: ticket.refunded,
      cancelled: ticket.cancelled,
    },
    payment: {
      ...readIdentity,
      source: "studiomate_native_payment",
      userTicketId: ticket.userTicketId,
      productId: ticket.productId,
      status: ticket.payment.status,
      totalAmount: ticket.payment.totalAmount,
      paidAmount: ticket.payment.paidAmount,
      outstandingAmount: ticket.payment.outstandingAmount,
      refundedAmount: ticket.payment.refundedAmount,
    },
    providerSignature: null,
  };
  await db.collection(CONTRACTS).doc(contractId).set(
    {
      schemaVersion: 1,
      source: "studiomate_native_contract",
      contractId,
      studioId: selection.studioId,
      memberName: member.name,
      bindingVerified: true,
      binding,
      selection,
      nativeReadback,
      status: "waiting",
      observationStatus: "waiting",
      observationReason: "native_member_signature_required",
      welcomeStatus: "blocked",
      nextObservationAt: new Date(Date.now() + 10 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

async function markHint(db, hintId, status, reason, fields = {}) {
  if (!hintId) return;
  await db.doc(`${HINT_ROOT}/${hintId}`).set(
    {
      status,
      reason,
      ...fields,
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

function sanitizeJournalFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        [
          "payloadHash",
          "contractId",
          "reason",
          "sealSha256",
          "providerStatus",
        ].includes(key) &&
        (typeof value === "string" || value === null),
    ),
  );
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  return /^[a-z0-9_ -]{1,120}$/i.test(message)
    ? message.replace(/ /g, "_").toLowerCase()
    : "membership_contract_processing_failed";
}
