import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import {
  IMWEB_OAUTH_SITE, IMWEB_OAUTH_APP, IMWEB_OAUTH_CALLBACK, IMWEB_OAUTH_AUTHORIZE,
  IMWEB_OAUTH_AAD, REQUIRED_OAUTH_SCOPES, ALLOWED_OAUTH_SCOPES,
  makeAuthorizeUrl, validateOAuthConfig, validateTokenResponse, sealTokens, openSealedTokens,
} from "../../firebase/kangsain-functions/functions/src/sync/imwebOAuthPolicy";

const KEY = Buffer.alloc(32, 17).toString("base64");
const STATE = "ab".repeat(32);
const config = () => ({ clientId: "synthetic-opaque-client", clientSecret: "synthetic-secret-not-real", encryptionKey: KEY });
const tokens = () => ({ accessToken: "synthetic-access-token-not-real", refreshToken: "synthetic-refresh-token-not-real",
  scope: [...REQUIRED_OAUTH_SCOPES] });
const response = (data: unknown = tokens()) => ({ statusCode: 200, data });
const rejects = (fn: () => unknown, code: string) => assert.throws(fn, error =>
  error instanceof Error && error.message === code && error.cause === undefined);
const flip = (value: string) => {
  const bytes = Buffer.from(value, "base64"); bytes[0] ^= 1; return bytes.toString("base64");
};

function independentlySeal(plaintext: Buffer, aad = IMWEB_OAUTH_AAD) {
  const iv = Buffer.alloc(12, 19);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

test("authorize uses the official fixed endpoint, callback, site and camelCase fields only", () => {
  const url = new URL(makeAuthorizeUrl(config().clientId, STATE));
  assert.equal(IMWEB_OAUTH_AUTHORIZE, "https://openapi.imweb.me/oauth2/authorize");
  assert.equal(IMWEB_OAUTH_CALLBACK, "https://asia-northeast3-archive-pilates.cloudfunctions.net/imwebOAuthApi/callback");
  assert.equal(IMWEB_OAUTH_SITE, "S20260516852c71a014d08");
  assert.equal(IMWEB_OAUTH_APP, "ga202609279410fb87e608a");
  assert.equal(url.origin + url.pathname, IMWEB_OAUTH_AUTHORIZE);
  assert.equal(url.hash, "");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    responseType: "code", clientId: config().clientId, redirectUri: IMWEB_OAUTH_CALLBACK,
    scope: "site-info:write member-info:write order:read", state: STATE, siteCode: IMWEB_OAUTH_SITE,
  });
});

test("authorize requests only three space-delimited scopes, not additional read entries", () => {
  const url = new URL(makeAuthorizeUrl("synthetic", STATE));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...REQUIRED_OAUTH_SCOPES]);
  assert.equal(url.searchParams.get("scope")?.includes(","), false);
  assert.equal(url.searchParams.has("clientSecret"), false);
  assert.equal(url.searchParams.has("appCode"), false);
  assert.equal(Object.isFrozen(REQUIRED_OAUTH_SCOPES), true);
  assert.equal(Object.isFrozen(ALLOWED_OAUTH_SCOPES), true);
});

test("client identifiers are opaque, not UUID-only, and query metacharacters cannot override fields", () => {
  for (const clientId of ["synthetic", "00000000-0000-4000-8000-000000000000", "x".repeat(256),
    "synthetic&siteCode=other#fragment?redirectUri=https://example.invalid"]) {
    const url = new URL(makeAuthorizeUrl(clientId, STATE));
    assert.equal(url.searchParams.get("clientId"), clientId);
    assert.equal(url.searchParams.get("siteCode"), IMWEB_OAUTH_SITE);
    assert.equal(url.searchParams.get("redirectUri"), IMWEB_OAUTH_CALLBACK);
    assert.equal([...url.searchParams].length, 6);
  }
});

test("invalid client identifiers are never coerced or trimmed", () => {
  for (const clientId of [null, undefined, 1, {}, [], "", " padded", "with space", "a\nb", "a\u0000b",
    "a\u200bb", "\ud800", "x".repeat(257)]) rejects(() => makeAuthorizeUrl(clientId, STATE), "invalid_client_id");
});

test("state must be exact 64-character hex; generation and one-time CSRF checks remain server-owned", () => {
  assert.equal(new URL(makeAuthorizeUrl("synthetic", STATE)).searchParams.get("state"), STATE);
  for (const state of [null, undefined, 1, {}, "", "a".repeat(63), "a".repeat(65), "g".repeat(64),
    "A".repeat(64), STATE + "\n", " " + STATE]) rejects(() => makeAuthorizeUrl("synthetic", state), "invalid_state");
});

