export const REGION = "asia-northeast3";
export const TIMEZONE = process.env.DEFAULT_TIMEZONE || "Asia/Seoul";
export const DEFAULT_STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
export const DEFAULT_MANAGER_STAFF_ID = process.env.MANAGER_STAFF_ID || "1979746";
export const STUDIOMATE_BASE_URL = process.env.STUDIOMATE_BASE_URL || "https://api.studiomate.kr";
export const MANAGER_BASE_URL = process.env.MANAGER_BASE_URL || "https://api.manager.studiomate.kr";
export const LECTURE_WITH = "room;division;staff.profile;bookings.member;bookings.userTicket.ticket";
export const DASHBOARD_DB_SPREADSHEET_ID =
  process.env.DASHBOARD_DB_SPREADSHEET_ID || "1yEU2lDM_hTKQ-qT8UNj1PsiL7fsBwAgkzsKOzfXVsKg";
export const DASHBOARD_LEGACY_ENDPOINT_URL =
  process.env.DASHBOARD_LEGACY_ENDPOINT_URL ||
  "https://script.google.com/macros/s/AKfycby3lRWs1quY1Qm1BhfEltUrZAk7cS2lvv-poT01HbcaYhp_V4Y2D0Ig6tStzpFP0NvC/exec?action=dashboard";

export const WRITE_QUEUE_MAX_ATTEMPTS = 5;
