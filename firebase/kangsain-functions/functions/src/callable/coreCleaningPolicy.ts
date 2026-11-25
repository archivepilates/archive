import { AppError } from "../utils/errors";

export const CLEANING_ITEMS = [
  ["trash-desk", "데스크 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-meeting", "회의실 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-main", "메인 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-locker", "탈의실 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-chair", "체어룸 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-reformer", "리포머룸 쓰레기통", "비우고 새 봉투 끼우기"],
  ["trash-barrel", "바렐룸 쓰레기통", "비우고 새 봉투 끼우기"],
  ["coffee", "커피머신", "찌꺼기통·물받이 비우고 닦기"],
  ["sink", "세면대", "세면볼·수전 닦고 물기 제거"],
  ["locker", "탈의실", "바닥 청소하고 비품 제자리에 두기"],
  ["shower", "샤워실 청소", "바닥·배수구 머리카락 제거, 물기 정리"],
  ["shower-supplies", "샤워실 비품 보충", "샴푸·바디워시 등 확인하고 부족한 비품 채우기"],
  ["laundry", "세탁물 정리", "사용한 것과 세탁 완료된 것 구분하기"],
  ["robot", "로봇청소기 먼지통", "비우고 다시 끼우기"],
] as const;

export function parseCleaningRequest(data: unknown, today: string, manager: boolean) {
  const invalid = () => new AppError("INVALID_ARGUMENT", "청소 기록 요청을 확인해 주세요.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid();
  const value = data as Record<string, unknown>;
  const date = value.date === undefined ? today : value.date;
  if (typeof date !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || date > today) throw invalid();
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw invalid();
  if (!manager && date !== today) throw new AppError("PERMISSION_DENIED", "오늘 기록만 사용할 수 있습니다.");
  if (value.action === "read" && Object.keys(value).every(key => ["action", "date"].includes(key))) {
    return { action: "read" as const, date };
  }
  if (value.action !== "record" || !Object.keys(value).every(key => ["action", "date", "itemId", "requestId", "status", "note", "revision"].includes(key))) throw invalid();
  if (manager) throw new AppError("PERMISSION_DENIED", "완료 기록은 강사 화면에서 작성해 주세요.");
  const { itemId, requestId, status, revision } = value;
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (!validCleaningId(itemId) || !validRevision(revision) || typeof requestId !== "string"
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(requestId)
    || (status !== "done" && status !== "needs-attention") || ("note" in value && typeof value.note !== "string") || note.length > 160
    || (status === "needs-attention" && !note) || (status === "done" && note)) throw invalid();
  return { action: "record" as const, date, itemId, requestId, status, note, revision };
}

export type CleaningItem = { id: string; label: string; help: string };
export type CleaningCatalog = { revision: number; items: CleaningItem[] };
export const DEFAULT_CLEANING_CATALOG: CleaningCatalog = {
  revision: 0, items: CLEANING_ITEMS.map(([id, label, help]) => ({ id, label, help })),
};
export const validCleaningId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const validRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < 1_000_000_000_000;
export type CatalogEdit = { operation: "add" | "edit" | "delete"; revision: number; itemId: string; label: string; help: string };

export function parseCleaningCatalogEdit(data: unknown): CatalogEdit {
  const invalid = () => new AppError("INVALID_ARGUMENT", "청소구역 설정을 확인해 주세요.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid();
  const value = data as Record<string, unknown>;
  const { operation, revision } = value;
  if (value.action !== "catalog" || !validRevision(revision) || !Object.keys(value).every(
    key => ["action", "operation", "revision", "itemId", "label", "help"].includes(key)
  )) throw invalid();
  if (operation !== "add" && operation !== "edit" && operation !== "delete") throw invalid();
  if (operation === "add" ? "itemId" in value : !validCleaningId(value.itemId)) throw invalid();
  const itemId = typeof value.itemId === "string" ? value.itemId : "";
  if (operation === "delete") {
    if ("label" in value || "help" in value) throw invalid();
    return { operation, revision, itemId, label: "", help: "" };
  }
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const help = typeof value.help === "string" ? value.help.trim() : "";
  if (!label || label.length > 50 || help.length > 160 || ("help" in value && typeof value.help !== "string")) throw invalid();
  return { operation, revision, itemId, label, help };
}

export function applyCleaningCatalogEdit(catalog: CleaningCatalog, edit: CatalogEdit, newId: string): CleaningCatalog {
  if (edit.revision !== catalog.revision) throw new AppError("INVALID_ARGUMENT", "다른 관리자가 목록을 바꿨어요. 새로고침 후 다시 시도해 주세요.");
  const id = edit.operation === "add" ? newId : edit.itemId;
  const exists = catalog.items.some(item => item.id === id);
  if (edit.operation === "add" ? exists || catalog.items.length >= 60 : !exists) {
    throw new AppError("INVALID_ARGUMENT", "해당 구역 또는 최대 구역 수(60개)를 확인해 주세요.");
  }
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (edit.operation !== "delete" && catalog.items.some(item => item.id !== id && normalize(item.label) === normalize(edit.label))) {
    throw new AppError("INVALID_ARGUMENT", "같은 이름의 청소구역이 있어요.");
  }
  const item = { id, label: edit.label, help: edit.help };
  const items = edit.operation === "add" ? [...catalog.items, item] : edit.operation === "delete"
    ? catalog.items.filter(row => row.id !== id)
    : catalog.items.map(row => row.id === id ? item : row);
  return { revision: catalog.revision + 1, items };
}
