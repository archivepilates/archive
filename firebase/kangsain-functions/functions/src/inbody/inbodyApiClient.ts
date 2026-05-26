import { inbodyApiKey } from "../config/secrets";

const LOOKINBODY_API_BASE_URL = "https://apikr.lookinbody.com";
const LOOKINBODY_ACCOUNT = "arcpilates";

export type InBodyDetailData = Record<string, unknown>;

interface FetchInBodyDetailArgs {
  userId: string;
  userToken: string;
  datetimes: string;
}

interface InBodyApiCall {
  endpoint: string;
  body: Record<string, string>;
}

export interface FetchInBodyDetailResult {
  detail: InBodyDetailData;
  endpoint: string;
}

export async function fetchFullInBodyData(args: FetchInBodyDetailArgs): Promise<FetchInBodyDetailResult> {
  const calls: InBodyApiCall[] = [
    {
      endpoint: "/InBody/GetFullInBodyDataByID",
      body: {
        UserID: args.userId,
        Datetimes: args.datetimes,
      },
    },
    {
      endpoint: "/InBody/GetFullInBodyData",
      body: {
        UserToken: args.userToken,
        Datetimes: args.datetimes,
      },
    },
  ];

  let lastError = "";
  for (const call of calls) {
    try {
      return {
        detail: await postLookinBody(call),
        endpoint: call.endpoint,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError || "inbody detail api failed");
}

async function postLookinBody(call: InBodyApiCall): Promise<InBodyDetailData> {
  const apiKey = configuredApiKey();
  if (!apiKey) throw new Error("inbody api key is not configured");

  const response = await fetch(`${LOOKINBODY_API_BASE_URL}${call.endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Account: LOOKINBODY_ACCOUNT,
      "API-KEY": apiKey,
    },
    body: JSON.stringify(call.body),
  });
  const text = await response.text();
  const parsed = parseJson(text);

  if (!response.ok) {
    throw new Error(`inbody api ${call.endpoint} returned ${response.status}: ${summarizeApiError(parsed, text)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`inbody api ${call.endpoint} returned invalid detail payload`);
  }

  return parsed as InBodyDetailData;
}

function configuredApiKey(): string {
  try {
    return inbodyApiKey.value().trim();
  } catch {
    return "";
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeApiError(parsed: unknown, text: string): string {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const message = obj.message || obj.Message || obj.error || obj.Error || obj.result || obj.Result;
    if (message) return String(message).slice(0, 180);
  }
  return text.slice(0, 180);
}
