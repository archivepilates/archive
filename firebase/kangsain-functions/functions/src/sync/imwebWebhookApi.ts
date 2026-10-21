import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { IMWEB_EVENTS, IMWEB_LANE, hashValue, matchesDigest, probeEvidence, validProbeWindow } from "./imwebWebhookProtocol";

export const imwebWebhookApi = onRequest({ region: "asia-northeast3", invoker: "public",
  timeoutSeconds: 20, memory: "256MiB", maxInstances: 2, concurrency: 10 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  const parts = req.path.split("/").filter(Boolean);
  if (req.method === "GET" && (parts.length === 0 || parts[0] === "service")) {
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.status(200).type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES 운영 연동</title><style>*{box-sizing:border-box}body{margin:0;color:#202020;background:#fafafa;font:16px/1.7 system-ui}main{max-width:640px;margin:auto;padding:40px 20px}h1{font-size:26px}p{overflow-wrap:anywhere}strong{color:#a1282e}</style><main><p>ARCHIVE PILATES</p><h1>운영 사이트 연동</h1><p><strong>설정 및 검증 진행 중</strong></p><p>당사 소유 사이트의 회원가입·쇼핑 등급 변경을 확인하는 운영자 전용 연동입니다. 웹훅 등록·심사·사이트 동의·실제 수신 검증은 각각 별도 단계입니다.</p><p>회원 권한은 승인된 수강 이력과 현재 사이트 정보를 확인한 뒤 기존 운영 절차로 관리합니다.</p></main></html>`);
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "method_not_allowed" }); return; }
  if (!req.rawBody || req.rawBody.byteLength > 65536 || !req.is("application/json")) {
    res.status(400).json({ ok: false, error: "invalid_payload" }); return;
  }
  // The only initial route is a short-lived sample probe. Production ingestion
  // stays closed until the provider's actual authentication contract is verified.
  if (parts.length !== 3 || parts[0] !== "probe" || !Object.hasOwn(IMWEB_EVENTS, parts[2])) {
    res.status(503).json({ ok: false, error: "integration_not_active" }); return;
  }
  try {
    const config = (await db.doc(`${IMWEB_LANE}/private/config`).get()).data();
    if (!config || config.mode !== "probe" || !matchesDigest(parts[1], config.probeTokenHash) ||
        !validProbeWindow(config.probeEnabledAtMs, config.probeExpiresAtMs, Date.now())) {
      res.status(403).json({ ok: false, error: "probe_disabled" }); return;
    }
    const evidence = probeEvidence(req.headers, req.body, parts[1]);
    const fingerprint = hashValue(JSON.stringify([parts[2], evidence]));
    const ref = db.doc(`${IMWEB_LANE}/probeReceipts/${fingerprint}`);
    await db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return;
      tx.create(ref, { ...evidence, eventType: IMWEB_EVENTS[parts[2]], receivedAt: Timestamp.now(),
        authority: "sample_shape_only", grantsAllowed: false });
    });
    res.status(200).json({ ok: true, mode: "sample_shape_only" });
  } catch {
    // Exceptions must not leak header values or request bodies into logs.
    res.status(503).json({ ok: false, error: "receipt_unavailable" });
  }
});
