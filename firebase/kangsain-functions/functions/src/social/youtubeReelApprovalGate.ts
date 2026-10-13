import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { youtubeReelApprovalPage } from "./youtubeReelApprovalPage";

export const REEL_CHANNEL = "UCutXw1q-cPB2UbNLnnBMwpw";
export const REEL_APPROVAL_ORIGIN = "https://asia-northeast3-archive-pilates.cloudfunctions.net";
export const REEL_APPROVAL_COLLECTION = "youtubeReelApprovals";

export interface ReelApproval {
  schemaVersion: 1;
  id: string;
  videoId: string;
  channelId: string;
  title: string;
  contentHash: string;
  fileSha256: string;
  tokenHash: string;
  expiresAt: number;
  status: "pending" | "approved" | "published" | "cancelled" | "failed";
  approvedAt?: number;
  approvedBy?: "email-button";
  isTest: boolean;
}

export interface ReelApprovalStore {
  get(id: string): Promise<ReelApproval | undefined>;
  approve(id: string, token: string, expected: ReelApproval): Promise<ReelApproval | undefined>;
}

export function validReelApproval(doc: ReelApproval | undefined, id: string, token: string, now: number): boolean {
  if (!doc || doc.id !== id || doc.schemaVersion !== 1 || doc.channelId !== REEL_CHANNEL) return false;
  if (
    !/^[\w-]{11}$/.test(doc.videoId) ||
    !/^[a-f0-9]{64}$/.test(doc.contentHash) ||
    !/^[a-f0-9]{64}$/.test(doc.fileSha256)
  )
    return false;
  if (!/^[a-f0-9]{64}$/.test(doc.tokenHash) || !Number.isFinite(doc.expiresAt) || doc.expiresAt <= now) return false;
  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(actual, Buffer.from(doc.tokenHash, "hex"));
}

export function reelApprovalHandler(store: ReelApprovalStore, clock = Date.now) {
  return async (request: Request, response: Response): Promise<void> => {
    response.set({
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (request.method === "GET") {
      const nonce = randomBytes(18).toString("base64");
      response.set(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src https://i.ytimg.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      );
      response
        .status(200)
        .type("html")
        .send(youtubeReelApprovalPage().replace(/<script\b/g, `<script nonce="${nonce}"`));
      return;
    }
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "지원하지 않는 요청입니다." });
      return;
    }
    if (!request.is("application/json") || JSON.stringify(request.body ?? {}).length > 8192) {
      response.status(400).json({ ok: false, message: "요청 형식을 확인해 주세요." });
      return;
    }
    const { id, token, action } = request.body ?? {};
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{1,96}$/.test(id) ||
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !["inspect", "approve"].includes(action)
    ) {
      response.status(400).json({ ok: false, message: "승인 링크를 다시 확인해 주세요." });
      return;
    }
    if (action === "approve" && request.get("Origin") !== REEL_APPROVAL_ORIGIN) {
      response.status(403).json({ ok: false, message: "메일의 승인 페이지에서 진행해 주세요." });
      return;
    }
    try {
      let doc = await store.get(id);
      const now = clock();
      if (!validReelApproval(doc, id, token, now)) {
        response.status(403).json({ ok: false, message: "유효하지 않거나 만료된 승인 링크입니다." });
        return;
      }
      if (action === "approve") {
        doc = await store.approve(id, token, doc!);
        if (!doc || !validReelApproval(doc, id, token, clock()) || !["approved", "published"].includes(doc.status)) {
          response.status(409).json({ ok: false, message: "승인 요청 상태가 변경되었습니다. 다시 확인해 주세요." });
          return;
        }
      }
      response
        .status(200)
        .json({
          ok: true,
          status: doc!.status,
          title: doc!.title,
          videoId: doc!.videoId,
          expiresAt: doc!.expiresAt,
          isTest: doc!.isTest,
        });
    } catch {
      response.status(503).json({ ok: false, message: "잠시 후 다시 확인해 주세요." });
    }
  };
}
