#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { readOpenHoldingTicket } from "./lib/studiomate-holding-reader.mjs";
import { normalizeHoldingObservation } from "./lib/studiomate-holding-source.mjs";

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const memberId = args.includes("--member-id") ? value("--member-id") : "";
const ticketName = args.includes("--ticket-name") ? value("--ticket-name") : "";
const stdoutOnly = args.includes("--stdout");
if (!/^[1-9]\d*$/.test(memberId) || !ticketName || ticketName.startsWith("--")) throw new Error("--member-id and --ticket-name required");
if (args.some(a => ["--apply", "--send", "--promote"].includes(a))) throw new Error("Collector is read-only");
const profile = process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || path.join(os.homedir(), "ArchiveIN/automation/browser-profile");
const release = await acquireStudioMateBrowserLock({ owner: "studiomate-holding-source", waitMs: 0 });
let context;
let page;
const terminate = async () => {
  try { if (context) await context.close(); } finally { await release(); process.exit(143); }
};
process.once("SIGTERM", terminate);
try {
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(profile, { headless: process.env.HEADLESS !== "false" });
  page = await context.newPage();
  await page.goto(`https://arcpilates.studiomate.kr/users/detail?id=${memberId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureStudioMateLoggedIn(page, { headless: process.env.HEADLESS !== "false", waitForLogin: false });
  // Require real ticket content, not the SPA's transient member skeleton.
  await page.getByRole("heading", { name: ticketName, exact: true }).waitFor({ state: "visible", timeout: 20000 });
  const headings = await page.getByRole("heading", { level: 3 }).allTextContents();
  const memberName = headings[0]?.trim();
  if (!memberName || headings.filter(h => h.trim() === ticketName).length !== 1) throw new Error("ambiguous_ticket_selection_review_required");
  const card = page.locator(".userticket-card__meta").filter({ has: page.getByRole("heading", { name: ticketName, exact: true }) });
  if (await card.count() !== 1) throw new Error("single_current_ticket_card_required");
  const clickTarget = card.locator("..").locator(".userticket-card__click-listener");
  if (await clickTarget.count() !== 1) throw new Error("single_ticket_click_target_required");
  await clickTarget.click();
  const raw = await readOpenHoldingTicket(page, { studioId: "5330", memberId, memberName });
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
  const tabs = await page?.locator(".ticket-edit-modal__tabs").evaluateAll(elements =>
    elements.map(element => element.outerHTML)).catch(() => []);
  console.error(JSON.stringify({ error: error.message, ticketTabs: tabs }));
  throw error;
} finally {
  process.removeListener("SIGTERM", terminate);
  try { if (context) await context.close(); } finally { await release(); }
}
