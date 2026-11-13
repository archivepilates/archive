import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {evaluateClassCancellation, prepareClassCancellationPlan} from './class-cancellation-policy.mjs';
import {CLASS_HEADERS, parseClassTable, compareClassReadbacks} from '../studiomate-class-cancellation-guard.mjs';

const DAY = 86_400_000;
const FRESH = 300_000;
const VERSION = 'weekend_cancellation_correction_v1';
const FIELDS = ['date', 'startTime', 'staffName', 'lessonType', 'category', 'title', 'room'];
const identity = row => JSON.stringify(FIELDS.map(field => row[field]));
const deadline = row => row.cancelDeadline.replace(/ ?까지$/, '');
const dateMillis = value => {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) throw Error('invalid_date');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw Error('invalid_date');
  return ms;
};
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw Error('invalid_timestamp');
  dateMillis(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value))) throw Error('invalid_timestamp');
  return Date.parse(value);
};
const kstDate = ms => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const open = ms => {
  const hour = new Date(ms + 9 * 3_600_000).getUTCHours();
  return hour >= 9 && hour < 23;
};
const fail = reason => {throw Error(reason);};

function validateRow(row, from, through) {
  if (!row || !Array.isArray(row.nativeCells) || row.nativeCells.length !== 14
    || Array.from(row.nativeCells).some(cell => typeof cell !== 'string')) fail('invalid_native_cells');
  const parsed = parseClassTable([CLASS_HEADERS, row.nativeCells], {from, through, expectedCount: 1})[0];
  if (FIELDS.some(field => parsed[field] !== row[field]) || parsed.cancelDeadline !== row.cancelDeadline) fail('canonical_native_mismatch');
  if (Object.hasOwn(row, 'uiBookingChange')) parsed.uiBookingChange = structuredClone(row.uiBookingChange);
  return parsed;
}

function validateSnapshot(value, from, through, time) {
  const snapshot = structuredClone(value);
  if (!snapshot || snapshot.from !== from || snapshot.through !== through || !Array.isArray(snapshot.rows)
    || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0 || snapshot.total > 100_000
    || snapshot.rows.length !== snapshot.total || typeof snapshot.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.sourceHash)) fail('incomplete_source');
  const age = time - timestamp(snapshot.observedAt);
  if (age < 0 || age > FRESH) fail('stale_source');
  snapshot.rows = Array.from(snapshot.rows, row => validateRow(row, from, through));
  if (new Set(snapshot.rows.map(identity)).size !== snapshot.total) fail('duplicate_source_identity');
  return snapshot;
}

function assertSameTable(before, after) {
  const map = new Map(after.rows.map(row => [identity(row), row]));
  if (before.total !== after.total || before.rows.some(row => !isDeepStrictEqual(row.nativeCells, map.get(identity(row))?.nativeCells))) fail('concurrent_source_edit');
}

/**
 * No I/O except the injected adapter/ledger. Details/evidence are private, not log payloads.
 * now: live clock function (Date, epoch milliseconds or zoned ISO result).
 * ledger.claim must atomically persist evidence iff absent and return a boolean;
 * false loses the race. read/update must await durable completion. Records use status.
 * correctClass MUST await beforeSubmit exactly once immediately before its UI submit.
 * readClass returns the independently observed saved class, not the edited draft.
 * onlyKeys optionally scopes ledger access/writes to one key; source audit stays full-range.
 */
