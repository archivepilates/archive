import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
const ts = require("typescript");
const source = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
const declaration = tree.statements.find((n: any) => ts.isFunctionDeclaration(n) && n.name?.text === "isPrivateLessonReportSent");
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(tree), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sent = vm.runInNewContext(`${code}\nisPrivateLessonReportSent`);

test("every persisted send marker locks instructor mutations without requiring a duplicated status", () => {
  for (const record of [
    { sentRevision: "sent-revision" },
    { publicReportApproval: { status: "sent" } },
    { publicReportApproval: { sentAt: { seconds: 1 } } },
    { publicReportSentAt: { seconds: 1 } },
    { gptStatus: "published" },
  ]) assert.equal(sent(record), true);
});

test("draft, approval, preparation and absent records do not claim dispatch", () => {
  for (const record of [null, undefined, {}, { reportRevision: "draft" },
    { approvedRevision: "approved" }, { sentRevision: "" },
    { publicReportApproval: { status: "queued" } }, { gptStatus: "draft_created" }])
    assert.equal(sent(record), false);
});

test("approved instructor chart root has exact aliases without changing existing roots", () => {
  const mapping = tree.statements.find((n: any) => ts.isVariableStatement(n)
    && n.declarationList.declarations.some((d: any) => d.name?.text === "NOTION_INSTRUCTOR_CHART_PAGE_IDS"));
  assert.ok(mapping);
  const mappingCode = ts.transpileModule(mapping.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const roots = vm.runInNewContext(`${mappingCode}\nNOTION_INSTRUCTOR_CHART_PAGE_IDS`);
  assert.equal(roots["정유리"], "3ffd49eae4bf817dbe47e7be0e6ee4f6");
  assert.equal(roots["정유리 강사"], roots["정유리"]);
  assert.equal(roots["이초림"], "22cd49eae4bf802ebc89fe094d0c355a");
  assert.equal(roots["배민진"], "22dd49eae4bf80258427fe92a4b6ce2c");
  assert.equal(roots["정은영"], "22dd49eae4bf809da7e7d6953e41eb86");
  assert.equal(roots["김기효"], "36ed49eae4bf8161a0d3edd9f30643b9");
  assert.equal(roots["Unknown Instructor"], undefined);
});

function scheduleRepairHarness(sentRevision: string) {
  const names = new Set([
    "syncChartRequestToActiveBooking", "isPrivateLessonReportSent", "compactObject",
    "normalizePhone", "normalizeKoreanName", "pendingNotionProjection",
    "isAutoBookingCancellationReason", "privateChartCancellationSource",
    "isAutoPrivateChartReviewReason", "chartRequestStatusFromSubmissions",
  ]);
  const declarations = tree.statements.filter((n: any) =>
    ts.isFunctionDeclaration(n) && names.has(n.name?.text));
  assert.equal(declarations.length, names.size, "Exercise actual production repair and sent-state declarations");
  const repairCode = ts.transpileModule(declarations.map((n: any) => n.getText(tree)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const request = {
    requestId: "plc_synthetic", recordId: "plc_synthetic", bookingId: "booking-synthetic",
    lectureId: "lecture-synthetic", staffId: "staff-synthetic", staffName: "Synthetic Instructor",
    staffPhone: "01000000000", lessonDate: "2026-10-19", lessonStartAt: null,
    lessonEndAt: null, sessionNumber: 1, status: "completed", postStatus: "submitted",
  };
  const record = {
    ...request, sentRevision, reportRevision: "approved-revision", approvedRevision: "approved-revision",
    approvedReportSnapshot: { revision: "approved-revision", summary: "Approved synthetic summary" },
    publicReportApproval: { status: "queued", candidateId: "candidate-synthetic", approvedBy: "staff-synthetic" },
    gptStatus: "draft_created", postRecord: { nextDirection: "Synthetic next direction" },
  };
  const candidate = { status: "queued", sourceActionKey: request.requestId, reportRevision: "approved-revision" };
  const booking = {
    bookingId: request.bookingId, lectureId: request.lectureId, staffId: request.staffId,
    staffName: request.staffName, lectureDate: "2026-10-20", lectureStartAt: null, lectureEndAt: null,
  };
  const requestKey = `requests/${request.requestId}`;
  const recordKey = `records/${request.requestId}`;
  const candidateKey = "candidates/candidate-synthetic";
  const documents = new Map<string, any>([
    [requestKey, structuredClone(request)], [recordKey, structuredClone(record)],
    [candidateKey, structuredClone(candidate)],
  ]);
  const writes: { key: string; patch: any; transaction: boolean }[] = [];
  const reads: string[] = [];
  const invalidations: { recordId: string; reason: string }[] = [];
  const revisions: any[] = [];
  const stageWrite = (key: string, patch: any, transaction: boolean) => {
    assert.ok(documents.has(key), `Unexpected write: ${key}`);
    return { key, patch: structuredClone(patch), transaction };
  };
  const commit = (write: typeof writes[number]) => {
    documents.set(write.key, { ...documents.get(write.key), ...write.patch });
    writes.push(write);
  };
  let transactionOpen = false;
  const reference = (key: string) => {
    assert.ok(documents.has(key), `Unexpected reference: ${key}`);
    return {
      key,
      set: async (patch: any, options: any) => {
        assert.equal(transactionOpen, false, "Document writes inside repair must use its transaction");
        assert.equal(key, recordKey, "Only the final Notion-pending record write is allowed outside the transaction");
        assert.deepEqual(structuredClone(options), { merge: true });
        commit(stageWrite(key, patch, false));
      },
    };
  };
  const repair = vm.runInNewContext(`${repairCode}\nsyncChartRequestToActiveBooking`, {
    refs: {
      staff: (id: string) => {
        assert.equal(id, request.staffId);
        return { get: async () => ({ data: () => ({ phone: request.staffPhone }) }) };
      },
      privateLessonChartRequest: (id: string) => reference(`requests/${id}`),
      privateLessonChartRecord: (id: string) => reference(`records/${id}`),
      alimtalkCandidate: (id: string) => reference(`candidates/${id}`),
    },
    db: {
      runTransaction: async (callback: any) => {
        assert.equal(transactionOpen, false);
        transactionOpen = true;
        const pending: typeof writes = [];
        try {
          const result = await callback({
            get: async (ref: any) => {
              assert.equal(pending.length, 0, "Firestore transaction reads must precede writes");
              assert.ok(documents.has(ref.key), `Unexpected read: ${ref.key}`);
              reads.push(ref.key);
              return { exists: true, data: () => structuredClone(documents.get(ref.key)) };
            },
            set: (ref: any, patch: any, options: any) => {
              assert.deepEqual(structuredClone(options), { merge: true });
              pending.push(stageWrite(ref.key, patch, true));
            },
            update: (ref: any, patch: any) => pending.push(stageWrite(ref.key, patch, true)),
          });
          pending.forEach(commit);
          return result;
        } finally {
          transactionOpen = false;
        }
      },
    },
    nextSessionNumber: async () => 2,
    nowTimestamp: () => "synthetic-now",
    currentPrivateLessonReportRevision: (updated: any) => {
      revisions.push(structuredClone(updated));
      return "repaired-revision";
    },
    invalidatePendingPrivateLessonReportCandidates: async (recordId: string, reason: string) => {
      invalidations.push({ recordId, reason });
    },
  });
  return {
    request, record, candidate, booking, writes, reads, invalidations, revisions,
    requestKey, recordKey, candidateKey, documents,
    run: () => repair(structuredClone(request), booking, "synthetic_schedule_repair"),
  };
}

test("actual schedule repair preserves approval snapshot and candidate with sentRevision-only evidence", async () => {
  const h = scheduleRepairHarness("sent-revision");
  const result = await h.run();
  const saved = h.documents.get(h.recordKey);
  assert.equal(result.lessonDate, h.booking.lectureDate);
  assert.equal(result.sessionNumber, 2);
  assert.equal(saved.lessonDate, h.booking.lectureDate);
  assert.equal(saved.sessionNumber, 2);
  assert.equal(saved.sentRevision, "sent-revision");
  assert.equal(saved.reportRevision, h.record.reportRevision);
  assert.equal(saved.approvedRevision, h.record.approvedRevision);
  assert.deepEqual(saved.approvedReportSnapshot, h.record.approvedReportSnapshot);
  assert.deepEqual(saved.publicReportApproval, h.record.publicReportApproval);
  assert.deepEqual(saved.postRecord, h.record.postRecord);
  assert.deepEqual(h.documents.get(h.candidateKey), h.candidate);
  assert.equal(h.reads.includes(h.candidateKey), false);
  assert.equal(h.writes.some((write) => write.key === h.candidateKey), false);
  assert.deepEqual(h.invalidations, []);
  assert.deepEqual(h.revisions, []);
  assert.equal(saved.notionSync.status, "pending");
});

test("actual schedule repair invalidates queued unsent approval and holds its candidate", async () => {
  const h = scheduleRepairHarness("");
  const result = await h.run();
  const saved = h.documents.get(h.recordKey);
  assert.equal(result.lessonDate, h.booking.lectureDate);
  assert.equal(result.sessionNumber, 2);
  assert.equal(saved.lessonDate, h.booking.lectureDate);
  assert.equal(saved.sessionNumber, 2);
  assert.equal(saved.sentRevision, "");
  assert.equal(saved.reportRevision, "repaired-revision");
  assert.equal(saved.approvedRevision, "");
  assert.equal(saved.approvedReportSnapshot, null);
  assert.equal(saved.publicReportApproval.status, "pending");
  assert.equal(saved.publicReportApproval.candidateId, null);
  assert.equal(saved.publicReportApproval.approvedBy, h.record.publicReportApproval.approvedBy);
  assert.deepEqual(saved.postRecord, h.record.postRecord);
  const candidate = h.documents.get(h.candidateKey);
  assert.equal(candidate.status, "skipped");
  assert.equal(candidate.reasonCode, "private_report_schedule_changed");
  assert.equal(candidate.sourceActionKey, h.candidate.sourceActionKey);
  assert.equal(candidate.reportRevision, h.candidate.reportRevision);
  assert.equal(h.reads.includes(h.candidateKey), true);
  assert.equal(h.writes.filter((write) => write.key === h.candidateKey && write.transaction).length, 1);
  assert.equal(h.invalidations.length, 1);
  assert.equal(h.invalidations[0].recordId, h.request.requestId);
  assert.equal(h.revisions.length, 1);
  assert.equal(h.revisions[0].lessonDate, h.booking.lectureDate);
  assert.equal(h.revisions[0].sessionNumber, 2);
  assert.equal(saved.notionSync.status, "pending");
});
