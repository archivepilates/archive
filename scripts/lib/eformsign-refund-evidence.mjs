import { extractEformsignDocumentId, isUnambiguousSendSuccess } from "./eformsign-refund-browser-contract.mjs";

export async function waitForRefundTemplateReady(page, { timeout = 20000 } = {}) {
  const button = page.getByRole("button", { name: /^(입력 시작|Fill in)$/ }).first();
  await button.waitFor({ state: "visible", timeout });
  return button;
}

export async function readRefundSendEvidence(page, documentName, recipientPhone) {
  const url = page.url();
  const empty = () => ({ bodyText: "", documentId: "", url, evidenceScope: "" });
  if (typeof documentName !== "string" || !documentName.trim()) return empty();
  const records = await page.evaluate((expectedName) => {
    const recordSelector = "tr, [role='row'], li, article, .document-item, .list-item";
    const confirmationSelector = "dialog, [role='dialog'], [role='alertdialog'], [role='alert']";
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const name = normalize(expectedName);
    const visible = (element) => {
      if (!element || !element.getClientRects().length || element.closest("nav, [role='navigation'], script, style")) return false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || current.getAttribute("aria-hidden") === "true"
          || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
          || Number(style.opacity) === 0 || style.contentVisibility === "hidden") return false;
      }
      return true;
    };
    const visibleText = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walker.nextNode()) {
        if (visible(walker.currentNode.parentElement)) parts.push(walker.currentNode.textContent);
      }
      return normalize(parts.join(" "));
    };
    const exactName = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (visible(walker.currentNode.parentElement) && normalize(walker.currentNode.textContent) === name) return true;
      }
      return [root, ...root.querySelectorAll("*")].some((element) => visible(element) && visibleText(element) === name);
    };
    const candidates = [...document.querySelectorAll(`${recordSelector}, ${confirmationSelector}`)]
      .filter((element) => element !== document.body && element !== document.documentElement && visible(element) && exactName(element));
    // Never fall back to a containing article/dialog to combine proof from sibling records.
    return candidates.filter((element) => !candidates.some((child) => child !== element && element.contains(child)))
      .map((element) => {
        const ids = [];
        const hrefs = [];
        const nodes = [element, ...element.querySelectorAll("[data-document-id], [data-doc-id], a[href]")];
        for (const node of nodes) {
          if (!visible(node)) continue;
          for (const attribute of ["data-document-id", "data-doc-id"]) {
            const value = node.getAttribute(attribute);
            if (value?.trim()) ids.push(value.trim());
          }
          if (node.matches("a[href]")) hrefs.push(node.getAttribute("href"));
        }
        return {
          bodyText: visibleText(element),
          ids,
          hrefs,
          evidenceScope: element.closest(confirmationSelector) ? "send_confirmation" : "document_record",
          size: element.querySelectorAll("*").length,
        };
      });
  }, documentName).catch(() => []);
  const accepted = [];
  for (const record of records) {
    const ids = new Set(record.ids);
    for (const href of record.hrefs) {
      try {
        const id = extractEformsignDocumentId(new URL(href, url).toString());
        if (id) ids.add(id);
      } catch {
        // A non-document link is not document proof.
      }
    }
    if (ids.size > 1 || [...ids].some((id) => !/^[A-Za-z0-9_-]{1,160}$/.test(id))) return empty();
    if (ids.size !== 1) continue;
    const evidence = { bodyText: record.bodyText, documentId: [...ids][0], url, evidenceScope: record.evidenceScope };
    if (isUnambiguousSendSuccess({ ...evidence, documentName, recipientPhone })) accepted.push({ ...evidence, size: record.size });
  }
  if (!accepted.length || new Set(accepted.map((record) => record.documentId)).size !== 1) return empty();
  const { size, ...evidence } = accepted.sort((a, b) => a.size - b.size || a.bodyText.length - b.bodyText.length)[0];
  return evidence;
}
