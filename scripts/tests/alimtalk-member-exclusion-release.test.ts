import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const repo = new URL("../../", import.meta.url);
const src = "firebase/kangsain-functions/functions/src/";
const ts = createRequire(new URL(`${src}../package.json`, repo))("typescript");
const revision = process.env.ALIMTALK_EXCLUSION_REVIEW_REF;

// Compile actual pure declarations only. No application imports, Firebase, or credentials.
function pure(relative: string, names: string[] | null, bindings: Record<string, unknown> = {}) {
  const path = src + relative;
  const source = revision
    ? execFileSync("git", ["show", `${revision}:${path}`], { cwd: fileURLToPath(repo), encoding: "utf8" })
    : readFileSync(new URL(path, repo), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = tree.statements.filter((node: any) => {
    if (ts.isImportDeclaration(node)) return false;
    if (!names) return true;
    if (ts.isFunctionDeclaration(node)) return names.includes(node.name?.text);
    return ts.isVariableStatement(node) && node.declarationList.declarations.some(
      (item: any) => names.includes(item.name.getText(tree)),
    );
  });
  const exports: Record<string, any> = {};
  const exposed = names ? `\nObject.assign(exports, { ${names.join(", ")} });` : "";
  const code = ts.transpileModule(selected.map((node: any) => node.getText(tree)).join("\n") + exposed, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, ...bindings,
    require: (id: string) => { throw new Error(`Forbidden runtime import: ${id}`); },
  }, { filename: `${revision || "working-tree"}:${relative}`, timeout: 1000 });
  return exports;
}

const templates = pure("alimtalk/templates.ts", ["ALIMTALK_MEMBER_EXCLUSION_REASONS"]);
const recipients = pure("alimtalk/testRecipients.ts", null);
const exclusions = pure("alimtalk/recipientExclusion.ts", [
  "AUTOMATIC_MEMBER_TYPES", "STAFF_MEMBER_GRADES", "isAutomaticMemberAlimtalkType",
  "automaticMemberExclusionReason",
], { ...templates, ...recipients });
const products = pure("alimtalk/recipientExclusion.ts", ["automaticMemberProductIssue", "instructorLessonSource"]);
const renewal = pure("renewal/renewalPolicy.ts", null);
const guard = pure("alimtalk/renewalSendGuard.ts", [
  "RENEWAL_TYPES", "renewalCandidateProfileIssue", "sameTicket", "currentTicket", "daysUntil", "dateText",
], renewal);
const generation = pure("alimtalk/rebuildAlimtalkCandidates.ts", [
  "isLessonProfileTicket", "currentLessonProfileTickets", "currentOrUpcomingLessonProfileTickets",
  "isCurrentLessonProfileTicket", "isCurrentOrUpcomingLessonProfileTicket", "expiryDateText",
  "reservationOpenEligibleGroupTickets", "isReservationOpenEligibleGroupTicket",
  "isGroupOrMixedProfileTicket", "isPrivateProfileTicket", "isPrivateBookingTicket",
  "bookingTicketKind", "isInstructorLessonBooking", "isGroupBooking",
], renewal);
const absence = pure("alimtalk/longAbsencePolicy.ts", null, renewal);
const welcomeTemplate = pure("memberSignup/membershipWelcomePolicy.ts", ["MEMBERSHIP_WELCOME_TEMPLATE"]);
const canary = pure("memberSignup/membershipWelcomeQueue.ts", [
  "membershipActivationScopeIssue", "isMembershipWelcomeCanaryRecipient",
], welcomeTemplate);
const survey = pure("alimtalk/privateSurveySendGuard.ts", [
  "privateSurveySourceIssue", "sha256", "isPrivateBooking",
], { createHash });

const today = "2026-09-30";
const stamp = (day: string) => ({ toDate: () => new Date(`${day}T00:00:00+09:00`) });
const member = { memberId: "synthetic-member", phone: "01000000001", memberGrade: "회원" };
const regular = {
  name: "그룹 30회", classType: "G", userTicketId: "regular-ticket",
  remainingCount: 3, expiresAt: stamp("2026-10-10"),
};
const instructor = { ...regular, name: "강사레슨 (2T)", classType: "I", userTicketId: "instructor-ticket" };
const notice = {
  type: "remaining_low", memberId: member.memberId, sourceDate: today,
  payload: { userTicketId: regular.userTicketId, ticketName: regular.name },
};

