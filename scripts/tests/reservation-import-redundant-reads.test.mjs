import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../emergency-import-studiomate-reservation-excel.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function rebuildInstructorViews(");
const end = source.indexOf("async function rebuildAttendanceSummaries(", start);
assert.ok(start >= 0 && end > start);

async function rebuild(lectures, bookings) {
  const reads = [];
  const writes = [];
  const db = {
    collection(name) {
      const filters = [];
      return {
        where(...filter) { filters.push(filter); return this; },
        async get() {
          reads.push({ name, filters });
          assert.ok(["lectures", "bookings"].includes(name));
          return { docs: (name === "lectures" ? lectures : bookings).map((data) => ({ data: () => data })) };
        },
        doc(id) {
          assert.equal(name, "instructorViews");
          return { async set(data, options) { writes.push({ id, data, options }); } };
        },
      };
    },
  };
  const context = {
    db,
    STUDIO_ID: "5330",
    admin: { firestore: { Timestamp: { now: () => 123 } } },
    cleanText: (value) => String(value || "").trim(),
    lectureTimeText: () => "10:00",
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.run = rebuildInstructorViews;`, context);
  await context.run([{ staffId: "staff1", date: "2026-09-27" }]);
  return JSON.parse(JSON.stringify({ reads, writes }));
}

for (const [name, lectures] of [
  ["no lectures", []],
  ["only deleted lectures", [{ lectureId: "old", status: "deleted" }]],
  ["no usable lecture IDs", [{ status: "open" }, { lectureId: "", status: "open" }]],
]) {
  test(`${name}: skip booking read but still clear the instructor view`, async () => {
    const { reads, writes } = await rebuild(lectures, [{ bookingId: "old-booking", lectureId: "old", appStatus: "reserved" }]);
    assert.deepEqual(reads.map((read) => read.name), ["lectures"]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].id, "staff1_2026-09-27");
    assert.deepEqual(writes[0].options, { merge: true });
    assert.equal(writes[0].data.summary.totalBookings, 0);
    assert.equal(writes[0].data.summary.cancelCount, 0);
    assert.equal(writes[0].data.summary.waitCount, 0);
    assert.ok(writes[0].data.lectures.every((lecture) => lecture.bookings.length === 0));
    assert.equal(writes[0].data.summary.totalLectures, lectures.filter((lecture) => lecture.status !== "deleted").length);
  });
}

test("active lectures retain the original booking query, statuses and document identities", async () => {
  const bookings = ["reserved", "cancel", "wait", "wait_cancel", "superseded"].map((appStatus) => ({
    bookingId: `booking-${appStatus}`, lectureId: "active", appStatus, attendanceStatus: "unchecked",
  }));
  const { reads, writes } = await rebuild(
    [{ lectureId: "active", status: "open" }, { lectureId: "old", status: "deleted" }],
    [...bookings, { bookingId: "deleted-lecture-booking", lectureId: "old", appStatus: "reserved" }],
  );
  assert.deepEqual(reads, [
    { name: "lectures", filters: [["studioId", "==", "5330"], ["staffId", "==", "staff1"], ["date", "==", "2026-09-27"]] },
    { name: "bookings", filters: [["studioId", "==", "5330"], ["staffId", "==", "staff1"], ["lectureDate", "==", "2026-09-27"]] },
  ]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.summary, {
    totalLectures: 1, totalBookings: 1, uncheckedAttendanceCount: 1,
    reservedCount: 1, cancelCount: 2, waitCount: 1,
  });
  assert.deepEqual(writes[0].data.lectures[0].bookings.map((booking) => [booking.bookingId, booking.appStatus]),
    bookings.map((booking) => [booking.bookingId, booking.appStatus]));
});