test("config validation returns a copy without mutating a frozen input", () => {
  const input = Object.freeze(config());
  const output = validateOAuthConfig(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
});

test("config requires exactly the three documented fields, not aliases or parsed strings", () => {
  for (const input of [null, [], JSON.stringify(config()), {}, { ...config(), extra: true },
    { client_id: "synthetic", clientSecret: config().clientSecret, encryptionKey: KEY },
    { clientId: "synthetic", clientSecret: config().clientSecret }]) {
    rejects(() => validateOAuthConfig(input), "invalid_oauth_config");
  }
});

test("config rejects inherited, symbol and accessor properties without executing getters", () => {
  rejects(() => validateOAuthConfig(Object.create(config())), "invalid_oauth_config");
  rejects(() => validateOAuthConfig({ ...config(), [Symbol("synthetic")]: true }), "invalid_oauth_config");
  const input = { ...config() };
  Object.defineProperty(input, "clientSecret", { enumerable: true, get() { throw Error("must not execute"); } });
  rejects(() => validateOAuthConfig(input), "invalid_oauth_config");
});

test("config requires at least sixteen exact secret characters and valid client identity", () => {
  assert.equal(validateOAuthConfig({ ...config(), clientSecret: "x".repeat(16) }).clientSecret.length, 16);
  for (const clientSecret of [null, 1, {}, "", "x".repeat(15), "synthetic\nsecret-value"]) {
    rejects(() => validateOAuthConfig({ ...config(), clientSecret }), "invalid_client_secret");
  }
  rejects(() => validateOAuthConfig({ ...config(), clientId: "bad client" }), "invalid_client_id");
});

test("encryption key is canonical standard base64 encoding exactly 32 bytes", () => {
  const noncanonical = KEY.slice(0, -2) + "F=";
  for (const encryptionKey of [null, 32, Buffer.alloc(32), "", "invalid", KEY.trimEnd() + "\n", KEY.slice(0, -1),
    Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), noncanonical,
    Buffer.alloc(32, 255).toString("base64").replaceAll("/", "_")]) {
    rejects(() => validateOAuthConfig({ ...config(), encryptionKey }), "invalid_encryption_key");
  }
});

test("token response requires the exact numeric 200 statusCode/data wrapper", () => {
  for (const input of [tokens(), null, [], { statusCode: "200", data: tokens() },
    { statusCode: 201, data: tokens() }, { statusCode: 400, data: tokens() },
    { status: 200, data: tokens() }, { statusCode: 200 }, { ...response(), message: "synthetic" }]) {
    rejects(() => validateTokenResponse(input), "invalid_token_response");
  }
});

test("token fields use exact camelCase and scope array, without aliases or unknown data fields", () => {
  for (const data of [null, [], {}, { access_token: "synthetic", refresh_token: "synthetic", scope: REQUIRED_OAUTH_SCOPES },
    { ...tokens(), scopes: REQUIRED_OAUTH_SCOPES }, { ...tokens(), tokenType: "Bearer" },
    { accessToken: "synthetic", scope: REQUIRED_OAUTH_SCOPES }]) {
    rejects(() => validateTokenResponse(response(data)), "invalid_token_data");
  }
});

test("validated token scope metadata is copied, normalized and required write scopes remain mandatory", () => {
  const data = tokens();
  Object.freeze(data.scope); Object.freeze(data);
  const result = validateTokenResponse(response(data));
  assert.deepEqual(result, { ...data, scope: [...data.scope].sort() });
  assert.notEqual(result.scope, data.scope);
});

test("the two related read scopes are optional and accepted without requesting them separately", () => {
  for (const extra of [[], ["site-info:read"], ["member-info:read"], ["site-info:read", "member-info:read"]]) {
    const scope = [...REQUIRED_OAUTH_SCOPES, ...extra];
    assert.deepEqual(validateTokenResponse(response({ ...tokens(), scope })).scope, [...scope].sort());
  }
});

test("missing required writes or order read fail even if corresponding reads are present", () => {
  for (const required of REQUIRED_OAUTH_SCOPES) {
    const scope = ALLOWED_OAUTH_SCOPES.filter(value => value !== required);
    rejects(() => validateTokenResponse(response({ ...tokens(), scope })), "invalid_token_scope");
  }
});

test("unknown, duplicate, non-string, sparse, padded and non-array scopes fail closed", () => {
  for (const scope of [null, "site-info:write member-info:write order:read", [],
    [...REQUIRED_OAUTH_SCOPES, "payment:write"], [...REQUIRED_OAUTH_SCOPES, "order:write"],
    [...REQUIRED_OAUTH_SCOPES, "site-info:write"], [...REQUIRED_OAUTH_SCOPES, 1],
    [...REQUIRED_OAUTH_SCOPES, " site-info:read"], Array(3), [...ALLOWED_OAUTH_SCOPES, "synthetic"]]) {
    rejects(() => validateTokenResponse(response({ ...tokens(), scope })), "invalid_token_scope");
  }
});