test("normal members and instructor-grade/tag members retain regular-product eligibility", () => {
  for (const memberGrade of ["회원", "VIP", "강사", "강사회원"]) {
    const profile = { ...member, memberGrade, tags: ["강사"], activeTickets: [regular] };
    assert.equal(exclusions.automaticMemberExclusionReason(profile, new Set()), "");
    assert.equal(generation.currentLessonProfileTickets(profile, today).length, 1);
    assert.equal(guard.renewalCandidateProfileIssue(notice, profile), "");
  }
});

test("staff grades, normalized active staff phones, and configured IDs are excluded", () => {
  for (const memberGrade of ["스텝", "직원", " staff ", "STAFF"]) {
    assert.notEqual(exclusions.automaticMemberExclusionReason({ ...member, memberGrade }, new Set()), "");
  }
  assert.notEqual(exclusions.automaticMemberExclusionReason(
    { ...member, phone: "+82 10-0000-0001" }, new Set([member.phone]),
  ), "");
  for (const memberId of Object.keys(templates.ALIMTALK_MEMBER_EXCLUSION_REASONS)) {
    assert.notEqual(exclusions.automaticMemberExclusionReason({ ...member, memberId }, new Set()), "");
  }
});

test("staff transitions depend on current grade and current phone set; removal does not clear a remaining grade", () => {
  assert.equal(exclusions.automaticMemberExclusionReason(member, new Set()), "");
  assert.notEqual(exclusions.automaticMemberExclusionReason(member, new Set([member.phone])), "");
  assert.notEqual(exclusions.automaticMemberExclusionReason({ ...member, memberGrade: "스텝" }, new Set()), "");
  assert.equal(exclusions.automaticMemberExclusionReason(member, new Set()), "");
});

test("current semantics: missing staff evidence and tags alone do not establish staff status", () => {
  // Characterization, not approval of missing-information policy or live staff freshness.
  assert.equal(exclusions.automaticMemberExclusionReason({ memberId: member.memberId }, new Set()), "");
  assert.equal(exclusions.automaticMemberExclusionReason({ ...member, tags: ["스텝"] }, new Set()), "");
});

test("dynamic staff exclusions cover automatic member flows but not independent instructor work flows", () => {
  for (const type of ["new_member", "membership_welcome", "reservation_open", "private_survey", "group_survey",
    "remaining_low", "ticket_expiring", "private_count_low", "private_ticket_expiring", "long_absence"]) {
    assert.equal(exclusions.isAutomaticMemberAlimtalkType(type), true, type);
  }
  for (const type of ["instructor_lesson_material", "instructor_lesson_confirmation", "private_lesson_report"]) {
    assert.equal(exclusions.isAutomaticMemberAlimtalkType(type), false, type);
  }
});

test("explicit exceptions require a configured test recipient and an accepted explicit marker", () => {
  const fixture = recipients.primaryAlimtalkTestRecipient();
  const known = { memberId: fixture.memberId, memberName: fixture.name, memberPhone: fixture.phone };
  assert.equal(recipients.hasExplicitAlimtalkTestOverride({ ...known, queuedBy: "auto", reviewedByUid: "system:daily" }), false);
  for (const marker of [
    { queuedBy: "operator" }, { reviewedByUid: "synthetic-operator" },
    { payload: { deliveryMode: "sample" } }, { payload: { testRecipientOverride: "approved" } },
  ]) {
    assert.equal(recipients.hasExplicitAlimtalkTestOverride({ ...known, ...marker }), true);
    assert.equal(recipients.hasExplicitAlimtalkTestOverride({ memberId: member.memberId, memberPhone: member.phone, ...marker }), false);
  }
});

