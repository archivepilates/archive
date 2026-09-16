import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { isSamePrivateBookingRequest as productionIdentity } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart";

const DECLARATION_NAMES = [
  "findReusableChartRequestForBooking",
  "isSamePrivateBookingRequest",
  "findSourceLinkedNotionMemberPage",
];

function loadPrivateLessonChartDeclarations(): string {
  const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
  const ts = requireFunctions("typescript");
  const source = fs.readFileSync(
    "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts",
    "utf8",
  );
  const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
  const names = new Set(DECLARATION_NAMES);
  const fragments = tree.statements
    .filter((node: any) => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    .map((node: any) => node.getText(tree));
  assert.equal(fragments.length, DECLARATION_NAMES.length, "Expected all target declarations to exist");
  return ts.transpileModule(fragments.join("\n\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const PRIVATE_LESSON_CHART_DECLARATIONS = loadPrivateLessonChartDeclarations();

function makeQuery(docs: any[]) {
  const rows = docs.map((doc) => ({ data: () => doc }));
  const query: any = {
    where: () => query,
    limit: () => query,
    get: async () => ({ docs: rows }),
  };
  return query;
}

function makeNotionRequest(pages: Record<string, any>, calls: string[] = []) {
  return async (endpoint: string, method = "GET") => {
    assert.equal(method, "GET");
    calls.push(endpoint);
    const pageId = endpoint.split("/")[1];
    assert.ok(pageId in pages, `Unexpected notionRequest target: ${endpoint}`);
    return structuredClone(pages[pageId]);
  };
}

function makeRuntime({
  refs,
  notionRequest,
  helpers,
}: {
  refs: any;
  notionRequest: any;
  helpers?: any;
}) {
  const runtime = vm.runInNewContext(
    `${PRIVATE_LESSON_CHART_DECLARATIONS}\n({ findReusableChartRequestForBooking, isSamePrivateBookingRequest, findSourceLinkedNotionMemberPage });`,
    {
      exports: {},
      refs,
      notionRequest,
      ...helpers,
    },
  ) as {
    findReusableChartRequestForBooking: any;
    isSamePrivateBookingRequest: any;
    findSourceLinkedNotionMemberPage: any;
  };
  return runtime;
}

const identityHelpers = {
  staffOccurrenceIdentity: (staffId?: string, staffName?: string) =>
    `${String(staffId || "").trim()}|${String(staffName || "").trim()}`,
  privateLessonOccurrenceKey: (booking: any) => [
    booking.memberId,
    booking.staffId,
    booking.staffName,
    booking.lessonDate || booking.lectureDate,
    booking.startTime,
    booking.lessonType,
  ].join("|"),
  privateChartRequestOccurrenceKey: (request: any) => [
    request.memberId,
    request.staffId,
    request.staffName,
    request.lessonDate,
    request.startTime,
    request.lessonType,
  ].join("|"),
  isAutoBookingCancellationReason: () => false,
  privateChartCancellationSource: () => "private-lesson-chart",
  inactivePrivateBookingReason: () => false,
  chartRequestReuseScore: () => 0,
  NOTION_INSTRUCTOR_CHART_PAGE_IDS: {
    "Instructor A": "root-instructor-a",
    "Instructor B": "root-instructor-b",
  },
};

test("production booking identity uses stable ID, member, instructor and exact timestamp", () => {
  const booking: any = { bookingId: "current", memberId: "member", staffName: "강사", lectureDate: "2026-09-14", lectureStartAt: { toMillis: () => 1000 } };
  const request: any = { requestId: "plc_previous", bookingId: "current", memberId: "member", staffName: "강사", lessonDate: "2026-09-14", lessonStartAt: { toMillis: () => 1000 } };
  assert.equal(productionIdentity(request, booking), true);
  for (const patch of [{ memberId: "other" }, { staffName: "다른강사" }, { bookingId: "old" }, { lessonStartAt: { toMillis: () => 2000 } }]) {
    assert.equal(productionIdentity({ ...request, ...patch }, booking), false);
  }
});

test("findReusableChartRequestForBooking reuses rebound chart request without booking lookup", async () => {
  const bookingLookup: string[] = [];
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRequests: () =>
        makeQuery([
          {
            requestId: "plc_old_request",
            bookingId: "booking-main",
            memberId: "member-1",
            lessonDate: "2026-09-12",
            status: "submitted",
          },
          {
            requestId: "plc_some_other",
            bookingId: "booking-other",
            memberId: "member-1",
            lessonDate: "2026-09-12",
            staffId: "staff-2",
            status: "submitted",
          },
        ]),
      booking: (bookingId: string) => ({
        get: async () => {
          bookingLookup.push(bookingId);
          throw new Error("booking lookup must not happen for rebound request");
        },
      }),
    },
    notionRequest: async () => ({}),
    helpers: identityHelpers,
  });

  const request = await runtime.findReusableChartRequestForBooking({
    bookingId: "booking-main",
    memberId: "member-1",
    lectureDate: "2026-09-12",
  });
  assert.equal(bookingLookup.length, 0);
  assert.equal(request.requestId, "plc_old_request");
});

test("findReusableChartRequestForBooking fails closed when duplicate rebound candidates exist", async () => {
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRequests: () =>
        makeQuery([
          {
            requestId: "plc_dup_a",
            bookingId: "booking-main",
            memberId: "member-1",
            lessonDate: "2026-09-12",
            staffId: "staff-1",
            staffName: "Instructor A",
            status: "draft",
          },
          {
            requestId: "plc_dup_b",
            bookingId: "booking-main",
            memberId: "member-1",
            lessonDate: "2026-09-12",
            staffId: "staff-1",
            staffName: "Instructor A",
            status: "draft",
          },
        ]),
      booking: () => ({ get: async () => ({ data: () => null }) }),
    },
    notionRequest: async () => ({}),
    helpers: identityHelpers,
  });

  await assert.rejects(
    () => runtime.findReusableChartRequestForBooking({
      bookingId: "booking-main",
      memberId: "member-1",
      lectureDate: "2026-09-12",
      staffId: "staff-1",
      staffName: "Instructor A",
    }),
    /동일 예약의 프라이빗 차트 연결이 여러 건입니다\./,
  );
});

