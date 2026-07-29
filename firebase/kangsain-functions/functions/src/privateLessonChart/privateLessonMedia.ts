import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { DelegatedGoogleClient } from "../google/delegatedGoogleClient";
import type {
  PrivateLessonChartMediaFile,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
} from "../types/models";
import { nowTimestamp } from "../utils/date";
import {
  currentPrivateLessonReportRevision,
  privateLessonReportMutationLockReason,
} from "./privateLessonReportRevision";
import { invalidatePendingPrivateLessonReportCandidates } from "./privateLessonReportCandidates";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const ROOT_FOLDER_NAME = "ARCHIVE PILATES 프라이빗 리포트 미디어";
const ROOT_FOLDER_ID = process.env.PRIVATE_LESSON_MEDIA_ROOT_FOLDER_ID || "";
const CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const UPLOAD_SESSION_COLLECTION = "privateLessonChartMediaUploadSessions";

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
  trashed?: boolean;
}

interface DriveFolder {
  id: string;
  name?: string;
  webViewLink?: string;
}

interface UploadSessionDoc {
  uploadId: string;
  requestId: string;
  recordId: string;
  mediaId: string;
  uploadUrl: string;
  rootFolderId: string;
  memberFolderId: string;
  sessionFolderId: string;
  sessionFolderUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  staffName: string;
  status: "pending" | "uploaded_to_drive" | "attached" | "uploaded" | "failed";
  bytesUploaded: number;
  driveFileId?: string;
  driveUrl?: string;
  uploadMode?: "drive_direct" | "function_proxy";
  lastError?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export async function initPrivateLessonMediaUpload(input: {
  chartRequest: PrivateLessonChartRequestDoc;
  record: PrivateLessonChartRecordDoc;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<{
  uploadId: string;
  mediaId: string;
  chunkSize: number;
  fileName: string;
  mimeType: string;
  size: number;
  folderUrl: string;
  directUpload: {
    enabled: true;
    method: "PUT";
    uploadUrl: string;
  };
}> {
  const lockReason = privateLessonReportMutationLockReason(input.record);
  if (lockReason) throw new Error(lockReason);
  const fileName = normalizeFileName(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);
  const size = normalizeSize(input.size);
  if (!ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    throw new Error("사진 또는 영상 파일만 업로드할 수 있습니다.");
  }
  if (size <= 0 || size > MAX_UPLOAD_SIZE) {
    throw new Error("업로드 파일은 500MB 이하만 가능합니다.");
  }

  const client = new DelegatedGoogleClient([DRIVE_SCOPE]);
  const rootFolder = await ensureRootFolder(client);
  const memberFolder = await ensureDriveFolder(client, memberFolderName(input.chartRequest), rootFolder.id);
  const sessionFolder = await ensureDriveFolder(client, sessionFolderName(input.chartRequest), memberFolder.id);
  await Promise.all([
    ensureAnyoneReaderPermission(client, rootFolder.id),
    ensureAnyoneReaderPermission(client, memberFolder.id),
    ensureAnyoneReaderPermission(client, sessionFolder.id),
  ]);

  const uploadUrl = await createDriveResumableUploadSession(client, {
    fileName,
    mimeType,
    size,
    parentFolderId: sessionFolder.id,
  });
  const mediaId = `media_${randomBytes(10).toString("hex")}`;
  const uploadId = `plm_${input.chartRequest.requestId}_${mediaId}`;
  const now = nowTimestamp();
  await cancelDuplicatePendingSessions(input.chartRequest.requestId, fileName, size, uploadId);
  await uploadSessionRef(uploadId).set({
    uploadId,
    requestId: input.chartRequest.requestId,
    recordId: input.record.recordId,
    mediaId,
    uploadUrl,
    rootFolderId: rootFolder.id,
    memberFolderId: memberFolder.id,
    sessionFolderId: sessionFolder.id,
    sessionFolderUrl: folderUrl(sessionFolder.id),
    fileName,
    mimeType,
    size,
    staffName: input.chartRequest.staffName || input.record.staffName || "",
    status: "pending",
    bytesUploaded: 0,
    uploadMode: "drive_direct",
    createdAt: now,
    updatedAt: now,
  } satisfies UploadSessionDoc);

  return {
    uploadId,
    mediaId,
    chunkSize: CHUNK_SIZE,
    fileName,
    mimeType,
    size,
    folderUrl: folderUrl(sessionFolder.id),
    directUpload: {
      enabled: true,
      method: "PUT",
      uploadUrl,
    },
  };
}

export async function uploadPrivateLessonMediaChunk(input: {
  chartRequest: PrivateLessonChartRequestDoc;
  uploadId: string;
  start: number;
  end: number;
  total: number;
  chunkBase64: string;
}): Promise<{ done: boolean; bytesUploaded: number; file?: PrivateLessonChartMediaFile }> {
  const sessionSnap = await uploadSessionRef(input.uploadId).get();
  const session = sessionSnap.data() as UploadSessionDoc | undefined;
  if (!session || session.requestId !== input.chartRequest.requestId) {
    throw new Error("미디어 업로드 세션을 찾을 수 없습니다.");
  }
  await assertPrivateLessonMediaMutable(session.recordId);
  if (["uploaded_to_drive", "attached", "uploaded"].includes(session.status)) {
    const file = await resumeMediaAttachment(session);
    return { done: true, bytesUploaded: session.bytesUploaded, file };
  }
  if (session.status === "failed") {
    throw new Error(session.lastError || "이전 업로드 실패로 다시 시작이 필요합니다.");
  }
  const chunk = Buffer.from(String(input.chunkBase64 || ""), "base64");
  const start = Number(input.start);
  const end = Number(input.end);
  const total = Number(input.total);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) {
    throw new Error("업로드 청크 범위가 올바르지 않습니다.");
  }
  if (total !== session.size || start < 0 || end < start || end >= total || chunk.length !== end - start + 1) {
    throw new Error("업로드 청크 크기가 올바르지 않습니다.");
  }

  const client = new DelegatedGoogleClient([DRIVE_SCOPE]);
  const response = await client.requestRaw(session.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Type": session.mimeType,
    },
    body: chunk as unknown as BodyInit,
  });

