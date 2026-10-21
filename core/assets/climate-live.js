// Signals are invalidations only. The sole effect is a bounded, canonical read.
export function startClimateLive({ win, doc, parentDoc, runtime, active, knownIds, blocked, read }) {
  let disposed = false, visible = false, entered = false, running = false, timer, unsubscribe;
  let baseline = true, revisions = new Map(), receiver = null;
  let lastAny = -Infinity, lastFull = -Infinity, pollAt = Infinity;
  let signalAt = Infinity, fullRequested = false, retryAt = 0, failures = 0;
  const pending = new Set();
  const now = () => win.Date.now();
  const foreground = () => !disposed && active() && doc.visibilityState !== "hidden"
    && (!parentDoc || parentDoc.visibilityState !== "hidden");
  const interval = () => receiver?.connected === true && typeof receiver.updatedAt === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(receiver.updatedAt)
    && now() - Date.parse(receiver.updatedAt) >= 0 && now() - Date.parse(receiver.updatedAt) < 180000 ? 60000 : 15000;
  const cancelTimer = () => { win.clearTimeout(timer); timer = undefined; };
  function disconnect() { unsubscribe?.(); unsubscribe = undefined; baseline = true; revisions.clear(); receiver = null; }
  function signals(snapshot) {
    if (!foreground()) return;
    const before = interval();
    const docs = Array.isArray(snapshot.docs) ? snapshot.docs : [];
    receiver = docs.find(item => item.id === "__receiver__")?.data() || null;
    const changes = baseline ? docs.map(item => ({ doc: item })) : snapshot.docChanges();
    const allowed = new Set(knownIds().slice(0, 8));
    for (const change of changes) {
      if (change.type === "removed") continue;
      const data = change.doc.data(), id = data?.deviceId, revision = data?.revision;
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)
        || !(typeof revision === "string" && revision.length > 0 && revision.length <= 256
          || typeof revision === "number" && Number.isFinite(revision))) continue;
      if (!baseline && !allowed.has(id)) continue;
      const changed = revisions.get(id) !== revision;
      revisions.set(id, revision);
      if (!baseline && changed && allowed.has(id)) {
        pending.add(id);
        // A fixed window coalesces bursts without starvation from a noisy device.
        if (signalAt === Infinity) signalAt = now() + 350;
      }
    }
    baseline = false;
    if (before !== interval()) pollAt = now() + interval();
    schedule();
  }
  function subscribe() {
    if (unsubscribe || !["onSnapshot", "query", "collection", "limit"].every(key => typeof runtime[key] === "function")) return;
    try {
      baseline = true;
      unsubscribe = runtime.onSnapshot(runtime.query(runtime.collection(runtime.db, "facilityClimateSignals"), runtime.limit(16)), signals, () => {
        if (!foreground()) return;
        receiver = null; pollAt = Math.min(pollAt, now() + 15000); schedule();
      });
    } catch { receiver = null; }
  }
  function schedule() {
    cancelTimer();
    if (!visible || !foreground() || running || blocked()) return;
    const full = fullRequested || pollAt <= Math.max(now(), signalAt === Infinity ? now() : signalAt);
    const due = full ? fullRequested ? now() : pollAt : Math.min(pollAt, signalAt);
    const cooldown = full ? Math.max(lastAny + 2000, lastFull + 10000) : lastAny + 2000;
    const at = Math.max(due, cooldown, retryAt);
    if (Number.isFinite(at)) timer = win.setTimeout(tick, Math.max(0, at - now()));
  }
  async function tick() {
    timer = undefined;
    if (!foreground()) { sync(); return; }
    if (running || blocked()) return;
    const full = fullRequested || now() >= pollAt;
    const ids = full ? undefined : [...pending].filter(id => knownIds().includes(id));
    if (!full && (!ids.length || now() < signalAt)) { signalAt = Infinity; schedule(); return; }
    if (now() < retryAt || now() < lastAny + 2000 || full && now() < lastFull + 10000) { schedule(); return; }
    fullRequested = false; pending.clear(); signalAt = Infinity;
    running = true;
    try {
      const success = await read(ids);
      if (success === false && !disposed) {
        if (full) fullRequested = true;
        else { ids.forEach(id => pending.add(id)); signalAt = now(); }
      }
    } finally { running = false; schedule(); }
  }
  function sync() {
    const next = foreground();
    if (visible === next) { schedule(); return; }
    visible = next; cancelTimer();
    if (!next) { disconnect(); pending.clear(); signalAt = Infinity; return; }
    if (entered) fullRequested = true;
    entered = true;
    pollAt = now() + interval(); subscribe();
    schedule();
  }
  function resume() {
    const wasVisible = visible;
    sync();
    if (foreground() && !wasVisible) { fullRequested = true; schedule(); }
  }
  function focus() { sync(); if (foreground()) { fullRequested = true; schedule(); } }
  doc.addEventListener("visibilitychange", resume);
  parentDoc?.addEventListener("visibilitychange", resume);
  win.addEventListener("focus", focus);
  sync();
  return {
    sync,
    wake: schedule,
    requestFull() { fullRequested = true; schedule(); },
    started(ids) { lastAny = now(); if (!ids) lastFull = lastAny; cancelTimer(); },
    finished(success, ids) {
      if (disposed) return;
      if (success) { failures = 0; retryAt = 0; }
      else if (success === false) { failures++; retryAt = now() + Math.min(120000, 15000 * 2 ** Math.min(failures - 1, 3)); }
      if (!ids) pollAt = now() + interval();
      schedule();
    },
    dispose() {
      disposed = true; visible = false; cancelTimer(); disconnect(); pending.clear();
      doc.removeEventListener("visibilitychange", resume);
      parentDoc?.removeEventListener("visibilitychange", resume);
      win.removeEventListener("focus", focus);
    },
  };
}
