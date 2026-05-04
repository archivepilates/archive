export const REGION = "asia-northeast3";
export const TIMEZONE = process.env.DEFAULT_TIMEZONE || "Asia/Seoul";
export const DEFAULT_STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
export const DEFAULT_MANAGER_STAFF_ID = process.env.MANAGER_STAFF_ID || "1979746";
export const STUDIOMATE_BASE_URL = process.env.STUDIOMATE_BASE_URL || "https://api.studiomate.kr";
export const MANAGER_BASE_URL = process.env.MANAGER_BASE_URL || "https://api.manager.studiomate.kr";
export const LECTURE_WITH = "room;division;staff.profile;bookings.member;bookings.userTicket.ticket";

export const WRITE_QUEUE_MAX_ATTEMPTS = 5;
