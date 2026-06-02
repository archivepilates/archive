import { createHash } from "node:crypto";
import type { MemberSignupContractDoc } from "../types/models";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";

const TERMS_VERSION = "archive-member-signup-2026-06";
const MARKETING_AD_CONSENT_TERMS_VERSION = "archive-member-signup-2026-06";

export async function memberSignupContractHandler(request: any, response: any): Promise<void> {
  try {
    if (request.method === "GET") {
      const contract = await readAuthorizedContract(request.query?.id, request.query?.token);
      if (contract.status === "draft") {
        await refs.memberSignupContract(contract.contractId).set(
          { status: "opened", openedAt: contract.openedAt || nowTimestamp(), updatedAt: nowTimestamp() },
          { merge: true },
        );
        contract.status = "opened";
      }
      response.json({ ok: true, contract: publicContract(contract) });
      return;
    }

    if (request.method === "POST") {
      const body = request.body || {};
      const contract = await readAuthorizedContract(body.contractId || body.id, body.accessToken || body.token);
      if (contract.status === "submitted") {
        response.json({ ok: true, duplicate: true, contract: publicContract(contract) });
        return;
      }
      if (!["draft", "opened"].includes(contract.status)) {
        throw new Error("현재 제출할 수 없는 회원가입서입니다.");
      }
      const submission = normalizeSubmission(body, contract.member.name);
      const signedAt = nowTimestamp();
      const signedAtText = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
      const next: Partial<MemberSignupContractDoc> = {
        status: "submitted",
        member: {
          ...contract.member,
          birthDate: submission.birthDate,
          address: submission.address,
          visitRoute: submission.visitRoute,
          exercisePurpose: submission.exercisePurpose,
          recommender: submission.recommender,
        },
        agreements: submission.agreements,
        marketingAdConsentAt: submission.agreements.marketingAdConsent ? signedAt : null,
        marketingAdConsentSource: "memberSignup",
        marketingAdConsentTermsVersion: MARKETING_AD_CONSENT_TERMS_VERSION,
        signature: {
          signerName: submission.signerName,
          signedAtText,
          signedAt,
          userAgent: String(request.get?.("user-agent") || ""),
          ipHash: sha256(String(request.ip || request.get?.("x-forwarded-for") || "")),
          signatureImageDataUrl: submission.signatureImageDataUrl,
          signatureImageHash: sha256(submission.signatureImageDataUrl),
        },
        submittedAt: signedAt,
        updatedAt: signedAt,
      };
      await refs.memberSignupContract(contract.contractId).set(next, { merge: true });
      response.json({ ok: true, duplicate: false, submittedAtText: signedAtText });
      return;
    }

    response.set("Allow", "GET, POST").status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response.status(400).json({ ok: false, error: message });
  }
}

export async function purgeUnsignedDiscardedMemberSignupContracts(): Promise<{ scanned: number; deleted: number }> {
  const now = nowTimestamp();
  const snap = await refs.memberSignupContracts().where("purgeAfter", "<=", now).limit(100).get();
  const batch = db.batch();
  let deleted = 0;
  for (const docSnap of snap.docs) {
    const contract = docSnap.data();
    if (!["cancelled", "expired"].includes(contract.status)) continue;
    if (contract.status === "submitted" || contract.submittedAt || contract.signature) continue;
    batch.delete(docSnap.ref);
    deleted += 1;
  }
  if (deleted) await batch.commit();
  return { scanned: snap.size, deleted };
}

async function readAuthorizedContract(idInput: unknown, tokenInput: unknown): Promise<MemberSignupContractDoc> {
  const contractId = stringValue(idInput);
  const accessToken = stringValue(tokenInput);
  if (!/^msc-[a-z0-9-]{8,100}$/i.test(contractId) || !/^[a-zA-Z0-9_-]{16,160}$/.test(accessToken)) {
    throw new Error("회원가입서 링크가 올바르지 않습니다.");
  }
  const snap = await refs.memberSignupContract(contractId).get();
  const contract = snap.data();
  if (!contract || contract.accessTokenHash !== sha256(accessToken)) {
    throw new Error("회원가입서를 열 수 있는 권한이 없습니다.");
  }
  if (contract.status === "cancelled") {
    throw new Error("폐기된 회원가입서 링크입니다. 새 링크를 다시 받아주세요.");
  }
  if (contract.expiresAt?.toMillis?.() && contract.expiresAt.toMillis() < Date.now()) {
    throw new Error("회원가입서 링크가 만료되었습니다.");
  }
  return contract;
}

