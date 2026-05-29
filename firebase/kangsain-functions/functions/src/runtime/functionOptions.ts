import { REGION, TIMEZONE } from "../config/constants";
import { allSecrets, geminiApiKey, notionToken } from "../config/secrets";

export const callableOptions = { region: REGION, secrets: allSecrets, invoker: "public" as const };
export const longCallableOptions = { ...callableOptions, timeoutSeconds: 540, memory: "512MiB" as const };

export const longRequestOptions = {
  region: REGION,
  secrets: allSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
};

export const scheduleOptions = {
  region: REGION,
  timeZone: TIMEZONE,
  secrets: allSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
};

export const privateSurveyIngestOptions = {
  region: REGION,
  secrets: allSecrets,
  timeoutSeconds: 120,
  memory: "256MiB" as const,
};

export const privateSurveyIntakeOptions = {
  ...scheduleOptions,
  secrets: [...allSecrets, notionToken],
};

export const privateLessonChartRequestOptions = {
  region: REGION,
  secrets: [...allSecrets, notionToken, geminiApiKey],
  timeoutSeconds: 120,
  memory: "256MiB" as const,
  invoker: "public" as const,
};

export const privateLessonChartScheduleOptions = {
  ...privateSurveyIntakeOptions,
  secrets: [...allSecrets, notionToken, geminiApiKey],
};

export const publicRequestOptions = {
  region: REGION,
  timeoutSeconds: 60,
  memory: "256MiB" as const,
  invoker: "public" as const,
};

export const publicLongRequestOptions = {
  ...longRequestOptions,
};
