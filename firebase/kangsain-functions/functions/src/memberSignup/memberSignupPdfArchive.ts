import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { refs } from "../firestore/refs";
import type { MemberSignupContractDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { DelegatedGoogleClient } from "../google/delegatedGoogleClient";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const ARCHIVE_FOLDER_NAME = "ARCHIVE PILATES 회원가입서 PDF";
const ARCHIVE_FOLDER_ID = "1jpW73Io8GOkrURxoUoWZ2257mWKqEe8X";
export const MEMBER_SIGNUP_ARCHIVE_FOLDER_URL = `https://drive.google.com/drive/folders/${ARCHIVE_FOLDER_ID}`;

interface DriveFile {
  id: string;
  name?: string;
  webViewLink?: string;
}

interface PdfContext {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  width: number;
  height: number;
  margin: number;
  y: number;
}

export async function archiveMemberSignupContractPdf(
  contract: MemberSignupContractDoc,
): Promise<{ status: "saved" | "skipped"; fileId?: string; url?: string }> {
  if (contract.status !== "submitted" || !contract.signature) return { status: "skipped" };
  if (contract.driveArchive?.status === "saved" && contract.driveArchive.fileId) {
    return { status: "saved", fileId: contract.driveArchive.fileId, url: contract.driveArchive.url };
  }
  if (contract.driveArchive?.status === "processing" && recentTimestamp(contract.driveArchive.updatedAt, 2 * 60 * 1000)) {
    return { status: "skipped" };
  }

  await refs.memberSignupContract(contract.contractId).set(
    {
      driveArchive: {
        status: "processing",
        folderId: ARCHIVE_FOLDER_ID,
        folderUrl: MEMBER_SIGNUP_ARCHIVE_FOLDER_URL,
        updatedAt: nowTimestamp(),
      },
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  try {
    const pdfBytes = await createMemberSignupPdf(contract);
    const file = await uploadPdfToDrive({
      filename: pdfFilename(contract),
      pdfBytes,
    });
    await refs.memberSignupContract(contract.contractId).set(
      {
        driveArchive: {
          status: "saved",
          fileId: file.id,
          url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
          folderId: ARCHIVE_FOLDER_ID,
          folderUrl: MEMBER_SIGNUP_ARCHIVE_FOLDER_URL,
          savedAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return { status: "saved", fileId: file.id, url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await refs.memberSignupContract(contract.contractId).set(
      {
        driveArchive: {
          status: "failed",
          folderId: ARCHIVE_FOLDER_ID,
          folderUrl: MEMBER_SIGNUP_ARCHIVE_FOLDER_URL,
          lastError: message,
          updatedAt: nowTimestamp(),
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    throw err;
  }
}

async function uploadPdfToDrive(input: { filename: string; pdfBytes: Uint8Array }): Promise<DriveFile> {
  const client = new DelegatedGoogleClient([DRIVE_SCOPE]);
  const boundary = `archive-member-signup-${Date.now().toString(36)}`;
  const metadata = {
    name: input.filename,
    mimeType: "application/pdf",
    parents: [ARCHIVE_FOLDER_ID],
  };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        "Content-Type: application/pdf\r\n\r\n",
    ),
    Buffer.from(input.pdfBytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return client.request<DriveFile>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: body as unknown as BodyInit,
    },
  );
}

export async function createMemberSignupPdf(contract: MemberSignupContractDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(fontPath()), { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const ctx: PdfContext = { pdf, page, font, width: 595.28, height: 841.89, margin: 42, y: 790 };

  drawText(ctx, "ARCHIVE PILATES", 12, { color: rgb(0.71, 0.23, 0.2), bold: true });
  drawText(ctx, "회원가입서", 26, { color: rgb(0.08, 0.08, 0.08), bold: true, gap: 16 });
  drawDivider(ctx);

  drawSection(ctx, "회원 기본정보");
  drawRows(ctx, [
    ["이름", contract.member.name || contract.memberName],
    ["휴대폰", formatPhone(contract.member.phone || contract.memberPhone)],
    ["생년월일", contract.member.birthDate || "-"],
    ["성별", contract.member.gender || "-"],
    ["주소", contract.member.address || "-"],
    ["방문경로", contract.member.visitRoute || "-"],
    ["운동목적", contract.member.exercisePurpose || "-"],
    ["추천인", contract.member.recommender || "-"],
  ]);

  drawSection(ctx, "수강권 및 결제정보");
  drawRows(ctx, [
    ["수강권", contract.purchase?.ticketName || "-"],
    ["이용기간", [contract.purchase?.startDate, contract.purchase?.endDate].filter(Boolean).join(" ~ ") || "-"],
    ["결제방법", contract.purchase?.paymentMethod || "-"],
    ["결제금액", contract.purchase?.paidAmount || "-"],
    ["미수금", contract.purchase?.unpaidAmount || "0원"],
  ]);

  drawSection(ctx, "약관 및 동의");
  drawRows(ctx, [
    ["환불 및 취소 규정", yesNo(contract.agreements?.refundAndCancellation)],
    ["시설 이용 및 수강권 사용", yesNo(contract.agreements?.facilityUse)],
    ["개인정보 수집 및 이용", yesNo(contract.agreements?.privacyUse)],
    ["마케팅 정보 수신", contract.agreements?.marketingAdConsent ? "동의" : "미동의"],
    ["최종 확인 및 전자서명", yesNo(contract.agreements?.finalConfirmation)],
    ["약관 버전", contract.termsVersion || "-"],
  ]);

  drawSection(ctx, "전자서명");
  const signature = contract.signature;
  if (!signature) throw new Error("submitted member signup contract has no signature");
  drawRows(ctx, [
    ["서명자", signature.signerName],
    ["제출시각", signature.signedAtText],
    ["서명 해시", signature.signatureImageHash || "-"],
    ["접속 IP 해시", signature.ipHash || "-"],
  ]);
  await drawSignatureImage(pdf, ctx, signature.signatureImageDataUrl || "");

  drawFooter(ctx, contract.contractId);
  return pdf.save();
}

async function drawSignatureImage(pdf: PDFDocument, ctx: PdfContext, dataUrl: string): Promise<void> {
  const match = dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return;
  if (ctx.y < 130) addPage(ctx);
  const image = await pdf.embedPng(Buffer.from(match[1], "base64"));
  const maxWidth = 220;
  const maxHeight = 82;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.page.drawRectangle({
    x: ctx.margin,
    y: ctx.y - maxHeight - 12,
    width: maxWidth + 24,
    height: maxHeight + 24,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.9, 0.86, 0.8),
    borderWidth: 1,
  });
  ctx.page.drawImage(image, {
    x: ctx.margin + 12,
    y: ctx.y - 12 - height,
    width,
    height,
  });
  ctx.y -= maxHeight + 38;
}

function drawSection(ctx: PdfContext, title: string): void {
  if (ctx.y < 150) addPage(ctx);
  ctx.y -= 8;
  drawText(ctx, title, 15, { color: rgb(0.08, 0.08, 0.08), bold: true, gap: 8 });
}

function drawRows(ctx: PdfContext, rows: Array<[string, string]>): void {
  for (const [label, value] of rows) {
    if (ctx.y < 90) addPage(ctx);
    const rowY = ctx.y;
    ctx.page.drawText(label, {
      x: ctx.margin,
      y: rowY,
      size: 10,
      font: ctx.font,
      color: rgb(0.42, 0.38, 0.34),
    });
    const lines = wrapText(ctx.font, value || "-", 10.5, ctx.width - ctx.margin * 2 - 120);
    lines.forEach((line, index) => {
      ctx.page.drawText(line, {
        x: ctx.margin + 116,
        y: rowY - index * 14,
        size: 10.5,
        font: ctx.font,
        color: rgb(0.12, 0.1, 0.09),
      });
    });
    ctx.y -= Math.max(20, lines.length * 14 + 6);
  }
  ctx.y -= 4;
}

function drawText(
  ctx: PdfContext,
  text: string,
  size: number,
  options: { color?: ReturnType<typeof rgb>; bold?: boolean; gap?: number } = {},
): void {
  const lines = wrapText(ctx.font, text, size, ctx.width - ctx.margin * 2);
  lines.forEach((line) => {
    ctx.page.drawText(line, {
      x: ctx.margin,
      y: ctx.y,
      size,
      font: ctx.font,
      color: options.color || rgb(0.18, 0.16, 0.14),
    });
    ctx.y -= size + 6;
  });
  ctx.y -= options.gap || 4;
}

function drawDivider(ctx: PdfContext): void {
  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.y },
    end: { x: ctx.width - ctx.margin, y: ctx.y },
    thickness: 1,
    color: rgb(0.88, 0.84, 0.78),
  });
  ctx.y -= 22;
}

function drawFooter(ctx: PdfContext, contractId: string): void {
  ctx.page.drawText(`ARCHIVE PILATES · ${contractId}`, {
    x: ctx.margin,
    y: 28,
    size: 8,
    font: ctx.font,
    color: rgb(0.52, 0.48, 0.44),
  });
}

function addPage(ctx: PdfContext): void {
  ctx.page = ctx.pdf.addPage([ctx.width, ctx.height]);
  ctx.y = ctx.height - 54;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const source = String(text || "-").replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let current = "";
  for (const char of [...source]) {
    const next = current ? `${current}${char}` : char;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = char.trimStart();
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fontPath(): string {
  return path.resolve(__dirname, "../../src/assets/NotoSansKR.ttf");
}

function pdfFilename(contract: MemberSignupContractDoc): string {
  const date = contract.signature?.signedAt?.toDate?.()
    ? kstDate(contract.signature.signedAt.toDate())
    : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const name = safeFilename(contract.member.name || contract.memberName || "회원");
  const phone = String(contract.memberPhoneLast4 || contract.member.phone || "").replace(/\D/g, "").slice(-4);
  return `${date}_${name}_${phone}_회원가입서.pdf`;
}

function safeFilename(value: string): string {
  return String(value || "").replace(/[\\/:*?"<>|#%{}]/g, "_").replace(/\s+/g, "").slice(0, 40) || "회원";
}

function kstDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

function formatPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return value || "-";
}

function yesNo(value: unknown): string {
  return value ? "동의" : "미동의";
}

function recentTimestamp(value: unknown, maxAgeMs: number): boolean {
  const timestamp = value as { toMillis?: () => number } | undefined;
  const millis = timestamp?.toMillis?.() || 0;
  return millis > 0 && Date.now() - millis <= maxAgeMs;
}
