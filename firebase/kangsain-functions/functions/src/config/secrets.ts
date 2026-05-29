import { defineSecret } from "firebase-functions/params";

export const studiomateLoginId = defineSecret("STUDIOMATE_LOGIN_ID");
export const studiomateLoginPassword = defineSecret("STUDIOMATE_LOGIN_PASSWORD");
export const managerLoginId = defineSecret("MANAGER_LOGIN_ID");
export const managerLoginPassword = defineSecret("MANAGER_LOGIN_PASSWORD");
export const googleDwdServiceAccountJson = defineSecret("GOOGLE_DWD_SERVICE_ACCOUNT_JSON");
export const solapiApiKey = defineSecret("SOLAPI_API_KEY");
export const solapiApiSecret = defineSecret("SOLAPI_API_SECRET");
export const solapiPfid = defineSecret("SOLAPI_PFID");
export const privateSurveyWebhookSecret = defineSecret("PRIVATE_SURVEY_WEBHOOK_SECRET");
export const inbodyWebhookSecret = defineSecret("INBODY_WEBHOOK_SECRET");
export const inbodyApiKey = defineSecret("INBODY_API_KEY");
export const notionToken = defineSecret("NOTION_TOKEN");
export const geminiApiKey = defineSecret("GEMINI_API_KEY");

export const allSecrets = [
  studiomateLoginId,
  studiomateLoginPassword,
  managerLoginId,
  managerLoginPassword,
  googleDwdServiceAccountJson,
  solapiApiKey,
  solapiApiSecret,
  solapiPfid,
  privateSurveyWebhookSecret,
  inbodyWebhookSecret,
  inbodyApiKey,
];
