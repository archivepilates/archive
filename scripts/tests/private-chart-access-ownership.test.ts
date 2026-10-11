import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { matchesPrivateChartBooking, matchesPrivateChartRecord } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChartOwnership";

const requireFunctions = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const ts = requireFunctions("typescript");
const source = fs.readFileSync(new URL("../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", import.meta.url), "utf8");
const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
const names = ["readChartRequest", "publicChartRequest", "previousPrivateLessonReportSummary", "privateLessonReportViewHandler"];
const fragments = tree.statements.filter((node: any) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(fragments.length, names.length);
const code = ts.transpileModule(fragments.map((node: any) => node.getText(tree)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const token = "1234567890abcdef";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const requestId = "plc_owned_record";
const request = (patch = {}) => ({ requestId, staffId: "staff-1", studioId: "studio-1", memberId: "member-1",
  bookingId: "booking-1", lessonDate: "2026-10-11", status: "submitted", sessionNumber: 3,
  accessTokenHash: hash(token), ...patch });
const booking = (patch = {}) => ({ bookingId: "booking-1", staffId: "staff-1", studioId: "studio-1", memberId: "member-1",
  lectureDate: "2026-10-11", lessonType: "private", appStatus: "reserved", ...patch });
const record = (patch = {}) => ({ ...request(), recordId: requestId, gptStatus: "draft_created", postSubmittedAt: 1,
  gptDraftSummary: "OWNED SUMMARY", ...patch });

function runtime(documents: Record<string, any>, previous: Record<string, any> = {}) {
  const reads: string[] = [], writes: string[] = [];
  const snap = (id: string, data: any) => ({ id, exists: Boolean(data), data: () => data });
  const ref = (name: string, id: string) => ({ get: async () => { reads.push(`${name}/${id}`); return snap(id, documents[`${name}/${id}`]); } });
  const refs = {
    booking: (id: string) => ref("bookings", id),
    privateLessonChartRequest: (id: string) => ref("requests", id),
    privateLessonChartRecord: (id: string) => ref("records", id),
    privateLessonChartRecords: () => {
      let rows = Object.entries(previous).map(([id, data]) => snap(id, data));
      const query = { where: (field: string, _op: string, value: any) => { rows = rows.filter(row => row.data()[field] === value); return query; },
        limit: () => query, get: async () => ({ docs: rows }) };
      return query;
    },
  };
  const api = vm.runInNewContext(`${code}\n({${names.join(",")}})`, {
    exports: {}, refs, matchesPrivateChartBooking, matchesPrivateChartRecord, sha256: hash,
    inactivePrivateBookingReason: (row: any) => row.appStatus === "cancelled" ? "cancelled" : "",
    cancelPrivateLessonChartRequest: () => { writes.push("cancel"); throw new Error("Unexpected write"); },
    activePrivateBookingForChartRequest: () => { writes.push("repair"); throw new Error("Unexpected repair"); },
    isPrivateLessonReportGenerated: (row: any) => row?.gptStatus === "draft_created",
    isPrivateLessonReportSent: () => false,
    privateLessonOrderMillis: (row: any) => Date.parse(row.lessonDate),
    cleanEditableReportText: (value: any) => value || "",
    lessonTimeText: () => "20:00",
    latestPrivateSurveyForBooking: async () => null,
    mediaFilesForReport: () => [],
    renderPrivateLessonReportMessagePage: (text: string) => text,
    ensureLegacySentReportSnapshot: async (row: any) => row,
    privateLessonReportSnapshotForView: () => null,
    renderPrivateLessonReportPage: (row: any) => row.gptDraftSummary,
  });
  const response = () => ({ statusCode: 0, body: "", set() {}, status(value: number) { this.statusCode = value; return this; }, send(body: string) { this.body = body; } });
  return { ...api, reads, writes, response };
}
const validDocs = () => ({ [`requests/${requestId}`]: request(), "bookings/booking-1": booking(), [`records/${requestId}`]: record() });

test("owned chart opens with read-only exact identity checks", async () => {
  const r = runtime(validDocs());
  assert.equal((await r.readChartRequest(requestId, token)).staffId, "staff-1");
  assert.deepEqual(r.writes, []);
});
for (const patch of [{ lessonType: "semi_private" }, { lessonType: undefined, ticketName: "프라이빗 20회" }, { lessonType: undefined, lectureTitle: "1:1 레슨" }]) {
  test(`supported private classification retains access: ${JSON.stringify(patch)}`, async () => {
    const r = runtime({ ...validDocs(), "bookings/booking-1": booking(patch) });
    assert.equal((await r.readChartRequest(requestId, token)).staffId, "staff-1");
    assert.deepEqual(r.writes, []);
  });
}
for (const field of ["staffId", "studioId", "memberId", "requestId", "recordId", "bookingId", "lessonDate"]) {
  for (const value of ["other", undefined]) {
    test(`chart and report deny record ${field}=${value} before returning answers`, async () => {
      const docs = validDocs();
      docs[`records/${requestId}`] = record({ [field]: value });
      const r = runtime(docs);
      await assert.rejects(r.readChartRequest(requestId, token));
      await assert.rejects(r.publicChartRequest(request(), "post", docs[`records/${requestId}`]));
      const response = r.response();
      await r.privateLessonReportViewHandler({ query: { r: requestId, t: token } }, response);
      assert.equal(response.statusCode, 403);
      assert.ok(!response.body.includes("OWNED SUMMARY"));
      assert.deepEqual(r.writes, []);
    });
  }
}
for (const patch of [{ staffId: "staff-2" }, { memberId: "member-2" }, { lectureDate: "2026-10-12" }, { bookingId: "different" }, { appStatus: "cancelled" }, { lessonType: "group" }]) {
  test(`changed booking blocks a previously issued staff link: ${JSON.stringify(patch)}`, async () => {
    const r = runtime({ ...validDocs(), "bookings/booking-1": booking(patch) });
    await assert.rejects(r.readChartRequest(requestId, token));
    assert.deepEqual(r.writes, []);
  });
}
test("bad capability token is denied before reading member booking or record", async () => {
  const r = runtime(validDocs());
  await assert.rejects(r.readChartRequest(requestId, "0000000000000000"));
  assert.deepEqual(r.reads, [`requests/${requestId}`]);
});
test("member's valid report capability remains usable without a CORE session", async () => {
  const r = runtime(validDocs());
  const response = r.response();
  await r.privateLessonReportViewHandler({ query: { r: requestId, t: token } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "OWNED SUMMARY");
  assert.deepEqual(r.writes, []);
});
test("report rejects a forged record document ID", async () => {
  const r = runtime({ ...validDocs(), "records/forged": record() });
  const response = r.response();
  await r.privateLessonReportViewHandler({ query: { r: "forged", t: token } }, response);
  assert.equal(response.statusCode, 403);
});
test("same-member previous report never includes another staff/studio or unbound record", async () => {
  const priorId = "plc_prior_owned";
  const prior = record({ recordId: priorId, requestId: priorId, lessonDate: "2026-10-08", sessionNumber: 1, gptDraftSummary: "MY PRIOR" });
  const r = runtime({ ...validDocs(), [`requests/${priorId}`]: request({ requestId: priorId, lessonDate: prior.lessonDate }) }, {
    [priorId]: prior,
    plc_other_staff: record({ recordId: "plc_other_staff", requestId: "plc_other_staff", staffId: "staff-2", lessonDate: "2026-10-10", gptDraftSummary: "OTHER STAFF SECRET" }),
    plc_other_studio: record({ recordId: "plc_other_studio", requestId: "plc_other_studio", studioId: "studio-2", lessonDate: "2026-10-10" }),
    plc_missing_request: record({ recordId: "plc_missing_request", requestId: "plc_missing_request", lessonDate: "2026-10-09" }),
  });
  const result = await r.publicChartRequest(request(), "post", record());
  assert.equal(result.previousReport.summary, "MY PRIOR");
  assert.ok(!JSON.stringify(result).includes("OTHER STAFF SECRET"));
  assert.ok(!r.reads.includes("requests/plc_other_staff"));
  assert.ok(!r.reads.includes("requests/plc_other_studio"));
  assert.deepEqual(r.writes, []);
});