function normalizeSubmission(input: Record<string, unknown>, fallbackName: string) {
  const agreements = {
    refundAndCancellation: booleanValue(input.refundAndCancellation),
    facilityUse: booleanValue(input.facilityUse),
    privacyUse: booleanValue(input.privacyUse),
    marketingAdConsent: booleanValue(input.marketingAdConsent),
    finalConfirmation: booleanValue(input.finalConfirmation),
  };
  if (!agreements.refundAndCancellation) throw new Error("환불 및 취소 규정에 동의해주세요.");
  if (!agreements.facilityUse) throw new Error("시설 이용 규정에 동의해주세요.");
  if (!agreements.privacyUse) throw new Error("개인정보 이용에 동의해주세요.");
  if (!agreements.finalConfirmation) throw new Error("입력 정보 최종 확인에 동의해주세요.");
  const signerName = stringValue(input.signerName || input.signatureName || fallbackName);
  if (!signerName) throw new Error("서명자 이름을 입력해주세요.");
  const signatureImageDataUrl = stringValue(input.signatureImageDataUrl);
  if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(signatureImageDataUrl)) {
    throw new Error("직접 서명을 입력해주세요.");
  }
  if (signatureImageDataUrl.length > 250000) throw new Error("서명 이미지가 너무 큽니다. 다시 서명해 주세요.");
  return {
    birthDate: stringValue(input.birthDate).slice(0, 40),
    address: stringValue(input.address).slice(0, 240),
    visitRoute: stringValue(input.visitRoute).slice(0, 80),
    exercisePurpose: stringValue(input.exercisePurpose).slice(0, 120),
    recommender: stringValue(input.recommender).slice(0, 80),
    signerName,
    signatureImageDataUrl,
    agreements,
  };
}

function publicContract(contract: MemberSignupContractDoc) {
  return {
    contractId: contract.contractId,
    status: contract.status,
    memberName: contract.memberName,
    memberPhoneLast4: contract.memberPhoneLast4,
    member: {
      name: contract.member.name,
      phoneMasked: maskPhone(contract.member.phone),
      gender: contract.member.gender || "",
      birthDate: contract.member.birthDate || "",
      email: contract.member.email || "",
      address: contract.member.address || "",
      visitRoute: contract.member.visitRoute || "",
      exercisePurpose: contract.member.exercisePurpose || "",
      recommender: contract.member.recommender || "",
    },
    purchase: contract.purchase || {},
    termsVersion: contract.termsVersion || TERMS_VERSION,
    agreements: {
      refundAndCancellation: Boolean(contract.agreements?.refundAndCancellation),
      facilityUse: Boolean(contract.agreements?.facilityUse),
      privacyUse: Boolean(contract.agreements?.privacyUse),
      marketingAdConsent: Boolean(contract.agreements?.marketingAdConsent),
      finalConfirmation: Boolean(contract.agreements?.finalConfirmation),
    },
    marketingAdConsentAtText: contract.marketingAdConsentAt
      ? new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(contract.marketingAdConsentAt.toDate())
      : "",
    marketingAdConsentSource: contract.marketingAdConsentSource || "",
    marketingAdConsentTermsVersion: contract.marketingAdConsentTermsVersion || "",
    signature: contract.signature
      ? {
          signerName: contract.signature.signerName,
          signedAtText: contract.signature.signedAtText,
        }
      : null,
  };
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "";
  return `${digits.slice(0, 3)}-${"*".repeat(Math.max(3, digits.length - 7))}-${digits.slice(-4)}`;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "on";
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
