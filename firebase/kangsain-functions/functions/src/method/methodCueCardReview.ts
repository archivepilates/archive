import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { DelegatedGoogleClient } from "../google/delegatedGoogleClient";

const REVIEW_COLLECTION = "methodCueCardReviews";
const REVIEW_SPREADSHEET_ID =
  process.env.METHOD_CUE_CARD_REVIEW_SPREADSHEET_ID || "1gK0xBSgY6nfRd7GDY57We64NT_qwheqtkSVfuClCpI0";
const REVIEW_SHEET_NAME = process.env.METHOD_CUE_CARD_REVIEW_SHEET_NAME || "큐카드 응답";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ALLOWED_LESSON_IDS = new Set(["breathing-260627"]);

interface MethodCueCardReviewPayload {
  lessonId?: unknown;
  lessonTitle?: unknown;
  submissionId?: unknown;
  rating?: unknown;
  message?: unknown;
  pageUrl?: unknown;
  preview?: unknown;
  clientSubmittedAt?: unknown;
}

interface NormalizedMethodCueCardReview {
  lessonId: string;
  lessonTitle: string;
  submissionId: string;
  rating: number;
  message: string;
  pageUrl: string;
  preview: boolean;
  clientSubmittedAt: string;
}

export async function methodCueCardReviewHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const payload = normalizeReviewPayload(request.body || {});
    const reviewRef = db.collection(REVIEW_COLLECTION).doc(`${payload.lessonId}_${payload.submissionId}`);
    const submittedAt = Timestamp.now();
    const userAgent = stringValue(request.get?.("user-agent"), 500);
    const doc = {
      reviewId: reviewRef.id,
      lessonId: payload.lessonId,
      lessonTitle: payload.lessonTitle,
      submissionId: payload.submissionId,
      rating: payload.rating,
      message: payload.message,
      pageUrl: payload.pageUrl,
      preview: payload.preview,
      clientSubmittedAt: payload.clientSubmittedAt,
      userAgent,
      submittedAt,
      source: "archivein_method_cue_card",
      storage: {
        firestoreCollection: REVIEW_COLLECTION,
        spreadsheetId: REVIEW_SPREADSHEET_ID,
        sheetName: REVIEW_SHEET_NAME,
        sheetSyncStatus: "pending",
      },
    };

    try {
      await reviewRef.create(doc);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      response.status(200).json({
        ok: true,
        duplicate: true,
        reviewId: reviewRef.id,
      });
      return;
    }

    let sheetSyncStatus: "synced" | "failed" = "synced";
    let sheetSyncError = "";
    try {
      await appendReviewToSheet({
        ...payload,
        reviewId: reviewRef.id,
        submittedAt: new Date().toISOString(),
        userAgent,
      });
    } catch (err) {
      sheetSyncStatus = "failed";
      sheetSyncError = err instanceof Error ? err.message : String(err);
      logger.error("method cue card review sheet append failed", {
        reviewId: reviewRef.id,
        lessonId: payload.lessonId,
        message: sheetSyncError,
      });
    }

    await reviewRef.set(
      {
        storage: {
          firestoreCollection: REVIEW_COLLECTION,
          spreadsheetId: REVIEW_SPREADSHEET_ID,
          sheetName: REVIEW_SHEET_NAME,
          sheetSyncStatus,
          sheetSyncError: sheetSyncError || null,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    response.status(200).json({
      ok: true,
      reviewId: reviewRef.id,
      storage: {
        firestoreCollection: REVIEW_COLLECTION,
        spreadsheetId: REVIEW_SPREADSHEET_ID,
        sheetName: REVIEW_SHEET_NAME,
        sheetSyncStatus,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("method cue card review rejected", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

function normalizeReviewPayload(raw: MethodCueCardReviewPayload): NormalizedMethodCueCardReview {
  const lessonId = stringValue(raw.lessonId, 80);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(lessonId)) throw new Error("invalid_lesson_id");
  if (!ALLOWED_LESSON_IDS.has(lessonId)) throw new Error("unsupported_lesson_id");

  const lessonTitle = stringValue(raw.lessonTitle, 80) || lessonId;
  const submissionId = stringValue(raw.submissionId, 80);
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(submissionId)) throw new Error("invalid_submission_id");
  const rating = Number(raw.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("invalid_rating");

  const message = stringValue(raw.message, 1000);
  if (!message) throw new Error("message_required");

  const pageUrl = stringValue(raw.pageUrl, 500);
  const clientSubmittedAt = stringValue(raw.clientSubmittedAt, 80);

  return {
    lessonId,
    lessonTitle,
    submissionId,
    rating,
    message,
    pageUrl,
    preview: raw.preview === true || raw.preview === "true",
    clientSubmittedAt,
  };
}

async function appendReviewToSheet(
  review: NormalizedMethodCueCardReview & { reviewId: string; submittedAt: string; userAgent: string },
): Promise<void> {
  const client = new DelegatedGoogleClient([SHEETS_SCOPE]);
  const range = encodeURIComponent(`'${REVIEW_SHEET_NAME}'!A:I`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    REVIEW_SPREADSHEET_ID,
  )}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  await client.request(url, {
    method: "POST",
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: [
        [
          review.submittedAt,
          review.lessonId,
          review.lessonTitle,
          review.rating,
          review.message,
          review.pageUrl,
          review.preview ? "YES" : "NO",
          review.reviewId,
          review.userAgent,
        ],
      ],
    }),
  });
}

function stringValue(value: unknown, maxLength: number): string {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = Number((error as { code?: unknown })?.code);
  return code === 6;
}

function setCors(response: any): void {
  response.set("Access-Control-Allow-Origin", "https://in.archivepilates.com");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}
