import { randomUUID } from "node:crypto";
import { LECTURE_WITH, STUDIOMATE_BASE_URL } from "../config/constants";
import { studiomateLoginId, studiomateLoginPassword } from "../config/secrets";
import type { StudioMateToken } from "../types/studiomate";
import { AppError } from "../utils/errors";
import { logApiCall } from "../utils/logger";
import { sanitizeLogText } from "../utils/sanitize";
import { getStudioMateTokenFromStore, saveStudioMateToken } from "./authTokenStore";

export class StudioMateClient {
  constructor(private readonly studioId: string) {}

  async login(): Promise<StudioMateToken> {
    const cached = await getStudioMateTokenFromStore();
    if (cached) return cached;

    const started = Date.now();
    const requestId = randomUUID();
    const res = await fetch(`${STUDIOMATE_BASE_URL}/staff/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "web-version": "1.0.23",
      },
      body: JSON.stringify({
        mobile: studiomateLoginId.value(),
        password: studiomateLoginPassword.value(),
        studio_id: Number(this.studioId),
      }),
    });
    const text = await res.text();
    await logApiCall({
      studioId: this.studioId,
      service: "studiomate",
      endpoint: "POST /staff/login",
      requestId,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - started,
      errorMessage: res.ok ? undefined : sanitizeLogText(text),
    });
    if (!res.ok) throw new AppError("STUDIOMATE_LOGIN_FAILED", `StudioMate login failed ${res.status}`, false);

    const json = JSON.parse(text) as Record<string, any>;
    const accessToken = String(json.access_token || json.token || "");
    if (!accessToken) throw new AppError("STUDIOMATE_LOGIN_FAILED", "StudioMate login response did not include token", false);
    const token = { accessToken, expiresAt: Date.now() + 50 * 60 * 1000 };
    await saveStudioMateToken(token);
    return token;
  }

  async getLectures(params: { startDate: string; endDate: string }): Promise<any[]> {
    const query = new URLSearchParams({
      start_date: params.startDate,
      end_date: params.endDate,
      with: LECTURE_WITH,
    });
    const result = await this.request("GET", `/v2/staff/lectures?${query.toString()}`);
    return Array.isArray(result) ? result : Array.isArray(result.data) ? result.data : [];
  }

  async updateBookingStatus(params: { bookingId: string; status: string }): Promise<void> {
    await this.request("PATCH", `/staff/booking/${encodeURIComponent(params.bookingId)}/status`, {
      status: params.status,
    });
  }

  async createMemo(params: { memberId: string; content: string }): Promise<void> {
    await this.request("POST", "/v2/staff/memo", {
      member_id: params.memberId,
      memo: params.content,
    });
  }

  async getMemberById(memberId: string): Promise<any> {
    return this.request("GET", `/v2/staff/members/${encodeURIComponent(memberId)}`);
  }

  async getMemberByPhone(phone: string): Promise<any> {
    return this.request("GET", `/v2/staff/members/phone/${encodeURIComponent(phone)}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.login();
    const started = Date.now();
    const requestId = randomUUID();
    const res = await fetch(`${STUDIOMATE_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "web-version": "1.0.23",
        Authorization: `Bearer ${token.accessToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    await logApiCall({
      studioId: this.studioId,
      service: "studiomate",
      endpoint: `${method} ${path.split("?")[0]}`,
      requestId,
      status: res.ok ? "success" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - started,
      errorMessage: res.ok ? undefined : sanitizeLogText(text),
    });
    if (!res.ok) throw new AppError("STUDIOMATE_API_FAILED", `StudioMate API failed ${res.status}`, res.status >= 500, sanitizeLogText(text));
    return text ? JSON.parse(text) : {};
  }
}

