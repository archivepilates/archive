export const MEMBER_DISPATCH_WINDOW_POLICY = "member_dispatch_kst_0900_2300_v1";

/** Member-facing external actions only. Operator reports and source reads are separate. */
export function memberDispatchWindow(now: number | Date | string = Date.now()) {
  const ms = typeof now === "number" ? now : now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(ms)) return { allowed: false, reason: "invalid_member_dispatch_clock", nextAllowedAt: null, policy: MEMBER_DISPATCH_WINDOW_POLICY };
  const local = new Date(ms + 9 * 3600000);
  const hour = local.getUTCHours();
  const allowed = hour >= 9 && hour < 23;
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (hour >= 23 ? 1 : 0), 9) - 9 * 3600000;
  return { allowed, reason: allowed ? "member_dispatch_window_open" : "member_dispatch_quiet_hours", nextAllowedAt: allowed ? null : new Date(next).toISOString(), policy: MEMBER_DISPATCH_WINDOW_POLICY };
}

export class MemberDispatchDeferredError extends Error {
  readonly code = "member_dispatch_deferred";
  readonly nextAllowedAt: string | null;
  constructor(now: number | Date | string = Date.now()) {
    const window = memberDispatchWindow(now);
    super(window.reason);
    this.name = "MemberDispatchDeferredError";
    this.nextAllowedAt = window.nextAllowedAt;
  }
}

export function assertMemberDispatchAllowed(now: number | Date | string = Date.now()) {
  if (!memberDispatchWindow(now).allowed) throw new MemberDispatchDeferredError(now);
}

export function isMemberDispatchDeferred(error: unknown): error is MemberDispatchDeferredError {
  return error instanceof MemberDispatchDeferredError;
}

/** Quiet hours do not consume a pending member action's daytime freshness budget. */
export function memberDispatchActiveElapsedMs(from: number, until: number) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from || until - from > 3660 * 86400000) return Infinity;
  let elapsed = 0;
  const firstDay = Math.floor((from + 9 * 3600000) / 86400000);
  const lastDay = Math.floor((until + 9 * 3600000) / 86400000);
  for (let day = firstDay; day <= lastDay; day++) {
    const start = day * 86400000;
    const end = start + 14 * 3600000;
    elapsed += Math.max(0, Math.min(until, end) - Math.max(from, start));
  }
  return elapsed;
}
