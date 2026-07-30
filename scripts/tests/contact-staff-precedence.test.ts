import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ContactSyncJobDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import {
  assertSingleExistingContact,
  chooseRunnableContactJobs,
} from "../../firebase/kangsain-functions/functions/src/sync/contactJobSelection";
import {
  buildActiveStaffContactIndex,
  isProtectedStaffContact,
  shouldSkipProtectedStaffContactJob,
} from "../../firebase/kangsain-functions/functions/src/sync/protectedContactRules";

const activeStaffContacts = buildActiveStaffContactIndex([
  {
    name: "테스트 강사",
    phone: "010-1234-5678",
    active: true,
  },
  {
    name: "퇴사 강사",
    phone: "010-9999-0000",
    active: false,
  },
]);

test("active staff phone takes precedence over a member contact", () => {
  assert.equal(
    isProtectedStaffContact(
      { name: "다른 회원명", phone: "+82 10-1234-5678" },
      activeStaffContacts,
    ),
    true,
  );
});

test("a namesake with a different phone is not treated as staff", () => {
  assert.equal(
    isProtectedStaffContact(
      { name: "테스트 강사", phone: "010-7777-8888" },
      activeStaffContacts,
    ),
    false,
  );
});

test("staff name is used only when no phone is available", () => {
  assert.equal(
    isProtectedStaffContact({ name: "테스트 강사" }, activeStaffContacts),
    true,
  );
});

test("inactive staff is excluded from the dynamic precedence index", () => {
  assert.equal(
    isProtectedStaffContact(
      { name: "퇴사 강사", phone: "010-9999-0000" },
      activeStaffContacts,
    ),
    false,
  );
});

test("legacy protected names are ignored when an active staff index is supplied", () => {
  assert.equal(
    isProtectedStaffContact({ name: "김기효" }, activeStaffContacts),
    false,
  );
  assert.equal(isProtectedStaffContact({ name: "김기효" }), true);
});

test("member jobs are blocked but an explicit staff refresh is allowed", () => {
  const baseJob = {
    memberName: "테스트 강사",
    memberPhone: "01012345678",
  } as ContactSyncJobDoc;

  assert.equal(
    shouldSkipProtectedStaffContactJob(
      { ...baseJob, sourceReason: "member_profile_refresh" },
      activeStaffContacts,
    ),
    true,
  );
  assert.equal(
    shouldSkipProtectedStaffContactJob(
      { ...baseJob, sourceReason: "staff_profile_refresh" },
      activeStaffContacts,
    ),
    false,
  );
});

test("a staff refresh wins when staff and member jobs share one phone", () => {
  const memberJob = {
    jobId: "member-job",
    memberPhone: "01012345678",
    sourceReason: "member_profile_refresh",
  } as ContactSyncJobDoc;
  const staffJob = {
    jobId: "staff-job",
    memberPhone: "01012345678",
    sourceReason: "staff_profile_refresh",
  } as ContactSyncJobDoc;

  assert.deepEqual(
    chooseRunnableContactJobs([
      { job: memberJob, nextRunAtMillis: 1 },
      { job: staffJob, nextRunAtMillis: 2 },
    ]).map((job) => job.jobId),
    ["staff-job"],
  );
});

test("multiple Google contacts remain an explicit failure", () => {
  assert.doesNotThrow(() => assertSingleExistingContact(1));
  assert.throws(() => assertSingleExistingContact(2), /같은 전화번호 연락처가 2개 있습니다/);
});

test("member source paths preserve profiles and record protected jobs as skipped", () => {
  const memberSyncSource = readFileSync(
    new URL(
      "../../firebase/kangsain-functions/functions/src/sync/syncStudioMateMemberProfiles.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const excelImportSource = readFileSync(
    new URL(
      "../../scripts/emergency-import-studiomate-member-excel.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const queueSource = readFileSync(
    new URL(
      "../../firebase/kangsain-functions/functions/src/sync/processContactSyncJobs.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(
    memberSyncSource.indexOf("await refs.memberProfile(member.memberId).set") <
      memberSyncSource.indexOf("if (phone && isProtectedStaffContact"),
  );
  assert.doesNotMatch(
    excelImportSource,
    /if \(isProtectedStaffContact\(group[^)]*\)\) \{\s*skippedProtectedStaffContact \+= 1;\s*continue;/,
  );
  assert.match(
    queueSource,
    /finishProtectedStaffJob[\s\S]*home_archivepilates: "skipped"/,
  );
});
