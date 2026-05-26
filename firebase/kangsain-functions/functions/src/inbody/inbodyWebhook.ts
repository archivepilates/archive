import type { Request, Response } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { inbodyWebhookSecret } from "../config/secrets";
import { db } from "../config/firebase";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { syncInBodyMeasurementFromWebhook, type InBodyWebhookEventDoc } from "./inbodySync";

const LOOKINBODY_ACCOUNT = "arcpilates";
const SOURCE = "lookinbody";

interface LookinBodyWebhookPayload {
  EquipSerial: string;
  TelHP: string;
  UserID: string;
  TestDatetimes: string;
  Account: string;
  Equip: string;
  Type: string;
  IsTempData: string;
}

export async function receiveInBodyWebhookHandler(request: Request, response: Response): Promise<void> {
  if (request.method === "OPTIONS") {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type,X-Archive-InBody-Secret");
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ success: false, ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    assertWebhookSecret(request);
    const payload = normalizePayload(request.body);
    const eventId = eventIdFor(payload);
    const receivedAt = nowTimestamp();
    const eventRef = db.collection("inbodyWebhookEvents").doc(eventId);
    const eventDoc: InBodyWebhookEventDoc & Record<string, unknown> = {
      eventId,
      studioId: DEFAULT_STUDIO_ID,
      source: SOURCE,
      status: "received",
      account: payload.Account,
      type: payload.Type,
      equip: payload.Equip,
      equipSerial: payload.EquipSerial,
      userId: payload.UserID,
      userToken: payload.TelHP,
      userTokenLast4: payload.TelHP.slice(-4),
      testDatetimes: payload.TestDatetimes,
      testAt: parseLookinBodyTimestamp(payload.TestDatetimes),
      isTempData: payload.IsTempData.toLowerCase() === "true",
      payload,
      lookupStatus: "pending",
      processedAt: null,
      lastError: null,
      requestMeta: requestMeta(request),
      duplicateCount: 0,
      createdAt: receivedAt,
      updatedAt: receivedAt,
      lastReceivedAt: receivedAt,
    };

    let duplicate = false;
    try {
      await eventRef.create(eventDoc);
    } catch (err: any) {
      if (err?.code !== 6 && err?.code !== "already-exists") throw err;
      duplicate = true;
      await eventRef.set(
        {
          requestMeta: requestMeta(request),
          duplicateCount: FieldValue.increment(1),
          updatedAt: receivedAt,
          lastReceivedAt: receivedAt,
        },
        { merge: true },
      );
    }

    const syncResult = await syncInBodyMeasurementFromWebhook({ eventRef, eventDoc });

    logger.info("receiveInBodyWebhook stored", {
      eventId,
      duplicate,
      lookupStatus: syncResult.lookupStatus,
      measurementId: syncResult.measurementId,
      account: payload.Account,
      type: payload.Type,
      userTokenLast4: payload.TelHP.slice(-4),
      testDatetimes: payload.TestDatetimes,
    });
    response.status(200).json({
      success: true,
      ok: true,
      eventId,
      duplicate,
      lookupStatus: syncResult.lookupStatus,
      measurementId: syncResult.measurementId,
      reportId: syncResult.reportId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("receiveInBodyWebhook rejected", { message });
    response.status(400).json({ success: false, ok: false, error: message });
  }
}

function assertWebhookSecret(request: Request): void {
  const expected = configuredSecret();
  if (!expected) throw new Error("inbody webhook secret is not configured");
  const actual = String(request.get("x-archive-inbody-secret") || request.query.secret || "").trim();
  if (actual !== expected) throw new Error("invalid webhook secret");
}

function configuredSecret(): string {
  try {
    return inbodyWebhookSecret.value().trim();
  } catch {
    return "";
  }
}

function normalizePayload(input: unknown): LookinBodyWebhookPayload {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!raw || typeof raw !== "object") throw new Error("payload must be a JSON object");
  const obj = raw as Record<string, unknown>;
  const payload: LookinBodyWebhookPayload = {
    EquipSerial: requiredString(obj, "EquipSerial", 80),
    TelHP: normalizePhone(requiredString(obj, "TelHP", 20)),
    UserID: requiredString(obj, "UserID", 80),
    TestDatetimes: requiredString(obj, "TestDatetimes", 14),
    Account: requiredString(obj, "Account", 80),
    Equip: requiredString(obj, "Equip", 80),
    Type: requiredString(obj, "Type", 40),
    IsTempData: requiredString(obj, "IsTempData", 10),
  };
  if (payload.Account !== LOOKINBODY_ACCOUNT) throw new Error("unexpected account");
  if (!/^\d{14}$/.test(payload.TestDatetimes)) throw new Error("invalid TestDatetimes");
  if (!/^(true|false)$/i.test(payload.IsTempData)) throw new Error("invalid IsTempData");
  return payload;
}

function requiredString(obj: Record<string, unknown>, key: keyof LookinBodyWebhookPayload, maxLength: number): string {
  const value = obj[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${key} is required`);
  if (trimmed.length > maxLength) throw new Error(`${key} is too long`);
  return trimmed;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(digits)) throw new Error("TelHP must be a Korean phone number");
  return digits;
}

function eventIdFor(payload: LookinBodyWebhookPayload): string {
  const hash = stableHash({
    account: payload.Account,
    equipSerial: payload.EquipSerial,
    telHp: payload.TelHP,
    userId: payload.UserID,
    testDatetimes: payload.TestDatetimes,
    type: payload.Type,
  }).slice(0, 32);
  return `inbody_${hash}`;
}

function parseLookinBodyTimestamp(value: string): Timestamp | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

function requestMeta(request: Request): Record<string, string> {
  return {
    contentType: String(request.get("content-type") || ""),
    forwardedFor: String(request.get("x-forwarded-for") || ""),
    userAgent: String(request.get("user-agent") || ""),
  };
}
