import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { IMWEB_LANE, IMWEB_SITE, validProbeWindow } from "./imwebWebhookProtocol";
import { makeAuthorizeUrl, validateOAuthConfig, validateTokenResponse, sealTokens } from "./imwebOAuthPolicy";

const connection = defineSecret("IMWEB_APP_OAUTH_CONNECTION");
const callbackUri = "https://asia-northeast3-archive-pilates.cloudfunctions.net/imwebOAuthApi/callback";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const cookieName = "__Host-imweb-oauth-state";
const messagePage = (title: string, detail: string) => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES 사이트 연결</title><style>*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#202020;font:16px/1.7 system-ui}main{max-width:640px;margin:auto;padding:40px 20px}h1{font-size:26px;line-height:1.4}p{overflow-wrap:anywhere}</style><main><p>ARCHIVE PILATES</p><h1>${title}</h1><p>${detail}</p></main></html>`;

export const imwebOAuthApi = onRequest({ region: "asia-northeast3", invoker: "public", secrets: [connection],
  timeoutSeconds: 40, memory: "256MiB", maxInstances: 2, concurrency: 10 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  if (req.method !== "GET") { res.status(405).send("method_not_allowed"); return; }
  let config;
  try { config = validateOAuthConfig(JSON.parse(connection.value())); }
  catch { res.status(503).type("html").send(messagePage("연결 설정 확인 필요", "운영자에게 앱 연결 설정 확인을 요청해 주세요.")); return; }
  if (req.path === "/" || req.path === "/connect") {
    if (req.query.siteCode && req.query.siteCode !== IMWEB_SITE) { res.status(403).send("site_not_allowed"); return; }
    try {
      const state = randomBytes(32).toString("hex");
      const gateRef = db.doc(`${IMWEB_LANE}/private/config`);
      await db.runTransaction(async tx => {
        const gate = (await tx.get(gateRef)).data();
        if (!gate || !validProbeWindow(gate.oauthEnabledAtMs, gate.oauthEnabledUntilMs, Date.now()) ||
            !Number.isInteger(gate.oauthAttemptCount) || gate.oauthAttemptCount < 0 || gate.oauthAttemptCount >= 5)
          throw Error("operator_window_required");
        if (typeof gate.oauthCurrentAttemptHash === "string" && /^[a-f0-9]{64}$/.test(gate.oauthCurrentAttemptHash)) {
          const current = (await tx.get(db.doc(`${IMWEB_LANE}/oauthAttempts/${gate.oauthCurrentAttemptHash}`))).data();
          if (current?.status === "exchange_intent" || current?.status === "exchange_result_review_required")
            throw Error("previous_exchange_requires_review");
        }
        tx.create(db.doc(`${IMWEB_LANE}/oauthAttempts/${digest(state)}`), { status: "pending",
          siteCode: IMWEB_SITE, createdAt: Timestamp.now(), expiresAtMs: Date.now() + 600_000 });
        tx.update(gateRef, { oauthAttemptCount: gate.oauthAttemptCount + 1, oauthCurrentAttemptHash: digest(state) });
      });
      res.set("Set-Cookie", `${cookieName}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
      res.redirect(302, makeAuthorizeUrl(config.clientId, state));
    } catch { res.status(503).type("html").send(messagePage("연결 시작 실패", "새 인증을 시작하기 전에 운영자가 상태를 확인해야 합니다.")); }
    return;
  }
  if (req.path !== "/callback") { res.status(404).send("not_found"); return; }
  const state = req.query.state;
  const code = req.query.code;
  const matches = String(req.headers.cookie || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${cookieName}=`));
  const cookieState = matches.length === 1 ? matches[0].slice(cookieName.length + 1) : "";
  if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookieState) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState)) || typeof code !== "string" ||
      !code.length || code.length > 4096 || /[\s\p{Cc}]/u.test(code)) {
    res.status(400).type("html").send(messagePage("인증 요청 확인 필요", "이 브라우저에서 시작한 유효한 연결 요청인지 확인해 주세요.")); return;
  }
  res.set("Set-Cookie", `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  const ref = db.doc(`${IMWEB_LANE}/oauthAttempts/${digest(state)}`);
  let claimed = false;
  try {
    claimed = await db.runTransaction(async tx => {
      const gate = (await tx.get(db.doc(`${IMWEB_LANE}/private/config`))).data();
      const attempt = (await tx.get(ref)).data();
      if (gate?.oauthCurrentAttemptHash !== ref.id || !attempt || attempt.siteCode !== IMWEB_SITE || attempt.status !== "pending" ||
          !Number.isFinite(attempt.expiresAtMs) || attempt.expiresAtMs <= Date.now()) return false;
      tx.update(ref, { status: "exchange_intent", exchangeStartedAt: Timestamp.now() });
      return true;
    });
    if (!claimed) { res.status(409).type("html").send(messagePage("이미 처리되었거나 만료된 요청", "기존 연결 결과를 먼저 확인해 주세요. 같은 인증코드를 다시 사용하지 않습니다.")); return; }
    const tokenResponse = await fetch("https://openapi.imweb.me/oauth2/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error",
      body: new URLSearchParams({ grantType: "authorization_code", clientId: config.clientId,
        clientSecret: config.clientSecret, redirectUri: callbackUri, code }), signal: AbortSignal.timeout(20_000) });
    if (!tokenResponse.ok) throw Error("token_exchange_failed");
    const tokens = validateTokenResponse(await tokenResponse.json());
    const sealed = sealTokens(tokens, config.encryptionKey);
    await db.runTransaction(async tx => {
      const gateRef = db.doc(`${IMWEB_LANE}/private/config`);
      const gate = (await tx.get(gateRef)).data();
      const attempt = (await tx.get(ref)).data();
      if (gate?.oauthCurrentAttemptHash !== ref.id || attempt?.status !== "exchange_intent") throw Error("state_changed");
      tx.set(db.doc(`${IMWEB_LANE}/private/ownSiteTokenEnvelope`), { ...sealed,
        siteCode: IMWEB_SITE, scopes: tokens.scope, tokenReceivedAt: Timestamp.now(),
        sourceAttempt: ref.id, authority: "oauth_token_only", integrationVerified: false });
      tx.update(ref, { status: "token_received", completedAt: Timestamp.now(), scopes: tokens.scope });
      tx.update(gateRef, { oauthEnabledUntilMs: 0 });
    });
    res.status(200).type("html").send(messagePage("사이트 연결 인증 완료", "인증정보는 암호화해 보관했습니다. 앱 심사 승인·연동완료·실제 웹훅 수신은 아직 별도 확인이 필요합니다. 기존 구매와 영상 권한은 변경하지 않았습니다."));
  } catch {
    if (claimed) await ref.set({ status: "exchange_result_review_required", updatedAt: Timestamp.now() }, { merge: true }).catch(() => undefined);
    res.status(503).type("html").send(messagePage("연결 결과 확인 필요", "결과가 불명확해 자동 재시도하지 않았습니다. 운영자가 연결 상태를 확인한 뒤 새 인증을 진행해야 합니다."));
  }
});
