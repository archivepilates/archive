import os from "node:os";
import path from "node:path";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred } from "./member-dispatch-window.mjs";
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
import { signatureMaintenanceRecovery, signatureRecoverySelectionPolicy } from "./studiomate-membership-contract-maintenance-recovery.mjs";
import {
  executeStudioMateMembershipContract,
  buildStudioMateSignatureRequestPayload,
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
  now = Date.now,
} = {}) {
  const result = {
    status: "disabled",
    checked: 0,
    excluded: 0,
    ignored: 0,
    waiting: 0,
    signed: 0,
    review: 0,
    studioMateWrites: 0,
    alimtalkSends: 0,
  };
  const deferHints = async (hints) => {
    const window = memberDispatchWindow(now());
    for (const hint of hints || []) await markHint(db, hint.hintId, "native_verification_required", window.reason,
      { nextAllowedAt: window.nextAllowedAt });
    return { ...result, ...window, status: "deferred" };
  };
  if (!memberDispatchWindow(now()).allowed) return deferHints(discovery?.candidateHints);
  const config = (await db.doc(SETTINGS).get()).data();
  if (!memberDispatchWindow(now()).allowed) return deferHints(discovery?.candidateHints);
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
    !(discovery.previousDownloadedAt || discovery.candidateHints?.every((hint) => hint.previousDownloadedAt)) ||
    !discovery.sourceDownloadedAt
  )
    return { ...result, status: "idle" };
  const groups = resolveContractCandidateGroups(
    rows,
    discovery.candidateFingerprints,
  );
  if (groups.length > 5)
    return {
      ...result,
      status: "review",
      review: groups.length,
      reason: "candidate_phone_reconstruction_mismatch",
    };
  for (const hint of discovery.candidateHints || []) {
    if (!groups.some((g) => g.phoneFingerprint === hint.phoneFingerprint)) {
      await markHint(db, hint.hintId, "review", "pending_member_missing_from_current_export");
      result.review += 1;
    }
  }
  if (!groups.length) return { ...result, status: result.review ? "review" : "idle" };

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
      const remainingHints = discovery.candidateHints?.filter(hint =>
        groups.slice(groups.indexOf(group)).some(g => g.phoneFingerprint === hint.phoneFingerprint));
      if (!memberDispatchWindow(now()).allowed) return deferHints(remainingHints);
      result.checked += 1;
      const hint = discovery.candidateHints?.find(
        (item) => item.phoneFingerprint === group.phoneFingerprint,
      );
      try {
        const memberResult = await readExactStudioMateMember(api, group.phone);
        if (!memberDispatchWindow(now()).allowed) return deferHints(remainingHints);
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
        if (!memberDispatchWindow(now()).allowed) return deferHints(remainingHints);
        const recovery = signatureRecoverySelectionPolicy({ config, hint, member: memberResult.member, ticketRead, now: now() });
        if (discovery.signatureRecovery && !recovery) throw new Error("signature_recovery_native_binding_unverified");
        const selected = selectNativeMembershipContractCandidate({
          group,
          member: memberResult.member,
          ticketRead,
          contractHistory,
          previousDownloadedAt: hint?.previousDownloadedAt || discovery.previousDownloadedAt,
          sourceDownloadedAt: discovery.sourceDownloadedAt,
          config: recovery?.config || config,
          ...(recovery ? { issuanceWindowEndAt: recovery.issuanceWindowEndAt } : {}),
        });
        if (selected.status === "excluded") {
          await markHint(db, hint?.hintId, "excluded", selected.reason, {
            memberGrade: selected.memberGrade || "",
          });
          result.excluded += 1;
          continue;
        }
        if (selected.status === "ignored") {
          await markHint(db, hint?.hintId, "ignored", selected.reason);
          result.ignored += 1;
          continue;
        }
        if (selected.status !== "eligible") {
          await markHint(db, hint?.hintId, "review", selected.reason);
          result.review += 1;
          continue;
        }
        if (recovery) {
          if (selected.selection.userTicketId !== recovery.ticketId) throw new Error("signature_recovery_ticket_changed");
          if ((await db.doc(`${JOBS}/${selected.selection.jobKey}`).get()).exists)
            throw new Error("signature_recovery_existing_job_requires_review");
          if (contractHistory.records.some(contract => !contract.ticket?.userTicketId && contract.categoryId === 1
            && contract.ticket?.productId === selected.ticket.productId
            && contract.ticket?.availabilityStartAt === selected.ticket.availabilityStartAt
            && contract.ticket?.expireAt === selected.ticket.expireAt))
            throw new Error("signature_recovery_unbound_contract_requires_review");
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
        const journal = firestoreJournal(db, recovery?.approval || null, now);
        const authorizeDispatch = recovery ? async () => {
          try {
            const current = (await db.doc(SETTINGS).get()).data();
            const approval = signatureMaintenanceRecovery(current, now());
            const bounded = signatureRecoverySelectionPolicy({ config: current, hint, member: memberResult.member, ticketRead, now: now() });
            if (approval && approval.approvalHash === recovery.approval.approvalHash && bounded?.ticketId === recovery.ticketId) return;
          } catch { /* An unavailable approval is not an attempted provider request. */ }
            throw Object.assign(new Error("signature_recovery_approval_unavailable"), { code: "contract_dispatch_authorization_paused" });
        } : undefined;
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
          now,
          authorizeDispatch,
        });
        if (outcome.status === "deferred") return deferHints(remainingHints);
        if (["waiting", "signed", "existing"].includes(outcome.status)) {
          if (outcome.status !== "existing") result.studioMateWrites += 1;
          if (outcome.status === "waiting") result.waiting += 1;
          if (outcome.status === "signed") result.signed += 1;
          await persistStudioMateMembershipContractSource({
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
        if (isMemberDispatchDeferred(error) || !memberDispatchWindow(now()).allowed) return deferHints(remainingHints);
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

export function firestoreJournal(db, recoveryApproval = null, now = Date.now) {
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
            stage: data.stage || "",
            reason: data.reason || "",
            preparedPayload: data.preparedPayload || "",
            dispatchDeferrals: data.dispatchDeferrals || [],
          };
        }
        assertMemberDispatchAllowed(now());
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
          ...(recoveryApproval ? { recoveryApproval } : {}),
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

export async function persistStudioMateMembershipContractSource({
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
    expectedOutstandingAmount: ticket.payment.outstandingAmount,
    expectedTotalAmount: ticket.payment.totalAmount,
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
  if (fields.dispatchDeferrals !== undefined && (!Array.isArray(fields.dispatchDeferrals) || fields.dispatchDeferrals.length > 100 ||
    fields.dispatchDeferrals.some(row => !row || Object.keys(row).some(key => !["stage", "deferredAt", "nextAllowedAt", "providerPostCount"].includes(key)) ||
      !/^[a-z_]{1,80}$/.test(row.stage || "") || !Number.isFinite(Date.parse(row.deferredAt)) || row.providerPostCount !== 0 ||
      row.nextAllowedAt !== null && !Number.isFinite(Date.parse(row.nextAllowedAt)))))
    throw new Error("contract_dispatch_deferral_audit_invalid");
  if (fields.preparedPayload) {
    if (typeof fields.preparedPayload !== "string" || fields.preparedPayload.length > 16_384)
      throw new Error("signature_prepared_payload_invalid");
    const prepared = JSON.parse(fields.preparedPayload);
    if (Object.keys(prepared).some(key => !["contract_id_hash", "contractor_name", "studio_name", "contract_link", "title", "message"].includes(key)))
      throw new Error("signature_prepared_payload_invalid");
    buildStudioMateSignatureRequestPayload({ prepared, contractId: fields.contractId, memberName: prepared.contractor_name });
  }
  return { ...Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        [
          "payloadHash",
          "contractId",
          "reason",
          "sealSha256",
          "providerStatus",
          "preparedPayload",
        ].includes(key) &&
        (typeof value === "string" || value === null),
    ),
  ), ...(fields.dispatchDeferrals !== undefined ? { dispatchDeferrals: structuredClone(fields.dispatchDeferrals) } : {}) };
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  return /^[a-z0-9_ -]{1,120}$/i.test(message)
    ? message.replace(/ /g, "_").toLowerCase()
    : "membership_contract_processing_failed";
}
