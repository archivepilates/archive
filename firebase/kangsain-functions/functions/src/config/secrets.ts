import { defineSecret } from "firebase-functions/params";

export const studiomateLoginId = defineSecret("STUDIOMATE_LOGIN_ID");
export const studiomateLoginPassword = defineSecret("STUDIOMATE_LOGIN_PASSWORD");
export const managerLoginId = defineSecret("MANAGER_LOGIN_ID");
export const managerLoginPassword = defineSecret("MANAGER_LOGIN_PASSWORD");

export const allSecrets = [studiomateLoginId, studiomateLoginPassword, managerLoginId, managerLoginPassword];
