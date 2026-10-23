import { createStudioMateBrowserSession } from "./studiomate-browser-session.mjs";
import { ensureStudioMateLoggedIn } from "./studiomate-login.mjs";
import { readOpenHoldingTicket } from "./studiomate-holding-reader.mjs";

export async function readHoldingTicketPage(page, { memberId, ticketName }) {
  if (!/^[1-9]\d*$/.test(memberId) || typeof ticketName !== "string" || !ticketName.trim())
    throw new Error("holding_readback_scope_required");
  await page.goto(`https://arcpilates.studiomate.kr/users/detail?id=${memberId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await ensureStudioMateLoggedIn(page, { headless: process.env.HEADLESS !== "false", waitForLogin: false });
  await page.getByRole("heading", { name: ticketName, exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  const headings = await page.getByRole("heading", { level: 3 }).allTextContents();
  const memberName = headings[0]?.trim();
  if (!memberName || headings.filter(h => h.trim() === ticketName).length !== 1)
    throw new Error("ambiguous_ticket_selection_review_required");
  const card = page.locator(".userticket-card__meta").filter({ has: page.getByRole("heading", { name: ticketName, exact: true }) });
  if (await card.count() !== 1) throw new Error("single_current_ticket_card_required");
  const clickTarget = card.locator("..").locator(".userticket-card__click-listener");
  if (await clickTarget.count() !== 1) throw new Error("single_ticket_click_target_required");
  await clickTarget.click();
  const raw = await readOpenHoldingTicket(page, { studioId: "5330", memberId, memberName });
  if (raw.memberId !== memberId || raw.ticketName !== ticketName || raw.studioId !== "5330")
    throw new Error("automatic_live_readback_scope_mismatch");
  return raw;
}

export function createHoldingReadbackSession(options = {}) {
  const session = options.session || createStudioMateBrowserSession(options);
  return {
    readLatest: (target, input) => session.run(page => readHoldingTicketPage(page, target), input),
    close: () => session.close(),
  };
}
