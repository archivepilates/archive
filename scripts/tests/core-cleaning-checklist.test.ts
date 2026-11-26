import assert from "node:assert/strict";
import test from "node:test";
import { applyCleaningCatalogEdit, CLEANING_ITEMS, DEFAULT_CLEANING_CATALOG, parseCleaningCatalogEdit, parseCleaningRequest } from "../../firebase/kangsain-functions/functions/src/callable/coreCleaningPolicy";
import { resolveCleaningActorColor } from "../../firebase/kangsain-functions/functions/src/callable/coreCleaningActorColor";
const today = "2026-11-26";
const base = { action: "record", revision: 0, itemId: "shower-supplies", status: "done", requestId: "12345678-1234-1234-1234-123456789012" };
test("all 14 distinct items, including individual bins and shower supplies", () => {
  assert.equal(CLEANING_ITEMS.length, 14);
  assert.equal(new Set(CLEANING_ITEMS.map(([id]) => id)).size, 14);
  assert.equal(CLEANING_ITEMS.filter(([id]) => id.startsWith("trash-")).length, 7);
  assert.ok(CLEANING_ITEMS.some(([id]) => id === "shower-supplies"));
});
test("both roles write only server today; only manager reads past days", () => {
  assert.deepEqual(parseCleaningRequest({ action: "read" }, today, false), { action: "read", date: today });
  assert.equal(parseCleaningRequest({ action: "read", date: "2026-11-25" }, today, true).date, "2026-11-25");
  assert.throws(() => parseCleaningRequest({ action: "read", date: "2026-11-25" }, today, false));
  assert.equal(parseCleaningRequest(base, today, true).action, "record");
  assert.throws(() => parseCleaningRequest({ ...base, date: "2026-11-25" }, today, true), { code: "PERMISSION_DENIED" });
  assert.throws(() => parseCleaningRequest({ ...base, date: "2026-11-27" }, today, true));
  assert.equal(parseCleaningRequest(base, today, false).action, "record");
  assert.throws(() => parseCleaningRequest({ ...base, date: "2026-11-25" }, today, false));
  assert.throws(() => parseCleaningRequest({ action: "read", date: "2026-02-30" }, today, true));
  assert.throws(() => parseCleaningRequest({ action: "read", date: "2026-11-27" }, today, true));
});
test("reject arbitrary attribution, unknown items and malformed records", () => {
  for (const injection of [{ actorName: "other" }, { studioId: "other" }, { recordedAt: 0 }, { itemId: "bad/other" },
    { requestId: "invalid" }, { status: "needs-attention" }, { status: "done", note: "extra" }]) {
    assert.throws(() => parseCleaningRequest({ ...base, ...injection }, today, false));
  }
  const result = parseCleaningRequest({ ...base, status: "needs-attention", note: " 부족 " }, today, false);
  assert.equal(result.action === "record" && result.note, "부족");
});

test("area edits require current revision, preserve identity and reject duplicate labels", () => {
  const edit = (operation: string, revision: number, patch: object) => parseCleaningCatalogEdit({ action: "catalog", operation, revision, ...patch });
  const start = DEFAULT_CLEANING_CATALOG;
  const added = applyCleaningCatalogEdit(start, edit("add", 0, { label: "현관", help: "매트" }), "area-new");
  assert.equal(added.items.length, 15);
  const updated = applyCleaningCatalogEdit(added, edit("edit", 1, { itemId: "area-new", label: "입구" }), "");
  assert.equal(updated.items.find(item => item.id === "area-new")?.label, "입구");
  assert.equal(added.items.find(item => item.id === "area-new")?.label, "현관");
  assert.throws(() => applyCleaningCatalogEdit(updated, edit("delete", 1, { itemId: "area-new" }), ""), /다른 관리자/);
  assert.throws(() => applyCleaningCatalogEdit(updated, edit("add", 2, { label: " 입구 " }), "area-duplicate"), /같은 이름/);
  const deleted = applyCleaningCatalogEdit(updated, edit("delete", 2, { itemId: "area-new" }), "");
  assert.equal(deleted.items.length, 14);
  assert.ok(updated.items.some(item => item.id === "area-new"));
});


test("cleaning colors follow the saved role, verified staff IDs and safe swatches only", () => {
  const palette = new Map([["1", "#96d750"], ["2", "red; color: black"]]);
  const resolve = (staffId: string, wasManager: boolean) => resolveCleaningActorColor({ staffId, wasManager }, palette, "#323c67");
  assert.equal(resolve("1", false), "#96d750");
  assert.equal(resolve("1", true), "#323c67");
  assert.equal(resolve("unknown", true), "#323c67");
  assert.equal(resolve("unknown", false), undefined);
  assert.equal(resolve("2", false), undefined);
  assert.equal(resolveCleaningActorColor(undefined, palette, "#323c67"), undefined);
  assert.equal(resolveCleaningActorColor({ staffId: "1", wasManager: true }, palette, "invalid"), undefined);
});
