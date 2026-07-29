import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { nowTimestamp } from "../utils/date";
import { ALIMTALK_TEMPLATES } from "./templates";

const SOLAPI_TEMPLATE_URL = "https://api.solapi.com/kakao/v2/templates";
const APPROVED_STATUSES = new Set(["APPROVED"]);
const TEMPLATE_STATUS_CACHE_MS = 10 * 60 * 1000;

export interface AlimtalkTemplateState {
  templateCode: string;
  status: string;
  name: string;
  label: string;
  source: "solapi" | "error";
  lastError: string | null;
  channelId?: string;
  content?: string;
  buttonUrls?: string[];
  syncedAt?: FirebaseFirestore.Timestamp;
}

interface SolapiTemplate {
  templateId?: string;
  templateCode?: string;
  name?: string;
  status?: string;
  channelId?: string;
  content?: string;
  buttons?: Array<{
    buttonName?: string;
    buttonType?: string;
    linkMo?: string;
    linkPc?: string;
  }>;
}

export interface AlimtalkTemplateReadiness {
  approved: boolean;
  retryable: boolean;
  state: AlimtalkTemplateState | null;
}

export async function syncAlimtalkTemplateStatuses(): Promise<{ checked: number; approved: number; failed: number }> {
  let checked = 0;
  let approved = 0;
  let failed = 0;
  for (const template of Object.values(ALIMTALK_TEMPLATES)) {
    const templateCode = normalizeTemplateCode(template.code);
    if (!templateCode) continue;
    checked += 1;
    try {
      const remote = await fetchSolapiTemplate(templateCode);
      const status = String(remote.status || "").toUpperCase();
      if (APPROVED_STATUSES.has(status)) approved += 1;
      await db
        .collection("alimtalkTemplateStates")
        .doc(templateCode)
        .set(
          {
            templateCode,
            label: template.label,
            name: remote.name || template.label,
            status,
            source: "solapi",
            lastError: null,
            channelId: String(remote.channelId || ""),
            content: String(remote.content || ""),
            buttonUrls: templateButtonUrls(remote),
            syncedAt: nowTimestamp(),
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      await db
        .collection("alimtalkTemplateStates")
        .doc(templateCode)
        .set(
          {
            templateCode,
            label: template.label,
            name: template.label,
            status: "UNKNOWN",
            source: "error",
            lastError: message,
            channelId: "",
            content: "",
            buttonUrls: [],
            syncedAt: nowTimestamp(),
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
      logger.warn("syncAlimtalkTemplateStatuses failed for template", { templateCode, message });
    }
  }
  logger.info("syncAlimtalkTemplateStatuses completed", { checked, approved, failed });
  return { checked, approved, failed };
}

export async function isAlimtalkTemplateApproved(templateCode: string): Promise<boolean> {
  return (await alimtalkTemplateReadiness(templateCode)).approved;
}

export async function alimtalkTemplateReadiness(templateCode: string): Promise<AlimtalkTemplateReadiness> {
  const normalizedTemplateCode = normalizeTemplateCode(templateCode);
  if (!normalizedTemplateCode) return { approved: false, retryable: false, state: null };
  return templateReadinessFromState(await templateState(normalizedTemplateCode));
}

export function templateReadinessFromState(
  state: AlimtalkTemplateState | null,
): AlimtalkTemplateReadiness {
  return {
    approved: Boolean(
      state?.source === "solapi" && APPROVED_STATUSES.has(String(state.status || "").toUpperCase()),
    ),
    retryable: state?.source === "error",
    state,
  };
}

async function templateState(templateCode: string): Promise<AlimtalkTemplateState | null> {
  const normalizedTemplateCode = normalizeTemplateCode(templateCode);
  if (!normalizedTemplateCode) return null;
  const ref = db.collection("alimtalkTemplateStates").doc(normalizedTemplateCode);
  const snap = await ref.get();
  const state = snap.data() as AlimtalkTemplateState | undefined;
  const syncedAt = state?.syncedAt?.toMillis?.() || 0;
  if (state && Date.now() - syncedAt < TEMPLATE_STATUS_CACHE_MS) return state;

  const template = Object.values(ALIMTALK_TEMPLATES).find((item) => normalizeTemplateCode(item.code) === normalizedTemplateCode);
  if (!template) return state || null;
  try {
    const remote = await fetchSolapiTemplate(normalizedTemplateCode);
    const next = {
      templateCode: normalizedTemplateCode,
      label: template.label,
      name: remote.name || template.label,
      status: String(remote.status || "").toUpperCase(),
      source: "solapi" as const,
      lastError: null,
      channelId: String(remote.channelId || ""),
      content: String(remote.content || ""),
      buttonUrls: templateButtonUrls(remote),
      syncedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    };
    await ref.set(next, { merge: true });
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = {
      templateCode: normalizedTemplateCode,
      label: template.label,
      name: template.label,
      status: "UNKNOWN",
      source: "error" as const,
      lastError: message,
      channelId: "",
      content: "",
      buttonUrls: [],
      syncedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    };
    await ref.set(next, { merge: true });
    return next;
  }
}

function normalizeTemplateCode(value: unknown): string {
  return String(value || "").trim();
}

async function fetchSolapiTemplate(templateCode: string): Promise<SolapiTemplate> {
  const direct = await fetch(`${SOLAPI_TEMPLATE_URL}/${encodeURIComponent(templateCode)}`, {
    headers: { Authorization: solapiAuthHeader() },
  });
  if (direct.ok) return (await direct.json()) as SolapiTemplate;
  const list = await fetch(
    `${SOLAPI_TEMPLATE_URL}?templateId=${encodeURIComponent(templateCode)}&pfId=${encodeURIComponent(solapiPfid.value())}`,
    {
      headers: { Authorization: solapiAuthHeader() },
    },
  );
  if (!list.ok) throw new Error(`SOLAPI template status ${direct.status}/${list.status}`);
  const body = (await list.json()) as
    | { templateList?: SolapiTemplate[]; templates?: SolapiTemplate[]; list?: SolapiTemplate[] }
    | SolapiTemplate[];
  const rows = Array.isArray(body) ? body : body.templateList || body.templates || body.list || [];
  const match = rows.find((item) => item.templateId === templateCode || item.templateCode === templateCode);
  if (!match) throw new Error(`SOLAPI template not found: ${templateCode}`);
  return match;
}

function templateButtonUrls(template: SolapiTemplate): string[] {
  return (template.buttons || [])
    .flatMap((button) => [button.linkMo, button.linkPc])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function solapiAuthHeader(): string {
  const apiKey = solapiApiKey.value();
  const apiSecret = solapiApiSecret.value();
  const dateTime = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}
