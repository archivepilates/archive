import { spawn } from "node:child_process";

export const HOLDING_RECEIPT_CHECKS = "holdingNoticeReceiptChecks";
export const HOLDING_RECEIPT_CURSOR = "opsState/holdingAutomaticReceiptCursor";

export function createHoldingWorkerDeadline({ budgetMs = 8 * 60_000, now = () => performance.now() } = {}) {
  const end = now() + budgetMs, controller = new AbortController();
  const stop = (error = new Error("holding_worker_deadline_reached")) => controller.abort(error);
  const timer = setTimeout(stop, budgetMs);
  timer.unref?.();
  return {
    signal: controller.signal, stop,
    remaining: () => controller.signal.aborted ? 0 : Math.max(0, end - now()),
    timeout(maxMs) {
      const left = controller.signal.aborted ? 0 : Math.floor(end - now());
      if (left <= 0 || maxMs <= 0) throw controller.signal.reason || new Error("holding_worker_deadline_reached");
      return Math.max(1, Math.min(maxMs, left));
    },
    dispose: () => clearTimeout(timer),
  };
}

const oldest = (a, b) => (Date.parse(a.lastCheckedAt || a.requestedAt) || 0) -
  (Date.parse(b.lastCheckedAt || b.requestedAt) || 0) || String(a.jobId).localeCompare(String(b.jobId));

export function selectHoldingWorkerJobs(jobs, limit = 10) {
  const continued = jobs.filter(job => job.transition === "continued").sort(oldest);
  const reserved = continued.slice(0, Math.min(2, limit));
  const reservedIds = new Set(reserved.map(job => job.jobId));
  const rest = jobs.filter(job => !reservedIds.has(job.jobId)).sort((a, b) =>
    Number(!["entered", "changed"].includes(a.transition)) - Number(!["entered", "changed"].includes(b.transition)) || oldest(a, b));
  return [...reserved, ...rest].slice(0, limit);
}

/** Bounded ring scan; only matching send ledgers, never unclaimed events, enter receipt polling. */
export async function loadHoldingReceiptCandidates({ db, eventsCollection, deadline, maxEvents = 400, pageSize = 50,
  onUnresolved = () => {} }) {
  let cursor = (await db.doc(HOLDING_RECEIPT_CURSOR).get()).data()?.afterId || "";
  let wrapped = false, scanned = 0;
  const candidates = [], seen = new Set();
  while (scanned < maxEvents && deadline.remaining() > 30_000) {
    let query = db.collection(eventsCollection).where("status", "in", ["ready", "reconciliation_required"]).orderBy("__name__");
    if (cursor) query = query.startAfter(cursor);
    const page = await query.limit(Math.min(pageSize, maxEvents - scanned)).get();
    if (deadline.remaining() <= 30_000) break;
    if (!page.docs.length) {
      if (!cursor || wrapped) break;
      cursor = ""; wrapped = true; continue;
    }
    const docs = page.docs.filter(doc => !seen.has(doc.id));
    if (!docs.length) break;
    scanned += docs.length;
    const snapshots = await db.getAll(...docs.flatMap(doc => [db.doc(`alimtalkSends/${doc.id}`), db.doc(`${HOLDING_RECEIPT_CHECKS}/${doc.id}`)]));
    for (const [index, doc] of docs.entries()) {
      seen.add(doc.id);
      const ledger = snapshots[index * 2].data(), check = snapshots[index * 2 + 1].data();
      if (ledger?.id !== doc.id || !ledger.solapiMessageId || ledger.payload?.deliveryMode !== "automatic_live_readback") {
        if (doc.data().status === "reconciliation_required" || ledger?.id === doc.id && ledger.payload?.deliveryMode === "automatic_live_readback")
          onUnresolved({ id: doc.id, reason: "holding_receipt_ledger_missing_or_ineligible_no_retry" });
        continue;
      }
      candidates.push({ id: doc.id, lastCheckedAt: check?.lastCheckedAt || "" });
    }
    cursor = docs.at(-1).id;
    if (deadline.remaining() > 0) await db.doc(HOLDING_RECEIPT_CURSOR).set({ afterId: cursor });
  }
  return candidates.sort((a, b) => (Date.parse(a.lastCheckedAt) || 0) - (Date.parse(b.lastCheckedAt) || 0) || a.id.localeCompare(b.id)).slice(0, 10);
}

export async function recordHoldingReceiptCheck({ db, id, now = new Date(), error = null }) {
  await db.doc(`${HOLDING_RECEIPT_CHECKS}/${id}`).set({ lastCheckedAt: now.toISOString(), lastError: error });
}

/** Status is the only mutable canonical field; delivered is terminal, and no claim means no receipt state. */
export async function transitionHoldingWorkerEvent({ db, eventsCollection, id, status, promoted = true }) {
  if (!promoted) return false;
  if (!["delivered", "reconciliation_required"].includes(status)) throw new Error("invalid_holding_event_transition");
  return db.runTransaction(async tx => {
    const ref = db.doc(`${eventsCollection}/${id}`), event = (await tx.get(ref)).data();
    const send = (await tx.get(db.doc(`alimtalkSends/${id}`))).data();
    const claim = (await tx.get(db.doc(`holdingNoticeClaims/${id}`))).data();
    if (!event || event.id !== id || event.canonical !== true || event.status === "delivered" ||
        !["ready", "reconciliation_required"].includes(event.status)) return false;
    const delivered = send?.id === id && send.status === "done" && send.providerStatus === "COMPLETE" &&
      send.providerStatusCode === "4000" && !!send.solapiMessageId && claim?.status === "delivered" &&
      claim.solapiMessageId === send.solapiMessageId;
    if (status === "delivered" && !delivered) return false;
    const attempted = send?.id === id && send.payload?.deliveryMode === "automatic_live_readback" || claim?.candidateId === id;
    if (status === "reconciliation_required" && (!attempted || delivered || claim?.status === "delivered")) return false;
    tx.update(ref, { status });
    return true;
  });
}

/** Stop cooperatively and wait for close, so the collector can close its context and release its lock. */
export function runHoldingWorkerChild(command, args, { deadline, maxMs, env = process.env,
  spawnImpl = spawn, maxBuffer = 2 * 1024 * 1024, cleanupGraceMs = 30_000, onCleanupSlow = () => {} } = {}) {
  const timeout = deadline.timeout(maxMs);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure, cleanupTimer, settled = false;
    const stop = error => {
      if (failure || settled) return;
      failure = error;
      child.kill("SIGTERM");
      cleanupTimer = setTimeout(() => onCleanupSlow(error), cleanupGraceMs);
      cleanupTimer.unref?.();
    };
    const abort = () => stop(deadline.signal.reason || new Error("holding_worker_stopped"));
    const timer = setTimeout(() => stop(new Error("holding_worker_child_timeout")), timeout);
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(cleanupTimer);
      deadline.signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`holding_worker_child_failed:${code ?? signal}:${stderr.slice(0, 180)}`));
      else resolve(stdout);
    };
    child.stdout.on("data", data => { if (!failure) stdout += data; if (Buffer.byteLength(stdout) > maxBuffer) stop(new Error("holding_worker_child_output_limit")); });
    child.stderr.on("data", data => { if (!failure) stderr += data; if (Buffer.byteLength(stderr) > maxBuffer) stop(new Error("holding_worker_child_output_limit")); });
    child.once("error", error => {
      if (!child.pid) { failure ||= error; finish(null, "spawn_error"); }
      else stop(error);
    });
    child.once("close", finish);
    deadline.signal.addEventListener("abort", abort, { once: true });
    if (deadline.signal.aborted) abort();
  });
}
