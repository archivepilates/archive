import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const IMWEB_OAUTH_SITE = "S20260516852c71a014d08";
export const IMWEB_OAUTH_APP = "ga202609279410fb87e608a";
export const IMWEB_OAUTH_CALLBACK = "https://asia-northeast3-archive-pilates.cloudfunctions.net/imwebOAuthApi/callback";
export const IMWEB_OAUTH_AUTHORIZE = "https://openapi.imweb.me/oauth2/authorize";
export const REQUIRED_OAUTH_SCOPES = Object.freeze([
  "site-info:write", "member-info:write", "order:read",
]);
export const ALLOWED_OAUTH_SCOPES = Object.freeze([
  ...REQUIRED_OAUTH_SCOPES, "site-info:read", "member-info:read",
]);
export const IMWEB_OAUTH_AAD = JSON.stringify([IMWEB_OAUTH_SITE, IMWEB_OAUTH_APP]);

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  scope: string[];
}

export interface SealedTokens {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;

function fail(code: string): never {
  // Input values and underlying crypto/parse errors must never escape.
  throw new Error(code);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}

function opaque(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && Buffer.byteLength(value) <= max &&
    !/[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}

function base64Bytes(value: unknown, maxBytes: number, code: string, exactBytes?: number): Buffer {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(code);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || !bytes.length || bytes.length > maxBytes ||
      (exactBytes !== undefined && bytes.length !== exactBytes)) fail(code);
  return bytes;
}

function encryptionKey(value: unknown): Buffer {
  return base64Bytes(value, 32, "invalid_encryption_key", 32);
}

export function makeAuthorizeUrl(clientId: unknown, state: unknown): string {
  if (!opaque(clientId, 1, 256)) fail("invalid_client_id");
  if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) fail("invalid_state");
  const url = new URL(IMWEB_OAUTH_AUTHORIZE);
  url.search = new URLSearchParams({
    responseType: "code", clientId, redirectUri: IMWEB_OAUTH_CALLBACK,
    scope: REQUIRED_OAUTH_SCOPES.join(" "), state, siteCode: IMWEB_OAUTH_SITE,
  }).toString();
  // The server owns random state generation, storage, expiry and one-time CSRF validation.
  return url.toString();
}

export function validateOAuthConfig(value: unknown): OAuthConfig {
  if (!exactRecord(value, ["clientId", "clientSecret", "encryptionKey"])) fail("invalid_oauth_config");
  if (!opaque(value.clientId, 1, 256)) fail("invalid_client_id");
  if (!opaque(value.clientSecret, 16, MAX_TOKEN_BYTES)) fail("invalid_client_secret");
  encryptionKey(value.encryptionKey);
  return { clientId: value.clientId, clientSecret: value.clientSecret, encryptionKey: value.encryptionKey as string };
}

function validateTokens(value: unknown): OAuthTokens {
  if (!exactRecord(value, ["accessToken", "refreshToken", "scope"])) fail("invalid_token_data");
  if (!opaque(value.accessToken, 1, MAX_TOKEN_BYTES) || !opaque(value.refreshToken, 1, MAX_TOKEN_BYTES)) {
    fail("invalid_tokens");
  }
  const scope = value.scope;
  if (!Array.isArray(scope) || scope.length < REQUIRED_OAUTH_SCOPES.length ||
      scope.length > ALLOWED_OAUTH_SCOPES.length || Reflect.ownKeys(scope).length !== scope.length + 1) {
    fail("invalid_token_scope");
  }
  for (let index = 0; index < scope.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string" || !ALLOWED_OAUTH_SCOPES.includes(descriptor.value)) {
      fail("invalid_token_scope");
    }
  }
  if (new Set(scope).size !== scope.length || !REQUIRED_OAUTH_SCOPES.every(required => scope.includes(required))) {
    fail("invalid_token_scope");
  }
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, scope: [...scope].sort() };
}

export function validateTokenResponse(value: unknown): OAuthTokens {
  if (!exactRecord(value, ["statusCode", "data"]) || value.statusCode !== 200) fail("invalid_token_response");
  return validateTokens(value.data);
}

// No I/O or logging. The only nondeterminism is the required fresh 96-bit nonce.
// Scope metadata is validated and encrypted alongside the tokens, never inferred.
export function sealTokens(value: unknown, keyBase64: unknown): SealedTokens {
  const tokens = validateTokens(value);
  const key = encryptionKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(IMWEB_OAUTH_AAD, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function openSealedTokens(value: unknown, keyBase64: unknown): OAuthTokens {
  const key = encryptionKey(keyBase64);
  try {
    if (!exactRecord(value, ["version", "algorithm", "iv", "authTag", "ciphertext"]) ||
        value.version !== 1 || value.algorithm !== "aes-256-gcm") fail("invalid_sealed_tokens");
    const iv = base64Bytes(value.iv, 12, "invalid_sealed_tokens", 12);
    const tag = base64Bytes(value.authTag, 16, "invalid_sealed_tokens", 16);
    const ciphertext = base64Bytes(value.ciphertext, MAX_CIPHERTEXT_BYTES, "invalid_sealed_tokens");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(IMWEB_OAUTH_AAD, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const json = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    return validateTokens(JSON.parse(json));
  } catch {
    fail("invalid_sealed_tokens");
  }
}