  if (response.status === 308) {
    const range = response.headers.get("range") || "";
    const bytesUploaded = bytesUploadedFromRange(range, end + 1);
    await uploadSessionRef(session.uploadId).set(
      { bytesUploaded, updatedAt: nowTimestamp() },
      { merge: true },
    );
    return { done: false, bytesUploaded };
  }

  const text = await response.text();
  const json = text ? JSON.parse(text) as DriveFile : {} as DriveFile;
  if (!response.ok || !json.id) {
    const message = (json as any)?.error?.message || `Drive upload failed: ${response.status}`;
    await uploadSessionRef(session.uploadId).set(
      { status: "failed", lastError: message, updatedAt: nowTimestamp() },
      { merge: true },
    );
    throw new Error(message);
  }

  const file = await driveFileWithMetadata(client, json.id, session);
  await uploadSessionRef(session.uploadId).set(
    {
      status: "uploaded_to_drive",
      bytesUploaded: total,
      driveFileId: file.driveFileId,
      driveUrl: file.driveUrl,
      lastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  await ensureAnyoneReaderPermission(client, file.driveFileId);
  await finalizeMediaAttachment(session, file);
  return { done: true, bytesUploaded: total, file };
}

export async function completePrivateLessonMediaUpload(input: {
  chartRequest: PrivateLessonChartRequestDoc;
  uploadId: string;
  driveFile: DriveFile;
}): Promise<{ done: true; bytesUploaded: number; file: PrivateLessonChartMediaFile }> {
  const sessionSnap = await uploadSessionRef(input.uploadId).get();
  const session = sessionSnap.data() as UploadSessionDoc | undefined;
  if (!session || session.requestId !== input.chartRequest.requestId) {
    throw new Error("미디어 업로드 세션을 찾을 수 없습니다.");
  }
  if (["attached", "uploaded"].includes(session.status)) {
    const existing = await mediaFileFromSession(session);
    if (!existing) throw new Error("업로드 완료 파일 기록을 찾을 수 없습니다.");
    return { done: true, bytesUploaded: session.bytesUploaded, file: existing };
  }
  await assertPrivateLessonMediaMutable(session.recordId);
  if (session.status === "uploaded_to_drive") {
    const existing = await resumeMediaAttachment(session);
    return { done: true, bytesUploaded: session.bytesUploaded, file: existing };
  }
  if (session.status === "failed") {
    throw new Error(session.lastError || "이전 업로드 실패로 다시 시작이 필요합니다.");
  }
  const driveFileId = String(input.driveFile?.id || "");
  if (!driveFileId) throw new Error("Drive 업로드 완료 파일 ID를 받지 못했습니다.");

  const client = new DelegatedGoogleClient([DRIVE_SCOPE]);
  const file = await driveFileWithMetadata(client, driveFileId, session);
  await uploadSessionRef(session.uploadId).set(
    {
      status: "uploaded_to_drive",
      bytesUploaded: file.size || session.size,
      driveFileId: file.driveFileId,
      driveUrl: file.driveUrl,
      uploadMode: "drive_direct",
      lastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  await ensureAnyoneReaderPermission(client, file.driveFileId);
  await finalizeMediaAttachment(session, file);
  return { done: true, bytesUploaded: file.size || session.size, file };
}

function uploadSessionRef(uploadId: string) {
  return db.collection(UPLOAD_SESSION_COLLECTION).doc(uploadId);
}

async function cancelDuplicatePendingSessions(
  requestId: string,
  fileName: string,
  size: number,
  nextUploadId: string,
): Promise<void> {
  const snap = await db.collection(UPLOAD_SESSION_COLLECTION).where("requestId", "==", requestId).get();
  const batch = db.batch();
  let changed = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as UploadSessionDoc;
    if (
      data.uploadId !== nextUploadId &&
      data.status === "pending" &&
      data.fileName === fileName &&
      Number(data.size || 0) === size
    ) {
      batch.set(
        doc.ref,
        {
          status: "failed",
          lastError: "새 업로드가 시작되어 이전 미완료 세션을 중단했습니다.",
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      changed += 1;
    }
  }
  if (changed) await batch.commit();
}

async function ensureRootFolder(client: DelegatedGoogleClient): Promise<DriveFolder> {
  if (ROOT_FOLDER_ID) return { id: ROOT_FOLDER_ID, webViewLink: folderUrl(ROOT_FOLDER_ID) };
  return ensureDriveFolder(client, ROOT_FOLDER_NAME, "root");
}

async function ensureDriveFolder(client: DelegatedGoogleClient, name: string, parentId: string): Promise<DriveFolder> {
  const query = [
    `name = '${escapeDriveQuery(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${escapeDriveQuery(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  const found = await client.request<{ files?: DriveFolder[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true`,
  );
  const hit = found.files?.[0];
  if (hit?.id) return hit;
  const created = await client.request<DriveFolder>("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return created;
}

async function ensureAnyoneReaderPermission(client: DelegatedGoogleClient, fileId: string): Promise<void> {
  await client.request(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
    },
  ).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("already exists")) throw err;
  });
}

async function createDriveResumableUploadSession(
  client: DelegatedGoogleClient,
  input: { fileName: string; mimeType: string; size: number; parentFolderId: string },
): Promise<string> {
  const response = await client.requestRaw(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,iconLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.size),
      },
      body: JSON.stringify({
        name: input.fileName,
        mimeType: input.mimeType,
        parents: [input.parentFolderId],
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Drive resumable session failed: ${response.status}`);
  }
  const location = response.headers.get("location");
  if (!location) throw new Error("Drive resumable upload URL을 받지 못했습니다.");
  return location;
}

async function attachMediaFileToRecord(recordId: string, session: UploadSessionDoc, file: PrivateLessonChartMediaFile): Promise<void> {
  const recordRef = db.collection("privateLessonChartRecords").doc(recordId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(recordRef);
    const record = snap.data() as PrivateLessonChartRecordDoc | undefined;
    const lockReason = privateLessonReportMutationLockReason(record);
    if (lockReason) throw new Error(lockReason);
    const currentFiles = Array.isArray(record?.media?.files) ? record!.media!.files! : [];
    const nextFiles = currentFiles.filter((item) => item.mediaId !== file.mediaId).concat(file);
    const nextMedia = {
      ...(record?.media || {}),
      rootFolderId: session.rootFolderId,
      memberFolderId: session.memberFolderId,
      sessionFolderId: session.sessionFolderId,
      sessionFolderUrl: session.sessionFolderUrl,
      files: nextFiles,
      updatedAt: nowTimestamp(),
    };
    const reportRevision = currentPrivateLessonReportRevision({
      ...(record || {}),
      media: nextMedia,
    } as PrivateLessonChartRecordDoc);
    tx.set(recordRef, {
      media: nextMedia,
      reportRevision,
      approvedRevision: "",
      approvedReportSnapshot: null,
      publicReportApproval: {
        ...(record?.publicReportApproval || {}),
        status: "pending",
        approvedAt: null,
        candidateId: null,
        lastError: null,
      },
      updatedAt: nowTimestamp(),
    }, { merge: true });
  });
  await invalidatePendingPrivateLessonReportCandidates(
    recordId,
    "리포트 발송 전 사진·영상이 변경되어 기존 발송 후보를 보류했습니다.",
  );
}

async function assertPrivateLessonMediaMutable(recordId: string): Promise<void> {
  const record = (await db.collection("privateLessonChartRecords").doc(recordId).get()).data() as
    | PrivateLessonChartRecordDoc
    | undefined;
  const lockReason = privateLessonReportMutationLockReason(record);
  if (lockReason) throw new Error(lockReason);
}

async function driveFileWithMetadata(
  client: DelegatedGoogleClient,
  driveFileId: string,
  session: UploadSessionDoc,
): Promise<PrivateLessonChartMediaFile> {
  const file = await client.request<DriveFile>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      driveFileId,
    )}?fields=id,name,mimeType,size,parents,trashed,webViewLink,webContentLink,thumbnailLink,iconLink&supportsAllDrives=true`,
  );
  if (file.id !== driveFileId) throw new Error("Drive 업로드 완료 파일 ID가 일치하지 않습니다.");
  if (file.trashed) throw new Error("휴지통으로 이동된 파일은 첨부할 수 없습니다.");
  if (!file.parents?.includes(session.sessionFolderId)) {
    throw new Error("프라이빗 회차 폴더에 업로드된 파일만 첨부할 수 있습니다.");
  }
  if (String(file.name || "") !== session.fileName) {
    throw new Error("업로드 파일명이 요청 정보와 일치하지 않습니다.");
  }
  if (String(file.mimeType || "") !== session.mimeType) {
    throw new Error("업로드 파일 형식이 요청 정보와 일치하지 않습니다.");
  }
  if (Number(file.size || 0) !== session.size) {
    throw new Error("업로드 파일 크기가 요청 정보와 일치하지 않습니다.");
  }
  return mediaFileFromDriveFile(session, file);
}

async function resumeMediaAttachment(session: UploadSessionDoc): Promise<PrivateLessonChartMediaFile> {
  const file = await mediaFileFromSession(session);
  if (!file) throw new Error("업로드 완료 파일 기록을 찾을 수 없습니다.");
  if (session.status !== "attached" && session.status !== "uploaded") {
    const client = new DelegatedGoogleClient([DRIVE_SCOPE]);
    const verified = await driveFileWithMetadata(client, file.driveFileId, session);
    await ensureAnyoneReaderPermission(client, verified.driveFileId);
    await finalizeMediaAttachment(session, verified);
    return verified;
  }
  return file;
}

async function finalizeMediaAttachment(
  session: UploadSessionDoc,
  file: PrivateLessonChartMediaFile,
): Promise<void> {
  try {
    await attachMediaFileToRecord(session.recordId, session, file);
    await uploadSessionRef(session.uploadId).set(
      {
        status: "attached",
        bytesUploaded: file.size || session.size,
        driveFileId: file.driveFileId,
        driveUrl: file.driveUrl,
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await uploadSessionRef(session.uploadId).set(
      {
        status: "uploaded_to_drive",
        lastError: `Drive 업로드 완료 · 리포트 첨부 재시도 필요: ${message}`,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    throw err;
  }
}

async function mediaFileFromSession(session: UploadSessionDoc): Promise<PrivateLessonChartMediaFile | undefined> {
  if (!session.driveFileId || !session.driveUrl) return undefined;
  return {
    mediaId: session.mediaId,
    fileName: session.fileName,
    mimeType: session.mimeType,
    size: session.size,
    driveFileId: session.driveFileId,
    driveUrl: session.driveUrl,
    previewUrl: drivePreviewUrl(session.driveFileId),
    folderId: session.sessionFolderId,
    includeInReport: true,
    uploadedAt: session.updatedAt,
    uploadedBy: session.staffName,
    source: "private_chart_teacher_upload",
    status: "uploaded",
  };
}

function mediaFileFromDriveFile(session: UploadSessionDoc, file: DriveFile): PrivateLessonChartMediaFile {
  const driveFileId = file.id;
  return {
    mediaId: session.mediaId,
    fileName: session.fileName,
    mimeType: file.mimeType || session.mimeType,
    size: Number(file.size || session.size || 0),
    driveFileId,
    driveUrl: file.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`,
    previewUrl: drivePreviewUrl(driveFileId),
    thumbnailUrl: file.thumbnailLink,
    iconUrl: file.iconLink,
    folderId: session.sessionFolderId,
    includeInReport: true,
    uploadedAt: nowTimestamp(),
    uploadedBy: session.staffName,
    source: "private_chart_teacher_upload",
    status: "uploaded",
  };
}

function bytesUploadedFromRange(range: string, fallback: number): number {
  const match = range.match(/bytes=0-(\d+)/i);
  if (!match) return fallback;
  return Number(match[1]) + 1;
}

function memberFolderName(chartRequest: PrivateLessonChartRequestDoc): string {
  return `${safeDriveName(chartRequest.memberName || "회원")}_${maskPhone(chartRequest.memberPhone || chartRequest.memberPhoneLast4 || "")}`;
}

function sessionFolderName(chartRequest: PrivateLessonChartRequestDoc): string {
  const date = chartRequest.lessonDate || "날짜미정";
  const hour = lessonHourText(chartRequest);
  return `${date}_${hour}_${safeDriveName(chartRequest.staffName || "담당미정")}_${Number(chartRequest.sessionNumber || 1)}회차`;
}

function lessonHourText(chartRequest: PrivateLessonChartRequestDoc): string {
  const date = chartRequest.lessonStartAt?.toDate?.();
  if (!date) return "시간미정";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(":", "시") + "분";
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "번호미정";
  return `010****${digits.slice(-4)}`;
}

function normalizeFileName(value: string): string {
  const name = safeDriveName(String(value || "lesson-media").trim()).slice(0, 160);
  if (!name) throw new Error("파일명이 올바르지 않습니다.");
  return name;
}

function normalizeMimeType(value: string): string {
  const mimeType = String(value || "application/octet-stream").trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) throw new Error("파일 형식이 올바르지 않습니다.");
  return mimeType;
}

function normalizeSize(value: number): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new Error("파일 크기가 올바르지 않습니다.");
  return size;
}

function safeDriveName(value: string): string {
  return String(value || "")
    .replace(/[\\/:*?"<>|#%{}~&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeDriveQuery(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}