test("isSamePrivateBookingRequest rejects same booking with different member, staff, or time identity", () => {
  const runtime = makeRuntime({
    refs: { privateLessonChartRequests: () => makeQuery([]), booking: () => ({ get: async () => ({ data: () => null }) }) },
    notionRequest: async () => ({}),
    helpers: identityHelpers,
  });

  const request = {
    requestId: "plc-match",
    bookingId: "booking-main",
    memberId: "member-1",
    staffId: "staff-1",
    staffName: "Instructor A",
    lessonDate: "2026-09-12",
    startTime: "09:00",
    lessonType: "private",
  };
  const same = {
    bookingId: "booking-main",
    memberId: "member-1",
    staffId: "staff-1",
    staffName: "Instructor A",
    lectureDate: "2026-09-12",
    startTime: "09:00",
    lessonType: "private",
  };
  assert.equal(runtime.isSamePrivateBookingRequest(request, same), true);
  assert.equal(runtime.isSamePrivateBookingRequest({ ...request, memberId: "member-other" }, same), false);
  assert.equal(runtime.isSamePrivateBookingRequest({ ...request, staffName: "Instructor B" }, same), false);
  assert.equal(runtime.isSamePrivateBookingRequest({ ...request, startTime: "10:00" }, same), false);
});

test("findSourceLinkedNotionMemberPage finds renamed member by canonical memberId and staff", async () => {
  const calls: string[] = [];
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "old-record",
            memberId: "member-rename",
            staffId: "instructor-b",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            memberName: "Renamed Name",
            notionSync: { instructorPageId: "old-notion-page" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "old-notion-page": { parent: { page_id: "member-page" } },
      "member-page": { parent: { page_id: "root-instructor-b" } },
    }, calls),
    helpers: identityHelpers,
  });

  const result = await runtime.findSourceLinkedNotionMemberPage({
    recordId: "new-record",
    memberId: "member-rename",
    staffId: "instructor-b",
    staffName: "Instructor B",
    memberName: "Current Renamed",
  });
  assert.equal(result, "member-page");
  assert.equal(calls.join(","), "pages/old-notion-page,pages/member-page");
});