test("malformed or excessive token values are rejected without coercion", () => {
  for (const field of ["accessToken", "refreshToken"]) {
    for (const value of [null, 1, {}, [], "", "synthetic token", "synthetic\ntoken", "\ud800", "x".repeat(16385)]) {
      rejects(() => validateTokenResponse(response({ ...tokens(), [field]: value })), "invalid_tokens");
    }
  }
});

test("AES256GCM round-trip preserves validated tokens and actual response scope metadata", () => {
  const validated = validateTokenResponse(response({ ...tokens(), scope: [...ALLOWED_OAUTH_SCOPES] }));
  const sealed = sealTokens(validated, KEY);
  assert.equal(sealed.version, 1);
  assert.equal(sealed.algorithm, "aes-256-gcm");
  assert.equal(Buffer.from(sealed.iv, "base64").length, 12);
  assert.equal(Buffer.from(sealed.authTag, "base64").length, 16);
  assert.deepEqual(openSealedTokens(sealed, KEY), validated);
});

test("each seal uses a fresh nonce and the envelope contains no plaintext tokens or key", () => {
  const data = tokens();
  const first = sealTokens(data, KEY); const second = sealTokens(data, KEY);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const serialized = JSON.stringify(first);
  for (const plaintext of [data.accessToken, data.refreshToken, KEY, ...data.scope]) {
    assert.equal(serialized.includes(plaintext), false);
  }
  assert.deepEqual(openSealedTokens(first, KEY), openSealedTokens(second, KEY));
});

test("seal validates token fields and scope rather than encrypting unvalidated credentials", () => {
  rejects(() => sealTokens({ ...tokens(), scope: ["payment:write"] }, KEY), "invalid_token_scope");
  rejects(() => sealTokens(response(), KEY), "invalid_token_data");
  rejects(() => sealTokens(tokens(), "synthetic-bad-key"), "invalid_encryption_key");
});

test("ciphertext, authentication tag and nonce tampering are rejected", () => {
  const sealed = sealTokens(tokens(), KEY);
  for (const field of ["ciphertext", "authTag", "iv"] as const) {
    rejects(() => openSealedTokens({ ...sealed, [field]: flip(sealed[field]) }, KEY), "invalid_sealed_tokens");
  }
  rejects(() => openSealedTokens(sealed, Buffer.alloc(32, 18).toString("base64")), "invalid_sealed_tokens");
});

test("AAD binds both the fixed site and app and cannot be supplied by a caller", () => {
  assert.equal(IMWEB_OAUTH_AAD, JSON.stringify([IMWEB_OAUTH_SITE, IMWEB_OAUTH_APP]));
  for (const aad of ["", JSON.stringify(["synthetic-other-site", IMWEB_OAUTH_APP]),
    JSON.stringify([IMWEB_OAUTH_SITE, "synthetic-other-app"])]) {
    const sealed = independentlySeal(Buffer.from(JSON.stringify(tokens())), aad);
    rejects(() => openSealedTokens(sealed, KEY), "invalid_sealed_tokens");
  }
});

test("sealed envelope rejects unknown algorithms, versions, fields and malformed base64 lengths", () => {
  const sealed = sealTokens(tokens(), KEY);
  for (const value of [null, {}, { ...sealed, version: 2 }, { ...sealed, algorithm: "aes-256-cbc" },
    { ...sealed, aad: IMWEB_OAUTH_AAD }, { ...sealed, iv: Buffer.alloc(11).toString("base64") },
    { ...sealed, authTag: Buffer.alloc(15).toString("base64") }, { ...sealed, ciphertext: "" },
    { ...sealed, ciphertext: sealed.ciphertext + "\n" },
    { ...sealed, ciphertext: Buffer.alloc(65537).toString("base64") }]) {
    rejects(() => openSealedTokens(value, KEY), "invalid_sealed_tokens");
  }
  rejects(() => openSealedTokens(sealed, "invalid"), "invalid_encryption_key");
});

test("decrypted malformed JSON, invalid UTF8 and unknown scope metadata are rejected generically", () => {
  for (const plaintext of [Buffer.from("not-json"), Buffer.from([0xff]),
    Buffer.from(JSON.stringify({ ...tokens(), scope: ["payment:write"] }))]) {
    rejects(() => openSealedTokens(independentlySeal(plaintext), KEY), "invalid_sealed_tokens");
  }
});

test("all validation and decryption errors expose static codes only, never synthetic secret values", () => {
  const marker = "synthetic-private-marker";
  rejects(() => validateTokenResponse({ statusCode: marker, data: marker }), "invalid_token_response");
  rejects(() => validateOAuthConfig({ ...config(), encryptionKey: marker }), "invalid_encryption_key");
  rejects(() => openSealedTokens({ ...sealTokens(tokens(), KEY), authTag: marker }, KEY), "invalid_sealed_tokens");
});
