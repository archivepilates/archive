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
  shouldPreserveExistingContactName,
  shouldSkipProtectedStaffContactJob,
} from "../../firebase/kangsain-functions/functions/src/sync/protectedContactRules";
import { formatStaffContactDisplayName } from "../../firebase/kangsain-functions/functions/src/sync/queueStaffContactSync";
import {
  formatMemberContactDisplayName,
  resolveMemberGrade as resolveRuntimeMemberGrade,
  resolveQueuedMemberContactDisplayName,
} from "../../firebase/kangsain-functions/functions/src/sync/memberContactDisplayName";
import {
  formatExcelMemberContactDisplayName,
  resolveMemberGrade,
} from "../lib/member-contact-display-name-policy.mjs";

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

test("active staff contacts use the ARCHIVE suffix regardless of staff role", () => {
  assert.equal(formatStaffContactDisplayName({ name: "테스트 강사" }), "테스트 강사 아카이브");
  assert.equal(formatStaffContactDisplayName({ name: "  테스트 스텝  " }), "테스트 스텝 아카이브");
});

test("StudioMate instructor members use the instructor-member suffix", () => {
  assert.equal(formatMemberContactDisplayName("테스트 회원", null, "강사회원"), "테스트 회원 강사회원");
  assert.equal(
    formatExcelMemberContactDisplayName({
      name: "테스트 회원",
      compactRegisteredAt: "260810",
      memberGrade: "강사회원",
      activeStaff: false,
    }),
    "테스트 회원 강사회원",
  );
  assert.equal(resolveMemberGrade([{ 등급: "VIP" }, { 등급: "강사회원" }]), "강사회원");
});

test("member sync preserves an existing instructor-member grade when the detail API omits it", () => {
  assert.equal(resolveRuntimeMemberGrade("", "강사회원"), "강사회원");
  assert.equal(resolveRuntimeMemberGrade("VIP", "강사회원"), "VIP");
});

test("a stale queued member name is upgraded from the latest instructor-member profile", () => {
  assert.equal(
    resolveQueuedMemberContactDisplayName("김윤화 회원 260810", "김윤화", "강사회원"),
    "김윤화 강사회원",
  );
  assert.equal(
    resolveQueuedMemberContactDisplayName("홍길동 회원 260810", "홍길동", "VIP"),
    "홍길동 회원 260810",
  );
});

test("active staff precedence remains above instructor-member grade", () => {
  assert.equal(
    formatExcelMemberContactDisplayName({
      name: "테스트 강사",
      compactRegisteredAt: "260810",
      memberGrade: "강사회원",
      activeStaff: true,
    }),
    "테스트 강사 아카이브",
  );
});

test("ordinary member naming stays unchanged and instructor-member names are protected", () => {
  assert.equal(formatMemberContactDisplayName("홍길동", null, "VIP"), "홍길동 회원");
  assert.equal(
    formatExcelMemberContactDisplayName({
      name: "홍길동",
      compactRegisteredAt: "260810",
      memberGrade: "VIP",
      activeStaff: false,
    }),
    "홍길동 회원 260810",
  );
  assert.equal(shouldPreserveExistingContactName("테스트 강사회원"), true);
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
  assert.match(queueSource, /latestMemberContactDisplayName[\s\S]*profile\.memberGrade/);
  assert.match(memberSyncSource, /resolveMemberGrade\(sourceMemberGrade, previousProfile\?\.memberGrade \|\| ""\)/);
});
