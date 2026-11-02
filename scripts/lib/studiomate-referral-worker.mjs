import { assessStudioMateReferral, digest, executePointAction, phone, REFERRAL_COLLECTION, CLAIM_COLLECTION } from "./studiomate-referral-points.mjs";
import { createStudioMateBrowserSession } from "./studiomate-browser-session.mjs";
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from "./studiomate-native-contract-source.mjs";
import { createStudioMatePointUI } from "./studiomate-point-ui.mjs";

const SETTINGS = "systemSettings/studiomateReferralAutomation";
const SCAN_STATE = "automationStatus/studiomate-referral-points";
const excluded = /체험|강사레슨|강사 레슨|야외|무료|1회권|스텝|스태프/;
const fingerprint = source => digest({ ...source, checkedAt: undefined });
const attribution = record => Object.fromEntries(["newMemberName", "newMemberPhone", "referrerName", "referrerPhone"].map(key => [key, record?.[key]]));
const sameRequest = (a, b) => a?.studioId === "5330" && a?.inputHash === digest(attribution(a)) &&
  a.inputHash === b.inputHash && digest(attribution(a)) === digest(attribution(b));

export function firstQualifyingReferralTicket(tickets) {
  return tickets.filter(t => !excluded.test(t.title) && t.payment?.verified === true &&
    t.payment.complete === true && t.payment.status === "paid" && t.payment.outstandingAmount === 0 &&
    t.payment.paidAmount === t.payment.totalAmount && t.payment.totalAmount >= 300_000 && t.usable && !t.isShared &&
    !t.cancelled && !t.refunded && ["active", "scheduled"].includes(t.status))
    .sort((x, y) => Date.parse(x.issuedAt) - Date.parse(y.issuedAt))[0];
}

export async function loadReferralBatch(db) {
  const scan = (await db.doc(SCAN_STATE).get()).data();
  const queue = db.collection(REFERRAL_COLLECTION).where("status", "==", "verification_required").orderBy("__name__");
  const cursor = typeof scan?.lastRequestId === "string" && /^[a-f0-9]{64}$/.test(scan.lastRequestId) ? scan.lastRequestId : "";
  let pending = await (cursor ? queue.startAfter(cursor) : queue).limit(10).get();
  if (pending.empty && cursor) pending = await queue.limit(10).get();
  return pending;
}

export async function readReferralNativeSource(api, request) {
  const [a, b] = await Promise.all([
    readExactStudioMateMember(api, request.newMemberPhone), readExactStudioMateMember(api, request.referrerPhone),
  ]);
  if (a.status !== "verified" || b.status !== "verified") throw new Error("referral_exact_members_unverified");
  const tickets = await readStudioMateUserTickets(api, a.member.memberId);
  if (tickets.status !== "verified" || !tickets.tickets.every(t => t.studioId === "5330"))
    throw new Error("referral_native_purchase_coverage_unverified");
  const first = firstQualifyingReferralTicket(tickets.tickets);
  const purchase = first ? {
    userTicketId: first.userTicketId, memberId: first.memberId, title: first.title,
    paidWon: first.payment.paidAmount, totalWon: first.payment.totalAmount, unpaidWon: first.payment.outstandingAmount,
    cancelled: first.cancelled, refunded: first.refunded, firstQualifyingPurchase: true,
    paidAt: first.payment.transactions.map(t => t.paidAt).sort().at(-1),
  } : null;
  return { live: true, complete: true, studioId: "5330", checkedAt: new Date().toISOString(),
    newcomer: a.member, referrer: b.member, purchase };
}

export function firestorePointLedger(db, requestRef, expectedRequest, settingsHash) {
  return {
    async get(key) { const doc = await db.collection(CLAIM_COLLECTION).doc(key).get(); return doc.exists ? doc.data() : null; },
    async claim(key, record) {
      return db.runTransaction(async tx => {
        const claim = db.collection(CLAIM_COLLECTION).doc(key);
        const [prior, request, settings] = await Promise.all([tx.get(claim), tx.get(requestRef), tx.get(db.doc(SETTINGS))]);
        if (prior.exists) return false;
        if (!sameRequest(request.data(), expectedRequest) || request.data().status !== "verification_required" ||
            request.data().claimKey || digest(settings.data()) !== settingsHash)
          throw new Error("referral_source_or_settings_changed");
        tx.create(claim, { ...record, requestId: requestRef.id, createdAt: new Date().toISOString() });
        tx.update(requestRef, { status: "claimed", claimKey: key, reason: "point_write_claimed", updatedAt: new Date() });
        return true;
      });
    },
    async update(key, patch) {
      await db.runTransaction(async tx => {
        const ref = db.collection(CLAIM_COLLECTION).doc(key);
        const [saved, request, settings] = await Promise.all([tx.get(ref), tx.get(requestRef), tx.get(db.doc(SETTINGS))]);
        if (!saved.exists || saved.data().requestId !== requestRef.id) throw new Error("missing_referral_claim");
        if (patch.status === "dispatching" && digest(settings.data()) !== settingsHash)
          throw new Error("referral_settings_changed_before_dispatch");
        tx.update(ref, patch);
        if (request.data()?.claimKey === key && sameRequest(request.data(), expectedRequest) &&
            ["claimed", "dispatching", "review"].includes(request.data().status))
          tx.update(requestRef, { status: patch.status, reason: patch.reason || `point_${patch.status}`, updatedAt: new Date() });
        else if (patch.status === "dispatching") throw new Error("referral_cancelled_or_changed_before_dispatch");
      });
    },
  };
}

