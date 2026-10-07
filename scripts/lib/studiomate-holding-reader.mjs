import { HOLDING_SOURCE, normalizeHoldingObservation } from "./studiomate-holding-source.mjs";

// Verified rendered DOM only. No framework internals, API calls, or form changes.
export function extractHoldingHistoryDom() {
  const visible = e => e.getClientRects().length > 0;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  if (dialogs.length !== 1) throw new Error("single_ticket_dialog_required");
  const dialog = dialogs[0];
  const active = dialog.querySelector(".ticket-edit-modal__tabs .active")?.textContent?.trim();
  const tables = [...dialog.querySelectorAll("table.el-table__body")].filter(visible);
  const headers = [...dialog.querySelectorAll("table.el-table__header th")].map(e => e.textContent.trim());
  if (active !== "변경이력" || tables.length !== 1 || headers.join("|") !== "변경일시|스태프|종류|내용")
    throw new Error("ticket_history_layout_changed");
  const pagination = [...dialog.querySelectorAll(".el-pagination")].filter(visible);
  const history = [...tables[0].querySelectorAll("tbody tr")].map(row => {
    const cells = row.querySelectorAll("td");
    if (cells.length !== 4) throw new Error("history_column_mismatch");
    const changes = [...cells[3].querySelectorAll("li.content")].map(li => {
      const spans = li.querySelectorAll("span");
      if (spans.length !== 2) throw new Error("history_change_layout_changed");
      return { field: li.querySelector("label")?.textContent.trim(), before: spans[0].textContent.trim(), after: spans[1].textContent.trim() };
    });
    return { at: cells[0].innerText.trim(), staff: cells[1].innerText.trim(), type: cells[2].innerText.trim(), changes };
  });
  return { history, paginationPresent: pagination.length > 0, ticketName: dialog.querySelector("h3")?.textContent.trim() };
}

export function extractRegisteredHoldsDom() {
  const visible = e => e.getClientRects().length > 0;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  if (dialogs.length !== 1) throw new Error("single_ticket_dialog_required");
  const d = dialogs[0];
  if (d.querySelector(".ticket-edit-modal__tabs .active")?.textContent.trim() !== "정지기간정보")
    throw new Error("hold_tab_not_ready");
  const lists = [...d.querySelectorAll(".holding-detail__holding-list")].filter(visible);
  if (lists.length !== 1) throw new Error("complete_hold_list_required");
  const activeHolds = [...lists[0].children].map(li => {
    const text = li.innerText;
    const dates = text.match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./g) || [];
    if (dates.length !== 2 || !/\d+일 정지/.test(text)) throw new Error("hold_row_layout_changed");
    return { start: dates[0], end: dates[1] };
  });
  return { activeHolds, paginationPresent: [...d.querySelectorAll(".el-pagination")].some(visible) };
}

export async function readOpenHoldingTicket(page, { studioId, memberId, memberName }) {
  const memberUrl = `https://arcpilates.studiomate.kr/users/detail?id=${memberId}`;
  if (page.url() !== memberUrl) throw new Error("member_url_mismatch");
  await page.getByRole("heading", { name: `${memberName}님의 수강권`, exact: true }).waitFor({ state: "visible" });
  await page.getByRole("listitem").filter({ hasText: /^\s*변경이력\s*$/ }).click();
  await waitTab(page, "변경이력");
  const first = await page.evaluate(extractHoldingHistoryDom);
  if (first.paginationPresent) throw new Error("paginated_history_not_complete_review_required");
  await page.getByRole("listitem").filter({ hasText: /^\s*정지기간정보\s*$/ }).click();
  await waitTab(page, "정지기간정보");
  const firstHolds = await page.evaluate(extractRegisteredHoldsDom);
  if (firstHolds.paginationPresent) throw new Error("paginated_hold_list_not_complete");
  await page.getByRole("listitem").filter({ hasText: /^\s*변경이력\s*$/ }).click();
  await waitTab(page, "변경이력");
  const second = await page.evaluate(extractHoldingHistoryDom);
  await page.getByRole("listitem").filter({ hasText: /^\s*정지기간정보\s*$/ }).click();
  await waitTab(page, "정지기간정보");
  const secondHolds = await page.evaluate(extractRegisteredHoldsDom);
  if (JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(firstHolds) !== JSON.stringify(secondHolds))
    throw new Error("ticket_changed_during_observation");
  const raw = { source: HOLDING_SOURCE, studioId, memberId, memberName, memberUrl,
    ticketName: first.ticketName, history: first.history, activeHolds: firstHolds.activeHolds,
    historyComplete: true, activeHoldsComplete: true, observedAt: new Date().toISOString() };
  normalizeHoldingObservation(raw);
  return raw;
}

async function waitTab(page, name) {
  await page.waitForFunction(expected => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find(e => e.getClientRects().length);
    if (d?.querySelector(".ticket-edit-modal__tabs .active")?.textContent.trim() !== expected) return false;
    return expected === "변경이력" ? !!d.querySelector("table.el-table__body tbody tr") :
      !!d.querySelector(".holding-detail__holding-list");
  }, name, { timeout: 20000 });
}
