import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { requireManager, requireStaff } from "../security/authGuards";
import { AppError } from "../utils/errors";

const COLLECTION = "studiomateReferralRequests";
const STUDIO = "5330";
const normalizePhone = (value: unknown) => typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function normalizeReferralInput(data: Record<string, unknown>) {
  const keys = ["newMemberName", "newMemberPhone", "referrerName", "referrerPhone"] as const;
  if (!data || Object.keys(data).some(key => !keys.includes(key as typeof keys[number])))
    throw new AppError("INVALID_ARGUMENT", "추천인 이름과 연락처만 입력해 주세요.");
  const result = {
    newMemberName: typeof data.newMemberName === "string" ? data.newMemberName.trim() : "",
    newMemberPhone: normalizePhone(data.newMemberPhone),
    referrerName: typeof data.referrerName === "string" ? data.referrerName.trim() : "",
    referrerPhone: normalizePhone(data.referrerPhone),
  };
  if (![result.newMemberName, result.referrerName].every(name => name.length > 0 && name.length <= 60 && !/[\r\n<>]/.test(name)) ||
      ![result.newMemberPhone, result.referrerPhone].every(phone => /^010\d{8}$/.test(phone)) ||
      result.newMemberPhone === result.referrerPhone)
    throw new AppError("INVALID_ARGUMENT", "이름과 전체 연락처를 확인해 주세요. 자기추천은 등록할 수 없습니다.");
  return result;
}

async function operator(request: CallableRequest) {
  const staff = await requireStaff(request);
  requireManager(staff);
  if (staff.studioId !== STUDIO) throw new AppError("PERMISSION_DENIED", "명지점 운영자 계정이 필요합니다.");
  return staff;
}

export async function operatorCaptureStudioMateReferralHandler(request: CallableRequest) {
  const staff = await operator(request);
  const input = normalizeReferralInput(request.data);
  // Receipt is not native identity verification, a point claim, or an award.
  const id = hash(["studiomate-referral-intake", STUDIO, input.newMemberPhone]);
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async transaction => {
    const prior = await transaction.get(ref);
    if (prior.exists) {
      const saved = prior.data()!;
      if (saved.inputHash !== hash(input))
        throw new AppError("INVALID_ARGUMENT", "기존 추천정보가 다릅니다. 원본 확인 후 운영자 검토가 필요합니다.");
      return { requestId: id, status: saved.status, duplicate: true };
    }
    transaction.create(ref, {
      ...input, inputHash: hash(input), studioId: STUDIO, source: "core_operator_referral_intake",
      capturedBy: staff.staffId, capturedAt: Timestamp.now(), updatedAt: Timestamp.now(),
      status: "verification_required", rewardPoints: 20_000, reason: "native_source_verification_required",
    });
    return { requestId: id, status: "verification_required", duplicate: false };
  });
}

export async function getStudioMateReferralDashboardHandler(request: CallableRequest) {
  await operator(request);
  const [settings, snapshot] = await Promise.all([
    db.doc("systemSettings/studiomateReferralAutomation").get(),
    db.collection(COLLECTION).orderBy("updatedAt", "desc").limit(51).get(),
  ]);
  const config = settings.data();
  return { enabled: config?.enabled === true, policyConfirmed: config?.purchaseThresholdConfirmed === true,
    complete: snapshot.size <= 50,
    requests: snapshot.docs.slice(0, 50).filter(document => document.data().studioId === STUDIO).map(document => {
      const data = document.data();
      return { id: document.id, newMemberName: data.newMemberName, referrerName: data.referrerName,
        newMemberPhoneLast4: String(data.newMemberPhone || "").slice(-4),
        referrerPhoneLast4: String(data.referrerPhone || "").slice(-4), status: data.status,
        reason: data.reason, updatedAt: data.updatedAt?.toDate?.().toISOString() || null };
    }),
  };
}
