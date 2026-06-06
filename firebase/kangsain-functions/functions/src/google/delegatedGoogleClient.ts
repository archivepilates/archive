import { createSign } from "node:crypto";
import { googleDwdServiceAccountJson } from "../config/secrets";

const DELEGATED_USER = "home@archivepilates.com";

export class DelegatedGoogleClient {
  private readonly scopes: string[];
  private accessToken: string | null = null;

  constructor(scopes: string[]) {
    this.scopes = scopes;
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body && !(init.body instanceof URLSearchParams) ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(json?.error?.message || `Google API failed: ${response.status}`);
    }
    return json as T;
  }

  async requestBuffer(url: string, init: RequestInit = {}): Promise<Buffer> {
    const token = await this.getAccessToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const json = text ? JSON.parse(text) : {};
      throw new Error(json?.error?.message || `Google API failed: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const key = JSON.parse(googleDwdServiceAccountJson.value()) as {
      client_email: string;
      private_key: string;
    };
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({
      iss: key.client_email,
      scope: this.scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      sub: DELEGATED_USER,
    })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }).toString();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || `OAuth token failed: ${response.status}`);
    }
    this.accessToken = json.access_token;
    return this.accessToken;
  }
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
