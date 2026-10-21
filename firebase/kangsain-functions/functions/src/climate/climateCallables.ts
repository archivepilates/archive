import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import { AppError, toHttpsError } from "../utils/errors";
import { ClimateCommand, ClimateService, ClimateStore } from "./climateService";
import { ClimateError, parseThinQConfig, ThinQClient } from "./thinqClient";

export const lgThinQConnection = defineSecret("LG_THINQ_CONNECTION_JSON");
const COMMANDS = "facilityClimateCommands";
const GUARDS = "facilityClimateGuards";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
class FirestoreClimateStore implements ClimateStore {
  async throttleRead(uid: string, minimumIntervalMs = 10000) {
    if (![2000, 10000].includes(minimumIntervalMs)) throw new ClimateError("invalid_request");
    const ref = db.collection(GUARDS).doc(`read_${hash(uid)}`);
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      const now = Date.now();
      if (now - Number(previous.data()?.lastReadAt || 0) < minimumIntervalMs) throw new ClimateError("rate_limited");
      tx.set(ref, { lastReadAt: now });
    });
  }
  async getCommand(id: string) { return (await db.collection(COMMANDS).doc(id).get()).data() as ClimateCommand || null; }
  async pending(deviceId: string) {
    const guard = (await db.collection(GUARDS).doc(`device_${hash(deviceId)}`).get()).data();
    return guard?.commandId ? this.getCommand(guard.commandId) : null;
  }
  async claim(command: ClimateCommand): Promise<ClimateCommand | null> {
    const ref = db.collection(COMMANDS).doc(command.commandId);
    const guard = db.collection(GUARDS).doc(`device_${hash(command.deviceId)}`);
    return db.runTransaction(async tx => {
      const old = await tx.get(ref);
      if (old.exists) return old.data() as ClimateCommand;
      const lock = await tx.get(guard);
      if (lock.data()?.commandId) throw new ClimateError("device_busy");
      if (Date.now() - Number(lock.data()?.lastCommandAt || 0) < 5000) throw new ClimateError("rate_limited");
      tx.create(ref, command);
      tx.set(guard, { commandId: command.commandId, lastCommandAt: Date.now() });
      return null;
    });
  }
  async authorizeDispatch(command: ClimateCommand) {
    const ref = db.collection(COMMANDS).doc(command.commandId);
    const guard = db.collection(GUARDS).doc(`device_${hash(command.deviceId)}`);
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const lock = await tx.get(guard);
      const row = current.data();
      if (lock.data()?.commandId !== command.commandId || row?.fingerprint !== command.fingerprint
        || row?.status !== "pending" || row?.dispatchStartedAt
        || Date.now() - Date.parse(row.createdAt) >= 60_000) throw new ClimateError("command_expired");
      tx.update(ref, { dispatchStartedAt: new Date().toISOString() });
    });
  }
  async finish(command: ClimateCommand) {
    const ref = db.collection(COMMANDS).doc(command.commandId);
    const guard = db.collection(GUARDS).doc(`device_${hash(command.deviceId)}`);
    return db.runTransaction(async tx => {
      const lock = await tx.get(guard);
      const persisted = await tx.get(ref);
      if (!persisted.exists || persisted.data()?.fingerprint !== command.fingerprint) throw new ClimateError("command_conflict");
      // Concurrent reconciliation cannot downgrade an already resolved command.
      if (["verified", "no_change", "rejected", "acknowledged"].includes(persisted.data()?.status)) return persisted.data() as ClimateCommand;
      if (lock.data()?.commandId !== command.commandId) throw new ClimateError("command_conflict");
      tx.set(ref, command);
      if (["verified", "no_change", "rejected", "acknowledged"].includes(command.status)) tx.set(guard, { commandId: null }, { merge: true });
      return command;
    });
  }
}
let cached: { raw: string; service: ClimateService } | undefined;
function service() {
  const raw = lgThinQConnection.value();
  if (!cached || cached.raw !== raw) cached = { raw, service: new ClimateService(new ThinQClient(parseThinQConfig(raw)), new FirestoreClimateStore()) };
  return cached.service;
}
export async function climateHandler(request: CallableRequest, action: "dashboard" | "control" | "reconcile") {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    const actor = { uid: request.auth!.uid, staffId: staff.staffId };
    if (action === "dashboard") return await service().dashboard(actor, request.data);
    if (action === "control") return await service().control(actor, request.data);
    return await service().reconcile(actor, request.data);
  } catch (error) {
    if (error instanceof AppError && ["AUTH_REQUIRED", "PERMISSION_DENIED"].includes(error.code)) throw toHttpsError(error);
    // Keep provider errors out of the general error serializer, which can include raw Error.message.
    const code = error instanceof ClimateError ? error.code : "service_unavailable";
    const messages: Record<string, string> = {
      not_configured: "LG 에어컨 연결 설정이 필요합니다.", control_disabled: "에어컨 제어가 아직 활성화되지 않았습니다.",
      device_busy: "이전 제어 결과를 먼저 확인하세요.", state_changed: "기기 상태가 바뀌었습니다. 새로고침 후 다시 확인하세요.",
      rate_limited: "잠시 후 다시 조회하세요.", authorization_failed: "LG 연결 권한을 확인해 주세요.",
      device_not_allowed: "허용된 센터 에어컨이 아닙니다.", invalid_request: "제어 요청을 확인해 주세요.",
      command_conflict: "기존 요청과 일치하지 않습니다. 상태를 다시 확인하세요.",
    };
    throw new HttpsError(code === "invalid_request" ? "invalid-argument" : code === "rate_limited" ? "resource-exhausted" : "failed-precondition",
      messages[code] || "에어컨 연결 상태를 확인하지 못했습니다. 재전송하지 말고 상태를 다시 확인하세요.", { code });
  }
}
