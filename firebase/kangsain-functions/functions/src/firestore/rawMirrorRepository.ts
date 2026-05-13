import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { stableHash } from "../utils/hash";
import { nowTimestamp } from "../utils/date";

const RAW_RETENTION_DAYS = 90;
const RAW_BATCH_SIZE = 80;
const RAW_BATCH_PAUSE_MS = 200;

export type RawMirrorDataset =
  | "staffLectures"
  | "staffMemberMemos"
  | "staffMemberProfiles"
  | "managerStaffs"
  | "managerNotices"
  | "managerCounsels"
  | "managerEtcSchedules";

export async function saveRawMirrorBatch(input: {
  studioId: string;
  dataset: RawMirrorDataset;
  sourcePath: string;
  records: unknown[];
  mirrorDate: string;
  idFor?: (record: unknown, index: number) => string;
}): Promise<{ mirrored: number }> {
  if (!input.records.length) return { mirrored: 0 };

  let mirrored = 0;
  for (let index = 0; index < input.records.length; index += RAW_BATCH_SIZE) {
    const chunk = input.records.slice(index, index + RAW_BATCH_SIZE);
    const batch = db.batch();

    chunk.forEach((record, chunkIndex) => {
      const recordIndex = index + chunkIndex;
      const sourceId = sanitizeDocId(input.idFor?.(record, recordIndex) || sourceIdFromRecord(record) || String(recordIndex));
      const sourceHash = stableHash(record);
      const ref = rawMirrorItemRef(input.studioId, input.dataset, input.mirrorDate, sourceId);
      batch.set(
        ref,
        {
          studioId: input.studioId,
          dataset: input.dataset,
          sourcePath: input.sourcePath,
          sourceId,
          sourceHash,
          mirrorDate: input.mirrorDate,
          mirroredAt: nowTimestamp(),
          expireAt: Timestamp.fromMillis(Date.now() + RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000),
          payload: record,
        },
        { merge: true },
      );
    });

    await batch.commit();
    mirrored += chunk.length;
    if (index + RAW_BATCH_SIZE < input.records.length) await sleep(RAW_BATCH_PAUSE_MS);
  }

  return { mirrored };
}

function rawMirrorItemRef(studioId: string, dataset: RawMirrorDataset, mirrorDate: string, sourceId: string) {
  return db
    .collection("studiomateRaw")
    .doc(studioId)
    .collection("datasets")
    .doc(dataset)
    .collection("dates")
    .doc(mirrorDate)
    .collection("items")
    .doc(sourceId);
}

function sourceIdFromRecord(record: unknown): string {
  if (!record || typeof record !== "object") return "";
  const obj = record as Record<string, unknown>;
  const ref = obj.ref && typeof obj.ref === "object" ? (obj.ref as Record<string, unknown>) : {};
  return String(obj.id || obj.lecture_id || obj.counsel_id || obj.consultation_id || ref.id || ref.lecture_id || "");
}

function sanitizeDocId(value: string): string {
  const sanitized = value.replace(/[/.#[\]]/g, "_").trim();
  return sanitized || stableHash(value).slice(0, 24);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
