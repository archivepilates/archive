import { onCall } from "firebase-functions/v2/https";
import { getInstructorHomeHandler } from "../callable/getInstructorHome";
import { getMemberMemoHistoryHandler } from "../callable/getMemberMemoHistory";
import { registerFcmTokenHandler } from "../callable/registerFcmToken";
import { searchMembersHandler } from "../callable/searchMembers";
import {
  adminIssueStaffTempCodeHandler,
  loginStaffWithPinHandler,
  setupStaffPinWithTempCodeHandler,
} from "../callable/staffPinAuth";
import { submitBookingAttendanceHandler } from "../callable/submitBookingAttendance";
import { submitMemberMemoHandler } from "../callable/submitMemberMemo";
import { callableOptions } from "../runtime/functionOptions";
import { requireStaff } from "../security/authGuards";
import { toHttpsError } from "../utils/errors";

export const getInstructorHome = onCall(callableOptions, async (request) => {
  try {
    return await getInstructorHomeHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const loginStaffWithPin = onCall(callableOptions, async (request) => {
  try {
    return await loginStaffWithPinHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const setupStaffPinWithTempCode = onCall(callableOptions, async (request) => {
  try {
    return await setupStaffPinWithTempCodeHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitBookingAttendance = onCall(callableOptions, async (request) => {
  try {
    return await submitBookingAttendanceHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitMemberMemo = onCall(callableOptions, async (request) => {
  try {
    return await submitMemberMemoHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getMemberMemoHistory = onCall(callableOptions, async (request) => {
  try {
    return await getMemberMemoHistoryHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const searchMembers = onCall(callableOptions, async (request) => {
  try {
    return await searchMembersHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const registerFcmToken = onCall(callableOptions, async (request) => {
  try {
    return await registerFcmTokenHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const adminIssueStaffTempCode = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await adminIssueStaffTempCodeHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});
