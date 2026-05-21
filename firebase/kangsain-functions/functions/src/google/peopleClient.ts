import { createSign } from "node:crypto";
import { googleDwdServiceAccountJson } from "../config/secrets";

const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts";
const DELEGATED_USER = "home@archivepilates.com";

export interface HomeContact {
  resourceName: string;
  etag: string;
  name: string;
  phones: string[];
  biography: string;
}

export class HomePeopleClient {
  private accessToken: string | null = null;

  async listContactsByPhone(): Promise<Map<string, HomeContact[]>> {
    const map = new Map<string, HomeContact[]>();
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        pageSize: "1000",
        personFields: "names,phoneNumbers,biographies,metadata",
        sortOrder: "FIRST_NAME_ASCENDING",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request<{ connections?: unknown[]; nextPageToken?: string }>(
        `/v1/people/me/connections?${params.toString()}`,
        { method: "GET" },
      );
      (response.connections || []).forEach((raw) => {
        const contact = parseContact(raw);
        contact.phones.map(normalizePhone).filter(Boolean).forEach((phone) => {
          const rows = map.get(phone) || [];
          rows.push(contact);
          map.set(phone, rows);
        });
      });
      pageToken = response.nextPageToken || "";
    } while (pageToken);
    return map;
  }

  async upsertByPhone(input: {
    existing: HomeContact[];
    name: string;
    phone: string;
    memo?: string;
  }): Promise<{ action: "created" | "updated" | "skipped"; resourceName?: string }> {
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) throw new Error("연락처 전화번호가 없습니다");
    if (input.existing.length > 1) throw new Error(`같은 전화번호 연락처가 ${input.existing.length}개 있습니다`);

    const nextBiography = nextContactBiography(input.existing[0]?.biography || "", input.memo);
    const person = {
      names: [{ givenName: input.name }],
      phoneNumbers: [{ value: formatPhone(input.phone) }],
      ...(nextBiography ? { biographies: [{ value: nextBiography }] } : {}),
    };
    const updatePersonFields = nextBiography ? "names,phoneNumbers,biographies" : "names,phoneNumbers";

    if (!input.existing.length) {
      const created = await this.request<{ resourceName?: string }>("/v1/people:createContact", {
        method: "POST",
        body: JSON.stringify(person),
      });
      return { action: "created", resourceName: created.resourceName };
    }

    const current = input.existing[0];
    const currentName = current.name.trim();
    const currentPhone = normalizePhone(current.phones[0] || "");
    if (
      currentName === input.name.trim() &&
      currentPhone === normalizedPhone &&
      normalizeBiography(current.biography) === normalizeBiography(nextBiography)
    ) {
      return { action: "skipped", resourceName: current.resourceName };
    }

    const updated = await this.request<{ resourceName?: string }>(
      `/v1/${current.resourceName}:updateContact?updatePersonFields=${updatePersonFields}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...person,
          etag: current.etag,
        }),
      },
    );
    return { action: "updated", resourceName: updated.resourceName || current.resourceName };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`https://people.googleapis.com${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(json?.error?.message || `People API failed: ${response.status}`);
    }
    return json as T;
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
      scope: CONTACTS_SCOPE,
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

export function normalizePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function parseContact(raw: unknown): HomeContact {
  const person = raw as {
    resourceName?: string;
    etag?: string;
    names?: Array<{ displayName?: string }>;
    phoneNumbers?: Array<{ value?: string }>;
    biographies?: Array<{ value?: string }>;
  };
  return {
    resourceName: person.resourceName || "",
    etag: person.etag || "",
    name: person.names?.[0]?.displayName || "",
    phones: (person.phoneNumbers || []).map((phone) => phone.value || "").filter(Boolean),
    biography: person.biographies?.[0]?.value || "",
  };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function formatPhone(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value;
}

const ARCHIVE_MEMO_START = "[Archive StudioMate 메모]";
const ARCHIVE_MEMO_END = "[/Archive StudioMate 메모]";

function nextContactBiography(current: string, memo: string | undefined): string {
  const cleanedMemo = cleanMemo(memo || "");
  if (!cleanedMemo) return current || "";
  const block = `${ARCHIVE_MEMO_START}\n${cleanedMemo}\n${ARCHIVE_MEMO_END}`;
  const pattern = new RegExp(`${escapeRegExp(ARCHIVE_MEMO_START)}[\\s\\S]*?${escapeRegExp(ARCHIVE_MEMO_END)}`);
  const base = String(current || "").trim();
  if (pattern.test(base)) return base.replace(pattern, block).trim();
  return [base, block].filter(Boolean).join("\n\n");
}

function cleanMemo(value: string): string {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}

function normalizeBiography(value: string): string {
  return String(value || "").trim().replace(/\r\n?/g, "\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
