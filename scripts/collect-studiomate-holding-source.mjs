#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHoldingReadbackSession } from "./lib/studiomate-holding-session.mjs";
import { normalizeHoldingObservation } from "./lib/studiomate-holding-source.mjs";

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const memberId = args.includes("--member-id") ? value("--member-id") : "";
const ticketName = args.includes("--ticket-name") ? value("--ticket-name") : "";
const stdoutOnly = args.includes("--stdout");
if (!/^[1-9]\d*$/.test(memberId) || !ticketName || ticketName.startsWith("--")) throw new Error("--member-id and --ticket-name required");
if (args.some(a => ["--apply", "--send", "--promote"].includes(a))) throw new Error("Collector is read-only");
const controller = new AbortController();
const session = createHoldingReadbackSession({ signal: controller.signal });
const terminate = () => { controller.abort(new Error("holding_collector_stopped")); process.exitCode = 143; };
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);
try {
  const raw = await session.readLatest({ memberId, ticketName });
  const normalized = normalizeHoldingObservation(raw);
  if (stdoutOnly) {
    console.log(JSON.stringify({ ok: true, mode: "read-only-memory", raw, sendAllowed: false }));
  } else {
    const dir = path.join(os.homedir(), "ArchiveIN/automation/reports/holding-source");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${memberId}-${normalized.observationFingerprint}.json`);
    await writeFile(file, JSON.stringify(raw, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ok: true, mode: "read-only", file, memberId,
      observationFingerprint: normalized.observationFingerprint, issuanceFingerprint: normalized.issuanceFingerprint,
      originalDays: normalized.originalPeriod.days, registeredHolds: normalized.activeHolds.length,
      identityStatus: "explicit_native_ticket_and_stable_hold_mapping_required", sendAllowed: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.code === "STUDIOMATE_BROWSER_BUSY" ? "studiomate_browser_busy" : error.message }));
  process.exitCode ||= 1;
} finally {
  try { await session.close(); }
  finally { process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate); }
}
