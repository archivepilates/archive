import { createHash, randomUUID } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { isManagerRole } from "../security/authGuards";
import { AppError } from "../utils/errors";
import { requireCoreSessionStaff } from "./coreInstructorAccess";
import { applyCleaningCatalogEdit, DEFAULT_CLEANING_CATALOG, parseCleaningCatalogEdit, parseCleaningRequest, type CleaningCatalog } from "./coreCleaningPolicy";

export async function coreCleaningChecklistHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireCoreSessionStaff(request);
  const manager = isManagerRole(staff.role);
  if (staff.studioId !== DEFAULT_STUDIO_ID || (!manager && staff.coreMustChangePassword !== false)) {
    throw new AppError("PERMISSION_DENIED", "이 지점의 청소 기록에 접근할 수 없습니다.");
  }
  const now = Date.now();
  const today = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const studio = db.collection("coreCleaningStudios").doc(staff.studioId);
  const settings = studio.collection("configuration").doc("checklist");
  const revisions = studio.collection("checklistRevisions");
  const toCatalog = (data: FirebaseFirestore.DocumentData | undefined) =>
    data ? { revision: data.revision, items: data.items } as CleaningCatalog : DEFAULT_CLEANING_CATALOG;

  if (request.data?.action === "catalog") {
    if (!manager) throw new AppError("PERMISSION_DENIED", "관리자만 청소구역을 변경할 수 있습니다.");
    const edit = parseCleaningCatalogEdit(request.data);
    const newId = "area-" + randomUUID();
    const catalog = await db.runTransaction(async tx => {
      const next = applyCleaningCatalogEdit(toCatalog((await tx.get(settings)).data()), edit, newId);
      const metadata = { updatedAt: Timestamp.fromMillis(now), updatedBy: request.auth!.uid };
      tx.set(settings, { ...next, ...metadata });
      tx.create(revisions.doc(today + "-" + String(next.revision).padStart(12, "0")), { ...next, ...metadata });
      return next;
    });
    return { ok: true, revision: catalog.revision };
  }

  const input = parseCleaningRequest(request.data, today, manager);
  const records = studio.collection("days").doc(input.date).collection("records");
  if (input.action === "read") {
    const revisionQuery = revisions.where(FieldPath.documentId(), "<=", input.date + "~")
      .orderBy(FieldPath.documentId(), "desc").limit(1);
    const [snapshot, catalogResult] = await Promise.all([
      records.orderBy("recordedAt", "desc").limit(1001).get(),
      input.date === today ? settings.get().then(s => s.data()) : revisionQuery.get().then(s => s.docs[0]?.data()),
    ]);
    if (snapshot.size > 1000) throw new AppError("FAILED_PRECONDITION", "하루 기록이 많아 관리자 확인이 필요합니다.");
    const catalog = toCatalog(catalogResult);
    return { today, date: input.date, revision: catalog.revision, items: catalog.items, records: snapshot.docs.map(doc => {
      const { itemId, itemLabel, itemHelp, actorName, recordedAt, status, note } = doc.data();
      return { id: doc.id, itemId, itemLabel, itemHelp, actorName, recordedAt: recordedAt.toMillis(), status, note };
    }) };
  }
  const uid = request.auth!.uid;
  const actorName = staff.name?.trim();
  if (!actorName) throw new AppError("FAILED_PRECONDITION", "강사 이름이 등록되어 있지 않습니다.");
  const ref = records.doc(createHash("sha256").update(uid + ":" + input.requestId).digest("hex"));
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const data = existing.data()!;
      if (data.actorUid !== uid || data.itemId !== input.itemId || data.status !== input.status || data.note !== input.note) {
        throw new AppError("INVALID_ARGUMENT", "이미 사용된 기록 요청입니다.");
      }
      return;
    }
    const catalog = toCatalog((await tx.get(settings)).data());
    const item = catalog.items.find(row => row.id === input.itemId);
    if (!item || catalog.revision !== input.revision) {
      throw new AppError("INVALID_ARGUMENT", "청소구역 목록이 바뀌었어요. 새로고침해 주세요.");
    }
    tx.create(ref, {
      itemId: item.id, itemLabel: item.label, itemHelp: item.help, status: input.status, note: input.note,
      actorUid: uid, actorName, recordedAt: Timestamp.fromMillis(now),
    });
  });
  return { ok: true, id: ref.id, date: input.date };
}
