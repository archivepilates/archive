import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { fetchFullInBodyData } from "./inbodyApiClient";
import { generateInBodyReportHtml, summarizeInBodyDetail } from "./inbodyReport";

export interface InBodyWebhookEventDoc {
  eventId: string;
  studioId: string;
  source: string;
  account: string;
  type: string;
  equip: string;
  equipSerial: string;
  userId: string;
  userToken: string;
  userTokenLast4: string;
  testDatetimes: string;
  testAt: Timestamp | null;
  isTempData: boolean;
  payload: unknown;
}

export interface SyncInBodyMeasurementResult {
  lookupStatus: "synced" | "failed";
  measurementId?: string;
  reportId?: string;
  endpoint?: string;
  error?: string;
}

export async function syncInBodyMeasurementFromWebhook(args: {
  eventRef: DocumentReference;
  eventDoc: InBodyWebhookEventDoc;
}): Promise<SyncInBodyMeasurementResult> {
  const { eventRef, eventDoc } = args;
  const measurementId = measurementIdFor(eventDoc);
  const reportId = measurementId;
  const measurementRef = db.collection("inbodyMeasurements").doc(measurementId);
  const reportRef = db.collection("inbodyReports").doc(reportId);
  const now = nowTimestamp();

  const existing = await measurementRef.get();
  if (existing.exists) {
    await eventRef.set(
      {
        lookupStatus: "synced",
        processedAt: now,
        measurementId,
        reportId,
        lastError: null,
        updatedAt: now,
      },
      { merge: true },
    );
    return { lookupStatus: "synced", measurementId, reportId };
  }

  try {
    const apiResult = await fetchFullInBodyData({
      userId: eventDoc.userId,
      userToken: eventDoc.userToken,
      datetimes: eventDoc.testDatetimes,
    });
    const summary = summarizeInBodyDetail(apiResult.detail, eventDoc.testDatetimes);
    const reportHtml = generateInBodyReportHtml({
      summary,
      detail: apiResult.detail,
      generatedAtIso: new Date().toISOString(),
    });

    const batch = db.batch();
    batch.set(measurementRef, {
      measurementId,
      eventId: eventDoc.eventId,
      studioId: eventDoc.studioId,
      source: eventDoc.source,
      account: eventDoc.account,
      type: eventDoc.type,
      equip: eventDoc.equip,
      equipSerial: eventDoc.equipSerial,
      userId: eventDoc.userId,
      userTokenLast4: eventDoc.userTokenLast4,
      testDatetimes: eventDoc.testDatetimes,
      testAt: eventDoc.testAt,
      isTempData: eventDoc.isTempData,
      detailStatus: "synced",
      detailEndpoint: apiResult.endpoint,
      detailRaw: apiResult.detail,
      summary,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(reportRef, {
      reportId,
      measurementId,
      eventId: eventDoc.eventId,
      studioId: eventDoc.studioId,
      source: eventDoc.source,
      title: `${summary.name} 인바디 자동 리포트`,
      format: "html",
      version: 1,
      html: reportHtml,
      summary,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      eventRef,
      {
        lookupStatus: "synced",
        processedAt: now,
        measurementId,
        reportId,
        detailEndpoint: apiResult.endpoint,
        lastError: null,
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    logger.info("syncInBodyMeasurementFromWebhook synced", {
      eventId: eventDoc.eventId,
      measurementId,
      reportId,
      endpoint: apiResult.endpoint,
      userTokenLast4: eventDoc.userTokenLast4,
      testDatetimes: eventDoc.testDatetimes,
    });
    return { lookupStatus: "synced", measurementId, reportId, endpoint: apiResult.endpoint };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = nowTimestamp();
    await eventRef.set(
      {
        lookupStatus: "failed",
        processedAt: failedAt,
        measurementId,
        reportId,
        lastError: message.slice(0, 500),
        updatedAt: failedAt,
      },
      { merge: true },
    );
    logger.warn("syncInBodyMeasurementFromWebhook failed", {
      eventId: eventDoc.eventId,
      measurementId,
      userTokenLast4: eventDoc.userTokenLast4,
      testDatetimes: eventDoc.testDatetimes,
      message,
    });
    return { lookupStatus: "failed", measurementId, reportId, error: message };
  }
}

function measurementIdFor(eventDoc: InBodyWebhookEventDoc): string {
  const hash = stableHash({
    account: eventDoc.account,
    equipSerial: eventDoc.equipSerial,
    userId: eventDoc.userId,
    userTokenLast4: eventDoc.userTokenLast4,
    testDatetimes: eventDoc.testDatetimes,
    type: eventDoc.type,
  }).slice(0, 32);
  return `inbody_measurement_${hash}`;
}