// Called inside the existing hourly import only. No new timer, API sync mode,
// automatic backfill, member messages, balance assignment or unknown-write retry.
export async function runStudioMateReferralPoints({ db, rows, source, sessionFactory = createStudioMateBrowserSession }) {
  const result = { status: "disabled", checked: 0, verified: 0, review: 0, pointWrites: 0, memberMessages: 0 };
  if (process.env.STUDIOMATE_REFERRAL_POINTS === "disabled") return result;
  const config = (await db.doc(SETTINGS).get()).data();
  if (config?.enabled !== true || config.purchaseThresholdConfirmed !== true || config.sourcePromoted !== true ||
      config.pointWriterE2eVerified !== true || config.studioId !== "5330") return result;
  const downloaded = Date.parse(source?.downloadedAt);
  if (source?.complete !== true || source.applied !== true || !source.sourceImportId ||
      !Number.isFinite(downloaded) || downloaded > Date.now() || Date.now() - downloaded > 30 * 60_000 || !Array.isArray(rows))
    return { ...result, status: "review", reason: "fresh_complete_excel_required" };
  const pending = await loadReferralBatch(db);
  if (pending.empty) return { ...result, status: "idle" };
  const session = sessionFactory();
  try {
    for (const document of pending.docs) {
      result.checked++;
      const request = document.data();
      if (!sameRequest(request, request) || !rows.some(r => phone(r["전화번호"]) === request.newMemberPhone && r["이름"] === request.newMemberName)) {
        result.review++; continue;
      }
      try {
        const outcome = await session.run(async page => {
          const api = await captureStudioMateNativeApiClient(page);
          const live = await readReferralNativeSource(api, request);
          const key = (await import("./studiomate-referral-points.mjs")).referralClaimKey(live.newcomer.memberId);
          const ledger = firestorePointLedger(db, document.ref, request, digest(config));
          const decision = assessStudioMateReferral({ request, source: live, policy: config, existingClaim: await ledger.get(key) });
          if (!decision.eligible) return { status: "held", reason: decision.reason };
          const target = { memberId: live.referrer.memberId, name: live.referrer.name, phone: live.referrer.phone };
          return executePointAction({ target, ledger, native: createStudioMatePointUI(page),
            action: { key, direction: "credit", points: decision.amount, reason: decision.reason },
            revalidate: async () => {
              const current = await readReferralNativeSource(api, request);
              // Read fast canonical gates only after slower native verification.
              const [settings, freshRequest] = await Promise.all([db.doc(SETTINGS).get(), document.ref.get()]);
              return fingerprint(current) === fingerprint(live) && digest(settings.data()) === digest(config) &&
                sameRequest(freshRequest.data(), request) &&
                (freshRequest.data().status === "verification_required" && !freshRequest.data().claimKey ||
                  freshRequest.data().status === "claimed" && freshRequest.data().claimKey === key) &&
                assessStudioMateReferral({ request, source: current, policy: config }).eligible;
            },
          });
        });
        if (outcome.status === "verified") { result.verified++; result.pointWrites++; }
        else if (outcome.status === "held") {
          result.review++;
          // Keep policy/expiry/unpaid holds pending for the next fresh hourly read.
          await document.ref.update({ reason: outcome.reason, updatedAt: new Date() });
        }
      } catch {
        result.review++;
        // Never erase an accepted or uncertain action's claim or resend it.
        const fresh = await document.ref.get();
        if (!fresh.data()?.claimKey) await document.ref.update({ reason: "native_verification_required", updatedAt: new Date() });
      }
    }
    await db.doc(SCAN_STATE).set({ lastRequestId: pending.docs.at(-1).id, updatedAt: new Date(),
      status: result.review ? "review" : "complete", summary: result }, { merge: true });
    return { ...result, status: result.review ? "review" : "complete" };
  } finally { await session.close(); }
}