test("mixed regular and instructor passes retain only the regular product, not a whole-member ban", () => {
  const profile = { ...member, activeTickets: [regular, instructor] };
  assert.deepEqual(Array.from(generation.currentLessonProfileTickets(profile, today), (item: any) => item.userTicketId), [regular.userTicketId]);
  assert.deepEqual(Array.from(generation.reservationOpenEligibleGroupTickets(profile, today, "2026-10-04"), (item: any) => item.userTicketId), [regular.userTicketId]);
  assert.equal(guard.renewalCandidateProfileIssue(notice, profile), "");
  assert.equal(generation.currentLessonProfileTickets({ activeTickets: [instructor] }, today).length, 0);
});

test("ticket removal and a renamed instructor product block an existing regular notice", () => {
  assert.notEqual(guard.renewalCandidateProfileIssue(notice, { activeTickets: [] }), "");
  assert.notEqual(guard.renewalCandidateProfileIssue(notice, {
    activeTickets: [{ ...instructor, userTicketId: regular.userTicketId }],
  }), "");
});

for (const classType of ["I", "INSTRUCTOR", " i ", " instructor "]) {
  test(`generation rejects instructor product code ${classType} independently of its display name`, () => {
    const profile = { activeTickets: [{ ...regular, classType }] };
    assert.equal(generation.currentLessonProfileTickets(profile, today).length, 0);
    assert.equal(generation.reservationOpenEligibleGroupTickets(profile, today, "2026-10-04").length, 0);
  });
  test(`presend rejects a source product changed to ${classType} while the old candidate remains regular`, () => {
    assert.notEqual(guard.renewalCandidateProfileIssue(notice, {
      activeTickets: [{ ...regular, classType }],
    }), "");
  });
}

test("private survey presend rejects instructor products even when the booking lessonType remains private", () => {
  const token = "synthetic-token";
  const candidate = { memberId: member.memberId, payload: { accessToken: token } };
  const request = {
    memberId: member.memberId, status: "pending",
    accessTokenHash: createHash("sha256").update(token).digest("hex"),
  };
  const booking = {
    memberId: member.memberId, bookingId: "synthetic-booking", appStatus: "reserved",
    lessonType: "private", ticketClassType: "I", ticketName: instructor.name,
  };
  assert.equal(generation.isPrivateBookingTicket(booking), false);
  assert.notEqual(survey.privateSurveySourceIssue(candidate, request, booking, 0), "");
});

test("group generation excludes instructor products without excluding regular group bookings", () => {
  const booking = { lessonType: "group", ticketName: regular.name, ticketClassType: "G" };
  assert.equal(generation.isGroupBooking(booking), true);
  for (const ticketClassType of ["I", "INSTRUCTOR"]) {
    assert.equal(generation.isGroupBooking({ ...booking, ticketClassType }), false);
  }
  assert.equal(generation.isGroupBooking({ ...booking, ticketName: instructor.name }), false);
});

const lastGroupAttendance = {
  bookingId: "synthetic-attendance", memberId: member.memberId,
  lectureDate: "2026-09-20", appStatus: "reserved", attendanceStatus: "attended",
  lessonType: "group", ticketClassType: "G", ticketName: regular.name,
};
const assessAbsence = (tickets: unknown[], bookings = [lastGroupAttendance]) => absence.assessLongAbsenceTarget({
  profile: { ...member, activeTickets: tickets }, sourceDate: today, bookings,
});

test("long-absence assessment rejects instructor-only holdings by product name and class code", () => {
  for (const ticket of [instructor, { ...regular, classType: "I" }, { ...regular, classType: "INSTRUCTOR" }]) {
    const result = assessAbsence([ticket]);
    assert.equal(result.eligible, false);
    assert.equal(result.issueCode, "no_active_ticket");
  }
});

test("long-absence assessment retains mixed regular holdings and ignores instructor attendance or bookings", () => {
  const bookings = [lastGroupAttendance,
    { ...lastGroupAttendance, bookingId: "instructor-attended", lectureDate: "2026-09-29", ticketClassType: "I", ticketName: instructor.name },
    { ...lastGroupAttendance, bookingId: "instructor-reserved", lectureDate: "2026-10-01", attendanceStatus: "", ticketClassType: "INSTRUCTOR", ticketName: instructor.name },
  ];
  const result = assessAbsence([regular, instructor], bookings);
  assert.equal(result.eligible, true);
  assert.equal(result.lastAttendance.bookingId, lastGroupAttendance.bookingId);
  assert.equal(result.absenceDays, 10);
  assert.deepEqual(Array.from(result.activeTickets, (item: any) => item.userTicketId), [regular.userTicketId]);
});

