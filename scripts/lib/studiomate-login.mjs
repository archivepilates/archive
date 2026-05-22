import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PROJECT_ID = "archive-pilates";
const DEFAULT_CREDENTIALS_PATH = "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
const LOGIN_SECRET_NAMES = ["STUDIOMATE_LOGIN_ID", "MANAGER_LOGIN_ID"];
const PASSWORD_SECRET_NAMES = ["STUDIOMATE_LOGIN_PASSWORD", "MANAGER_LOGIN_PASSWORD"];

export async function ensureStudioMateLoggedIn(page, input = {}) {
  const headless = input.headless !== false;
  const waitForLogin = input.waitForLogin === true;
  const text = await page.locator("body").innerText({ timeout: input.timeoutMs || 15000 }).catch(() => "");
  const hasPasswordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false);

  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
  }
  if (!hasPasswordInput && !(/로그인/.test(text) && /아이디|비밀번호|이메일|비번/.test(text))) return false;

  const credentials = await resolveStudioMateCredentials(input);
  if (credentials.loginId && credentials.password) {
    await submitStudioMateLogin(page, credentials, input);
    return true;
  }

  if (waitForLogin && !headless) {
    await waitForManualLogin(page, input);
    return true;
  }

  throw new Error(
    "StudioMate login required, but saved credentials were not available. Set STUDIOMATE_LOGIN_ID/STUDIOMATE_LOGIN_PASSWORD, macOS Keychain entries, or Firebase Secret Manager access.",
  );
}

async function submitStudioMateLogin(page, credentials, input = {}) {
  const idInput = await firstVisibleLocator(page, [
    'input[name*="id" i]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="이메일"]',
    'input[placeholder*="휴대폰"]',
    'input[type="email"]',
    'input[type="text"]',
  ]);
  const passwordInput = await firstVisibleLocator(page, ['input[type="password"]', 'input[placeholder*="비밀번호"]']);

  if (!idInput || !passwordInput) throw new Error("StudioMate login form fields were not found.");

  await idInput.fill(credentials.loginId);
  await passwordInput.fill(credentials.password);

  const loginButton = page
    .locator('button, [role="button"], input[type="submit"]')
    .filter({ hasText: /^로그인$|로그인하기|Login/i })
    .first();
  if (await loginButton.isVisible().catch(() => false)) await loginButton.click({ timeout: 5000 });
  else await passwordInput.press("Enter");

  await page.waitForLoadState("networkidle", { timeout: input.navigationTimeoutMs || 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const stillPassword = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected after saved-credential login.");
  }
  if (stillPassword || (/로그인/.test(text) && /아이디|비밀번호|이메일|비번/.test(text))) {
    throw new Error("StudioMate saved credentials were rejected or login screen remained visible.");
  }
}

async function resolveStudioMateCredentials(input = {}) {
  const loginId = await firstSecretValue({
    envNames: ["STUDIOMATE_LOGIN_ID", "MANAGER_LOGIN_ID"],
    keychainAccounts: LOGIN_SECRET_NAMES,
    secretNames: LOGIN_SECRET_NAMES,
    ...input,
  });
  const password = await firstSecretValue({
    envNames: ["STUDIOMATE_LOGIN_PASSWORD", "MANAGER_LOGIN_PASSWORD"],
    keychainAccounts: PASSWORD_SECRET_NAMES,
    secretNames: PASSWORD_SECRET_NAMES,
    ...input,
  });
  return { loginId, password };
}

async function firstSecretValue(input) {
  for (const envName of input.envNames || []) {
    const value = process.env[envName]?.trim();
    if (value) return value;
  }
  for (const account of input.keychainAccounts || []) {
    const value = await readKeychainPassword(account).catch(() => "");
    if (value) return value;
  }
  for (const secretName of input.secretNames || []) {
    const value = await readGoogleSecret(secretName, input).catch(() => "");
    if (value) return value;
  }
  return "";
}

async function readKeychainPassword(account) {
  const service = process.env.STUDIOMATE_KEYCHAIN_SERVICE || "archive-pilates";
  const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
    timeout: 5000,
  });
  return stdout.trim();
}

async function readGoogleSecret(secretName, input = {}) {
  const projectId = input.googleProject || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID;
  const credentialsPath = input.credentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS_PATH;
  const key = JSON.parse(await readFile(credentialsPath, "utf8"));
  const token = await googleAccessToken(key, ["https://www.googleapis.com/auth/cloud-platform"]);
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(
    secretName,
  )}/versions/latest:access`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Secret Manager access failed for ${secretName}: ${response.status}`);
  const body = await response.json();
  return Buffer.from(body?.payload?.data || "", "base64").toString("utf8").trim();
}

async function googleAccessToken(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(assertion).sign(key.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${assertion}.${base64url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error(`Google token request failed ${response.status}: ${await response.text()}`);
  return (await response.json()).access_token;
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function waitForManualLogin(page, input = {}) {
  const deadline = Date.now() + (input.manualLoginTimeoutMs || 5 * 60 * 1000);
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/captcha|보안문자|인증번호/i.test(text)) throw new Error("StudioMate security screen detected.");
    if (!(await page.locator('input[type="password"]').first().isVisible().catch(() => false)) && /회원|수업|예약|강사|설정|매출/.test(text)) return;
    await page.waitForTimeout(2000);
  }
  throw new Error("Timed out waiting for manual StudioMate login.");
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
