import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { nowTimestamp } from "../utils/date";
import { ALIMTALK_TEMPLATES } from "./templates";

const SOLAPI_TEMPLATE_URL = "https://api.solapi.com/kakao/v2/templates";
const APPROVED_STATUSES = new Set(["APPROVED"]);
const TEMPLATE_STATUS_CACHE_MS = 10 * 60 * 1000;

interface TemplateState {
  templateCode: string;
  status: string;
  name: string;
  label: string;
  source: "solapi" | "static" | "error";
  lastError: string | null;
  syncedAt?: FirebaseFirestore.Timestamp;
}

interface SolapiTemplate {
  templateId?: string;
  templateCode?: string;
  name?: string;
  status?: string;
}

export async function syncAlimtalkTemplateStatuses(): Promise<{ checked: number; approved: number; failed: number }> {
  let checked = 0;
  let approved = 0;
  let failed = 0;
  for (const template of Object.values(ALIMTALK_TEMPLATES)) {
    if (!template.code) continue;
    checked += 1;
    try {
      const remote = await fetchSolapiTemplate(template.code);
      const status = remote ? String(remote.status || template.status || "").toUpperCase() : "NOT_FOUND";
      if (APPROVED_STATUSES.has(status)) approved += 1;
      await db
        .collection("alimtalkTemplateStates")
        .doc(template.code)
        .set(
          {
            templateCode: template.code,
            label: template.label,
            name: remote?.name || template.label,
            status,
            source: "solapi",
            lastError: remote ? null : "TemplateNotFound: 템플릿을 찾을 수 없습니다.",
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
        .doc(template.code)
        .set(
          {
            templateCode: template.code,
            label: template.label,
            name: template.label,
            status: String(template.status || "").toUpperCase(),
            source: "error",
            lastError: message,
            syncedAt: nowTimestamp(),
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
      logger.warn("syncAlimtalkTemplateStatuses failed for template", { templateCode: template.code, message });
    }
  }
  logger.info("syncAlimtalkTemplateStatuses completed", { checked, approved, failed });
  return { checked, approved, failed };
}

export async function isAlimtalkTemplateApproved(templateCode: string): Promise<boolean> {
  if (!templateCode) return false;
  const state = await templateState(templateCode);
  if (state?.source === "solapi") return APPROVED_STATUSES.has(String(state.status || "").toUpperCase());
  return false;
}

async function templateState(templateCode: string): Promise<TemplateState | null> {
  const ref = db.collection("alimtalkTemplateStates").doc(templateCode);
  const snap = await ref.get();
  const state = snap.data() as TemplateState | undefined;
  const syncedAt = state?.syncedAt?.toMillis?.() || 0;
  if (state && Date.now() - syncedAt < TEMPLATE_STATUS_CACHE_MS) return state;

  const template = Object.values(ALIMTALK_TEMPLATES).find((item) => item.code === templateCode);
  const label = template?.label || templateCode;
  const staticStatus = template?.status || "";
  try {
    const remote = await fetchSolapiTemplate(templateCode);
    const status = remote ? String(remote.status || staticStatus || "").toUpperCase() : "NOT_FOUND";
    const next = {
      templateCode,
      label,
      name: remote?.name || label,
      status,
      source: "solapi" as const,
      lastError: remote ? null : "TemplateNotFound: 템플릿을 찾을 수 없습니다.",
      syncedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    };
    await ref.set(next, { merge: true });
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ref.set(
      {
        templateCode,
        label,
        name: label,
        status: String(staticStatus || "").toUpperCase(),
        source: "error",
        lastError: message,
        syncedAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return {
      templateCode,
      label,
      name: label,
      status: String(staticStatus || "ERROR").toUpperCase(),
      source: "error",
      lastError: message,
      syncedAt: nowTimestamp(),
    };
  }
}

async function fetchSolapiTemplate(templateCode: string): Promise<SolapiTemplate | null> {
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
  return rows.find((item) => item.templateId === templateCode || item.templateCode === templateCode) || null;
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