export async function runClassCancellationCorrection({adapter, ledger, now = () => new Date(), from, through,
  maxCorrections = 6, apply = false, onlyKeys} = {}) {
  const result = {ok: false, status: 'review', checkedCount: 0, mismatchCount: 0, correctedCount: 0,
    reviewCount: 0, deferredCount: 0, details: [], bookingRosterVerified: false};
  let lastTime = -Infinity;
  const time = () => {
    const value = now();
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : timestamp(value);
    if (!Number.isFinite(ms) || ms < lastTime) fail('invalid_or_regressing_clock');
    lastTime = ms;
    return ms;
  };
  const review = (reason, key) => {
    result.reviewCount++;
    result.details.push({status: 'review', reason, ...(key ? {key} : {})});
  };
  const defer = (reason, key) => {
    result.deferredCount++;
    result.details.push({status: 'deferred', reason, key});
  };
  const finish = () => {
    result.status = result.reviewCount ? (result.correctedCount ? 'partial' : 'review')
      : result.deferredCount ? (result.correctedCount ? 'partial' : 'deferred') : 'success';
    result.ok = result.status === 'success';
    return result;
  };
  const safeUpdate = async (key, patch) => {
    try {await ledger.update(key, patch);} catch {review('ledger_update_failed', key);}
  };
  let original;
  let baseline;
  let snapshot;
  const corrected = [];
  const candidates = [];
  try {
    if (typeof now !== 'function' || typeof apply !== 'boolean' || !Number.isSafeInteger(maxCorrections)
      || maxCorrections < 0 || maxCorrections > 6) fail('invalid_options');
    if (onlyKeys !== undefined && (!Array.isArray(onlyKeys) || onlyKeys.length !== 1
      || typeof onlyKeys[0] !== 'string' || !/^[a-f0-9]{64}$/.test(onlyKeys[0]))) fail('invalid_only_keys');
    const onlyKey = onlyKeys?.[0];
    if (typeof adapter?.exportClasses !== 'function' || typeof ledger?.read !== 'function'
      || apply && [adapter?.readClass, adapter?.correctClass, ledger?.claim, ledger?.update].some(fn => typeof fn !== 'function')) fail('invalid_dependencies');
    const started = time();
    const start = dateMillis(from), end = dateMillis(through);
    const today = kstDate(started);
    const d = new Date(`${today}T00:00:00Z`);
    const nextMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
    if (from !== today || through !== nextMonthEnd || end < start || (end - start) / DAY + 1 > 62) fail('invalid_horizon');
    snapshot = async () => {
      const value = await adapter.exportClasses({from, through});
      const current = time();
      if (kstDate(current) !== from) fail('horizon_day_changed');
      return validateSnapshot(value, from, through, current);
    };
    original = await snapshot();
    baseline = structuredClone(original);
    let blockingAudit = false;
    let selectedKeyFound = false;
    // Audit all source rows and in-scope claims before admitting even the first write.
    for (const row of original.rows) {
      if (![0, 6].includes(new Date(dateMillis(row.date)).getUTCDay())) continue;
      const policy = evaluateClassCancellation(row);
      if (policy.status === 'excluded') continue;
      if (policy.status !== 'enforce' || row.lessonType !== '그룹' || row.category !== '그룹') {
        blockingAudit = true;
        review(policy.reason || 'unknown_weekend_category');
        continue;
      }
      result.checkedCount++;
      const plan = prepareClassCancellationPlan([row], {operation: 'edit'});
      if (!plan.ok) fail('invalid_edit_plan');
      const key = createHash('sha256').update(JSON.stringify(['5330', VERSION, plan.version,
        ...FIELDS.map(field => row[field]), policy.expectedDeadline])).digest('hex');
      const matches = deadline(row) === policy.expectedDeadline;
      if (!matches) result.mismatchCount++;
      if (onlyKey !== undefined && key !== onlyKey) {
        result.details.push({status: 'outside_operator_scope', key, matches});
        continue;
      }
      selectedKeyFound = true;
      const existing = await ledger.read(key);
      if (existing !== null && existing !== undefined) {
        if (existing?.status !== 'verified' || !matches) review(existing?.status === 'verified' ? 'verified_policy_drift' : 'existing_claim_blocks_replay', key);
        continue;
      }
      if (matches) continue;
      candidates.push({row, policy, key, plan});
    }
    if (onlyKey !== undefined && !selectedKeyFound) {
      blockingAudit = true;
      review('operator_scope_key_not_found', onlyKey);
    }
    if (blockingAudit) return finish();
    let attempted = 0;
    for (let index = 0; index < candidates.length; index++) {
      const {row, policy, key, plan} = candidates[index];
      const current = time();
      const cutoff = timestamp(policy.expectedDeadline.replace(' ', 'T') + '+09:00');
      if (cutoff <= current) {defer('cutoff_not_future', key); continue;}
      if (!apply || !open(current) || attempted >= maxCorrections) {
        defer(!apply ? 'dry_run' : !open(current) ? 'quiet_window' : 'run_limit', key);
        continue;
      }
      let claimed = false;
      let adapterEntered = false;
      let submitStarted = false;
      let submitReady = false;
      let submitCalls = 0;
      let guardFailure = false;
      let detailBefore;
      try {
        const assertTime = () => {
          const t = time();
          if (!open(t)) fail('quiet_window');
          if (kstDate(t) !== from) fail('horizon_day_changed');
          if (cutoff <= t) fail('cutoff_not_future');
          return t;
        };
        const checkSource = async () => {
          assertTime();
          const fresh = await snapshot();
          assertSameTable(baseline, fresh);
          const detail = validateRow(await adapter.readClass(structuredClone(row)), from, through);
          if (identity(detail) !== identity(row) || !isDeepStrictEqual(detail.nativeCells, row.nativeCells)) fail('detail_source_changed');
          if (detailBefore && !isDeepStrictEqual(detail.uiBookingChange, detailBefore.uiBookingChange)) fail('booking_change_setting_changed');
          detailBefore = structuredClone(detail);
          assertTime();
          // Do not keep a proof alive through a slow detail read.
          if (time() - timestamp(fresh.observedAt) > FRESH) fail('stale_source');
          return fresh;
        };
        const fresh = await checkSource();
        const claimedAt = new Date(assertTime()).toISOString();
        const won = await ledger.claim(key, {status: 'intent', version: VERSION, studioId: '5330',
          claimedAt, from, through, sourceHash: fresh.sourceHash, observedAt: fresh.observedAt,
          row: structuredClone(row), policy: structuredClone(policy)});
        if (won !== true) fail('claim_not_acquired');
        claimed = true;
        attempted++;
        assertTime();
        adapterEntered = true;
        const outcome = await adapter.correctClass(structuredClone(row), structuredClone(policy), {
          beforeSubmit: async () => {
            submitCalls++;
            try {
              if (submitCalls !== 1) fail('repeated_before_submit');
              submitStarted = true;
              const proof = await checkSource();
              assertTime();
              submitReady = true;
              return {ok: true, key, expiresAt: timestamp(proof.observedAt) + FRESH};
            } catch (error) {guardFailure = true; throw error;}
          },
        });
        if (!submitStarted || !submitReady || submitCalls !== 1 || guardFailure || outcome?.accepted !== true) fail('unknown_native_outcome');
        await ledger.update(key, {status: 'submitted', submittedAt: new Date(time()).toISOString()});
        const detail = validateRow(await adapter.readClass(structuredClone(row)), from, through);
        if (!isDeepStrictEqual(detail.uiBookingChange, detailBefore.uiBookingChange)) fail('booking_change_setting_changed');
        compareClassReadbacks([row], [detail], plan);
        const after = await snapshot();
        compareClassReadbacks(baseline.rows, after.rows, plan);
        const cumulative = prepareClassCancellationPlan([...corrected, row], {operation: 'edit'});
        compareClassReadbacks(original.rows, after.rows, cumulative);
        await ledger.update(key, {status: 'verified', verifiedAt: new Date(time()).toISOString(),
          sourceHash: after.sourceHash, observedAt: after.observedAt, bookingRosterVerified: false});
        baseline = structuredClone(after);
        corrected.push(row);
        result.correctedCount++;
        result.details.push({status: 'verified', key});
      } catch (error) {
        // Once a native call is entered, even an exception is not evidence of non-dispatch.
        const status = adapterEntered ? 'unknown' : 'review';
        if (claimed) await safeUpdate(key, {status, reason: guardFailure ? 'before_submit_blocked' : 'correction_not_verified'});
        review(error?.message || 'correction_failed', key);
        for (const next of candidates.slice(index + 1)) defer('batch_stopped', next.key);
        break;
      }
    }
  } catch (error) {review(error?.message || 'worker_failed');}
  if (corrected.length) {
    try {
      const final = await snapshot();
      const plan = prepareClassCancellationPlan(corrected, {operation: 'edit'});
      compareClassReadbacks(original.rows, final.rows, plan);
    } catch {
      review('final_full_range_mismatch');
      // Verified claims are terminal; report later drift without rewriting history.
    }
  }
  return finish();
}