test("findSourceLinkedNotionMemberPage rejects archived source page", async () => {
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "archive-record",
            memberId: "member-archive",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            notionSync: { instructorPageId: "archived-page-id" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "archived-page-id": { archived: true },
    }),
    helpers: identityHelpers,
  });

  await assert.rejects(
    () => runtime.findSourceLinkedNotionMemberPage({
      recordId: "record-2",
      memberId: "member-archive",
      staffName: "Instructor B",
    }),
    /Notion 기존 회원 기록 위치 확인 필요/,
  );
});

test("findSourceLinkedNotionMemberPage allows participant-facing public ancestry", async () => {
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "public-record",
            memberId: "member-public",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            notionSync: { instructorPageId: "public-source-id" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "public-source-id": { parent: { page_id: "member-public-page" } },
      "member-public-page": {
        public_url: "https://notion.site/public",
        parent: { page_id: "root-instructor-b" },
      },
    }),
    helpers: identityHelpers,
  });

  const result = await runtime.findSourceLinkedNotionMemberPage({
    recordId: "record-3",
    memberId: "member-public",
    staffName: "Instructor B",
  });
  assert.equal(result, "member-public-page");
});

test("findSourceLinkedNotionMemberPage rejects archived ancestry", async () => {
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "archived-parent-record",
            memberId: "member-archived-parent",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            notionSync: { instructorPageId: "archived-parent-source" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "archived-parent-source": { parent: { page_id: "member-archived-parent-page" } },
      "member-archived-parent-page": { archived: true, parent: { page_id: "root-instructor-b" } },
    }),
    helpers: identityHelpers,
  });

  await assert.rejects(
    () => runtime.findSourceLinkedNotionMemberPage({
      recordId: "record-archived-parent",
      memberId: "member-archived-parent",
      staffName: "Instructor B",
    }),
    /Notion 회원 기록의 보관 상태 확인 필요/,
  );
});

test("findSourceLinkedNotionMemberPage rejects records outside staff root", async () => {
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "wrong-root-record",
            memberId: "member-wrong-root",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            notionSync: { instructorPageId: "wrong-root-source" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "wrong-root-source": { parent: { page_id: "member-wrong-root-page" } },
      "member-wrong-root-page": { parent: { page_id: "wrong-root-1" } },
      "wrong-root-1": { parent: { page_id: "wrong-root-2" } },
      "wrong-root-2": { parent: { page_id: "" } },
    }),
    helpers: identityHelpers,
  });

  await assert.rejects(
    () => runtime.findSourceLinkedNotionMemberPage({
      recordId: "record-4",
      memberId: "member-wrong-root",
      staffName: "Instructor B",
    }),
    /Notion 회원 기록이 담당 강사 영역 밖에 있습니다\. 연결 확인이 필요합니다\./,
  );
});

test("findSourceLinkedNotionMemberPage excludes alias records", async () => {
  const notionCalls: string[] = [];
  const runtime = makeRuntime({
    refs: {
      privateLessonChartRecords: () =>
        makeQuery([
          {
            recordId: "alias-only",
            memberId: "member-alias",
            staffName: "Instructor B",
            lessonDate: "2026-09-01",
            notionSync: { instructorPageId: "alias-page-id" },
            notionProjectionControl: { aliasOfRecordId: "aliased-source-id" },
          },
        ]),
    },
    notionRequest: makeNotionRequest({
      "alias-page-id": { parent: { page_id: "should-not-be-requested" } },
    }, notionCalls),
    helpers: identityHelpers,
  });

  const result = await runtime.findSourceLinkedNotionMemberPage({
    recordId: "current-alias",
    memberId: "member-alias",
    staffName: "Instructor B",
  });
  assert.equal(result, "");
  assert.equal(notionCalls.length, 0);
});
