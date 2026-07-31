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
  messageType?: string;
  emphasizeType?: string;
  imageId?: string;
  buttons?: Array<{
    name: string;
    type: string;
    mobileUrl: string;
    desktopUrl: string;
  }>;
  syncedAt?: FirebaseFirestore.Timestamp;
}

interface SolapiTemplate {
  templateId?: string;
  templateCode?: string;
  name?: string;
  status?: string;
  channelId?: string;
  content?: string;
  messageType?: string;
  emphasizeType?: string;
  imageId?: string;
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
            buttons: templateButtons(remote),
            messageType: normalizeTemplateType(remote.messageType),
            emphasizeType: normalizeTemplateType(remote.emphasizeType),
            imageId: String(remote.imageId || ""),
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
            buttons: [],
            messageType: "",
            emphasizeType: "",
            imageId: "",
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

export function alimtalkImageTemplateContractIssue(
  state: AlimtalkTemplateState,
  expectedImageId: string,
  label: string,
): string {
  if (normalizeTemplateType(state.messageType) !== "BA") {
    return `${label} 메시지 유형이 기본형(BA)이 아님`;
  }
  if (normalizeTemplateType(state.emphasizeType) !== "IMAGE") {
    return `${label}이 ARCHIVE 이미지형 템플릿이 아님`;
  }
  if (!String(state.imageId || "").trim()) return `${label} 이미지 ID 없음`;
  if (String(state.imageId || "").trim() !== String(expectedImageId || "").trim()) {
    return `${label} ARCHIVE 이미지 ID 불일치`;
  }
  return "";
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
      buttons: templateButtons(remote),
      messageType: normalizeTemplateType(remote.messageType),
      emphasizeType: normalizeTemplateType(remote.emphasizeType),
      imageId: String(remote.imageId || ""),
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
      buttons: [],
      messageType: "",
      emphasizeType: "",
      imageId: "",
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

function normalizeTemplateType(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

async function fetchSolapiTemplate(templateCode: string): Promise<SolapiTemplate> {
  const direct = await fetch(`${SOLAPI_TEMPLATE_URL}/${encodeURIComponent(templateCode)}`, {
    headers: { Authorization: solapiAuthHeader() },
  });
  if (direct.ok) return (await direct.json()) as SolapiTemplate;
  const list = await fetch(
    `${SOLAPI_TEMPLATE_URL}?channelId=${encodeURIComponent(solapiPfid.value())}&limit=100`,
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

function templateButtons(template: SolapiTemplate): AlimtalkTemplateState["buttons"] {
  return (template.buttons || []).map((button) => ({
    name: String(button.buttonName || "").trim(),
    type: normalizeTemplateType(button.buttonType),
    mobileUrl: String(button.linkMo || "").trim(),
    desktopUrl: String(button.linkPc || "").trim(),
  }));
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
