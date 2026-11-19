export function rewriteAutomationPaths(value, oldRoot, newRoot) {
  const escaped = oldRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootPattern = new RegExp(`${escaped}(?=/|$)`, "g");
  const visit = item => {
    if (typeof item === "string") return item.replace(rootPattern, newRoot)
      .replace(/~\/ArchiveIN(?=\/|$)/g, "~/archive-automation");
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, visit(v)]));
    return item;
  };
  return visit(value);
}
