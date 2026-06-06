import { createHash } from "node:crypto";
import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type { MemberSignupContractDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";
import { archiveMemberSignupContractPdf } from "./memberSignupPdfArchive";

const TERMS_VERSION = "archive-member-signup-2026-05";
const MEMBER_SIGNUP_PURGE_DELAY_MS = 1000 * 60 * 60 * 24 * 30;

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
      const tokenInput = body.accessToken || body.token;
      const contract = await readAuthorizedContract(body.contractId || body.id, tokenInput);
      if (contract.status === "submitted") {
        await tryArchiveSubmittedContract(contract);
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
      const transactionResult = await db.runTransaction(async (tx) => {
        const contractRef = refs.memberSignupContract(contract.contractId);
        const snap = await tx.get(contractRef);
        const current = snap.data();
        if (!current || current.accessTokenHash !== sha256(stringValue(tokenInput))) {
          throw new Error("회원가입서를 열 수 있는 권한이 없습니다.");
        }
        if (current.expiresAt?.toMillis?.() && current.expiresAt.toMillis() < Date.now()) {
          tx.set(
            contractRef,
            {
              status: "expired",
              purgeAfter: Timestamp.fromMillis(Date.now() + MEMBER_SIGNUP_PURGE_DELAY_MS),
              updatedAt: nowTimestamp(),
            },
            { merge: true },
          );
          return { expired: true, duplicate: false, contract: null };
        }
        if (current.status === "submitted") {
          return { expired: false, duplicate: true, contract: current };
        }
        if (!["draft", "opened"].includes(current.status)) {
          throw new Error("현재 제출할 수 없는 회원가입서입니다.");
        }
        tx.set(
          contractRef,
          {
            ...next,
            member: {
              ...current.member,
              birthDate: submission.birthDate,
              address: submission.address,
              visitRoute: submission.visitRoute,
              exercisePurpose: submission.exercisePurpose,
              recommender: submission.recommender,
            },
          },
          { merge: true },
        );
        return { expired: false, duplicate: false, contract: null };
      });
      if (transactionResult.expired) {
        throw new Error("회원가입서 링크가 만료되었습니다.");
      }
      if (transactionResult.duplicate && transactionResult.contract) {
        await tryArchiveSubmittedContract(transactionResult.contract);
        response.json({ ok: true, duplicate: true, contract: publicContract(transactionResult.contract) });
        return;
      }
      const submitted = (await refs.memberSignupContract(contract.contractId).get()).data();
      const archive = submitted ? await tryArchiveSubmittedContract(submitted) : null;
      response.json({ ok: true, duplicate: false, submittedAtText: signedAtText, driveArchive: archive });
      return;
    }

    response.set("Allow", "GET, POST").status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response.status(400).json({ ok: false, error: message });
  }
}

async function tryArchiveSubmittedContract(contract: MemberSignupContractDoc): Promise<{
  status: "saved" | "skipped" | "failed";
  fileId?: string;
  url?: string;
  error?: string;
}> {
  try {
    return await archiveMemberSignupContractPdf(contract);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("member signup PDF archive failed", { contractId: contract.contractId, message });
    return { status: "failed", error: message };
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
  if (contract.expiresAt?.toMillis?.() && contract.expiresAt.toMillis() < Date.now()) {
    await markExpiredContractForPurge(contract);
    throw new Error("회원가입서 링크가 만료되었습니다.");
  }
  return contract;
}

async function markExpiredContractForPurge(contract: MemberSignupContractDoc): Promise<void> {
  if (["submitted", "cancelled", "expired"].includes(contract.status)) return;
  await refs.memberSignupContract(contract.contractId).set(
    {
      status: "expired",
      purgeAfter: Timestamp.fromMillis(Date.now() + MEMBER_SIGNUP_PURGE_DELAY_MS),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
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
