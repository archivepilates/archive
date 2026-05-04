import { randomUUID } from "node:crypto";
import { MANAGER_BASE_URL } from "../config/constants";
import { managerLoginId, managerLoginPassword } from "../config/secrets";
import type { ManagerStudio, ManagerToken } from "../types/studiomate";
import { AppError } from "../utils/errors";
import { logApiCall } from "../utils/logger";
import { sanitizeLogText } from "../utils/sanitize";
import { getManagerTokenFromStore, saveManagerToken } from "./authTokenStore";

export class ManagerClient {
  constructor(private readonly studioId: string, private readonly staffId: string) {}

  async login(): Promise<ManagerToken> {
    const cached = await getManagerTokenFromStore();
    if (cached) return cached;

    const started = Date.now();
    const requestId = randomUUID();
    const res = await fetch(`${MANAGER_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-control": "no-cache",
      },
      body: JSON.stringify({
        mobile: managerLoginId.value(),
        mobileRequired: managerLoginId.value(),
        password: managerLoginPassword.value(),
        studio_id: null,
        staff_id: null,
      }),
    });
    const text = await res.text();
    await logApiCall({
      studioId: this.studioId,
      service: "manager",
      endpoint: "POST /api/auth/login",
      requestId,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - started,
      errorMessage: res.ok ? undefined : sanitizeLogText(text),
    });
    if (!res.ok) throw new AppError("MANAGER_API_FAILED", `Manager login failed ${res.status}`, false);

    const json = JSON.parse(text) as Record<string, any>;
    const accountToken = String(json.account_token || json.access_token || json.token || json.data?.account_token || "");
    if (!accountToken) throw new AppError("MANAGER_API_FAILED", "Manager login response did not include token", false);
    const token = { accountToken, expiresAt: Date.now() + 50 * 60 * 1000 };
    await saveManagerToken(token);
    return token;
  }

  async getStudio(): Promise<ManagerStudio[]> {
    const result = await this.request("GET", "/api/studio", false);
    return Array.isArray(result.studios) ? result.studios : Array.isArray(result.data?.studios) ? result.data.studios : [];
  }

  async getCommonNotices(): Promise<any[]> {
    const query = new URLSearchParams({
      studio_id: this.studioId,
      staff_id: this.staffId,
      paginate_type: "simple",
    });
    const result = await this.request("GET", `/api/staff/notice/common?${query.toString()}`, true);
    return Array.isArray(result.data) ? result.data : Array.isArray(result.data?.data) ? result.data.data : [];
  }

  async getCommonNoReadCount(): Promise<number> {
    const query = new URLSearchParams({ studio_id: this.studioId, staff_id: this.staffId });
    const result = await this.request("GET", `/api/staff/notice/common-no-read-count?${query.toString()}`, true);
    return Number(result.is_checked_common_false_count || result.data?.is_checked_common_false_count || 0);
  }

  private async request(method: string, path: string, includeScope: boolean): Promise<any> {
    const token = await this.login();
    const started = Date.now();
    const requestId = randomUUID();
    const res = await fetch(`${MANAGER_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Cache-control": "no-cache",
        Authorization: `Bearer ${token.accountToken}`,
      },
    });
    const text = await res.text();
    await logApiCall({
      studioId: this.studioId,
      service: "manager",
      endpoint: `${method} ${path.split("?")[0]}`,
      requestId,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - started,
      errorMessage: res.ok ? undefined : sanitizeLogText(text),
    });
    if (!res.ok) throw new AppError("MANAGER_API_FAILED", `Manager API failed ${res.status}`, res.status >= 500, sanitizeLogText({ includeScope, text }));
    return text ? JSON.parse(text) : {};
  }
}