test("long-absence assessment blocks removed regular holdings and a new regular reservation", () => {
  assert.equal(assessAbsence([]).eligible, false);
  const result = assessAbsence([regular, instructor], [lastGroupAttendance, {
    ...lastGroupAttendance, bookingId: "regular-reserved", lectureDate: "2026-10-01", attendanceStatus: "",
  }]);
  assert.equal(result.eligible, false);
  assert.equal(result.issueCode, "upcoming_reservation");
});

test("membership canary never authorizes group, reservation, long-absence, or other member notices", () => {
  const config = { activationScope: "canary", canaryMemberIds: [member.memberId] };
  const candidate = { type: "membership_welcome", memberId: member.memberId,
    templateCode: welcomeTemplate.MEMBERSHIP_WELCOME_TEMPLATE.templateId };
  assert.equal(canary.isMembershipWelcomeCanaryRecipient(config, candidate), true);
  for (const type of ["group_survey", "private_survey", "reservation_open", "long_absence", "remaining_low", "instructor_lesson_material"]) {
    assert.equal(canary.isMembershipWelcomeCanaryRecipient(config, { ...candidate, type }), false, type);
  }
  assert.equal(canary.isMembershipWelcomeCanaryRecipient(config, { ...candidate, memberId: "other" }), false);
  assert.equal(canary.isMembershipWelcomeCanaryRecipient(config, { ...candidate, templateCode: "other" }), false);
  assert.equal(canary.isMembershipWelcomeCanaryRecipient({ ...config, activationScope: "production" }, candidate), false);
});

test("presend rechecks instructor-only products while preserving mixed regular holdings and independent routes", () => {
  for (const type of ["reservation_open", "new_member"]) {
    const candidate = { ...notice, type };
    assert.notEqual(products.automaticMemberProductIssue(candidate, { activeTickets: [instructor] }), "");
    assert.notEqual(products.automaticMemberProductIssue(candidate, undefined), "");
    assert.equal(products.automaticMemberProductIssue(candidate, { activeTickets: [instructor, regular] }), "");
  }
  for (const type of ["membership_welcome", "instructor_lesson_material", "instructor_lesson_confirmation"]) {
    assert.equal(products.automaticMemberProductIssue({ ...notice, type }, undefined), "");
  }
});

test("group presend rechecks current booking ownership and both instructor classifications", () => {
  const candidate = { ...notice, type: "group_survey" };
  const booking = { memberId: member.memberId, ticketName: regular.name, ticketClassType: "G" };
  assert.equal(products.automaticMemberProductIssue(candidate, undefined, booking), "");
  assert.notEqual(products.automaticMemberProductIssue(candidate, undefined), "");
  assert.notEqual(products.automaticMemberProductIssue(candidate, undefined, { ...booking, memberId: "other" }), "");
  for (const patch of [{ ticketName: instructor.name }, { ticketClassType: " i " }, { ticketType: "INSTRUCTOR" }]) {
    assert.notEqual(products.automaticMemberProductIssue(candidate, undefined, { ...booking, ...patch }), "");
    assert.equal(generation.isGroupBooking({ ...booking, lessonType: "group", ...patch }), false);
    assert.equal(generation.isPrivateBookingTicket({ ...booking, lessonType: "private", ...patch }), false);
  }
});

test("private presend retains normal and semi-private lessons but blocks instructor replacement bookings", () => {
  const accessToken = "synthetic-token";
  const candidate = { ...notice, payload: { accessToken } };
  const request = { memberId: member.memberId, status: "pending", accessTokenHash: createHash("sha256").update(accessToken).digest("hex") };
  for (const lessonType of ["private", "semi_private"]) {
    const booking = { memberId: member.memberId, bookingId: "original", appStatus: "reserved", lessonType, ticketClassType: "P" };
    assert.equal(survey.privateSurveySourceIssue(candidate, request, booking, 0), "");
    assert.notEqual(survey.privateSurveySourceIssue(candidate, request, booking, 0, { ...booking, bookingId: "replacement", ticketType: "INSTRUCTOR" }), "");
  }
});
