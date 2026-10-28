import { memberDispatchWindow, MemberDispatchDeferredError } from "./member-dispatch-window.mjs";

export function contractReminderDispatchWindow(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  const window = memberDispatchWindow(ms);
  if (!window.allowed) return window;
  const local = new Date(ms + 9 * 3_600_000);
  if (local.getUTCHours() < 20) return window;
  return { ...window, allowed: false, reason: "contract_reminder_outside_send_window",
    nextAllowedAt: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1)).toISOString() };
}

export function assertContractReminderDispatchAllowed(now = Date.now()) {
  const window = contractReminderDispatchWindow(now);
  if (!window.allowed) {
    const error = new MemberDispatchDeferredError(now);
    error.message = window.reason;
    error.nextAllowedAt = window.nextAllowedAt;
    throw error;
  }
}
