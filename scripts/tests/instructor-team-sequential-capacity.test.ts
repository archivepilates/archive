import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstructorLessonScheduleSummaries,
  INSTRUCTOR_LESSON_DEFAULT_CAPACITY,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";

const date = "2099-06-20";
const at = (time: string) => `${date}T${time}:00+09:00`;
function lecture(id: string, start: string, end: string, capacity: unknown = 6): Record<string, any> {
  return { lectureId: id, studioId: "5330", date, title: "강사레슨 (Team)",
    startAt: at(start), endAt: at(end), capacity };
}
const pair = () => [lecture("synthetic-first", "14:00", "14:50"), lecture("synthetic-second", "15:00", "15:50")];
function withReadbackEvidence(row: Record<string, any>, id: string) {
  return {...row,capacity:null,staffName:'Synthetic teacher',roomName:'Synthetic room',capacityEvidence:{
    ...row,staffName:'Synthetic teacher',roomName:'Synthetic room',source:'studiomate_lecture_list_readback',complete:true,
    nativeLectureId:id,capacity:6,proofHash:'a'.repeat(64),capturedAt:'2099-06-01T00:00:00Z',
    sourceUrl:`https://arcpilates.studiomate.kr/lecture/detail?id=${id}`,
    sourcePath:`/v2/staff/lectures?start_date=${date}&end_date=${date}&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile`}};
}
test('complete bound native list evidence survives a later nullable Excel capacity',()=>{
  const rows=pair().map((r,i)=>withReadbackEvidence(r,String(9001+i)));
  assert.equal(summary(rows).capacitySource,'lecture');assert.equal(summary(rows).capacity,6);
});
for(const key of ['complete','proofHash','sourcePath','date','title','staffName','roomName','startAt','endAt']) {
  test(`mismatched native list evidence ${key} cannot verify capacity`,()=>{
    const rows=pair().map((r,i)=>withReadbackEvidence(r,String(9001+i)));
    rows[0].capacityEvidence[key]=key==='complete'?false:'invalid';
    assert.equal(summary(rows).capacitySource,'default');
  });
}
function summary(lectures: Record<string, any>[], team = true) {
  const registrations = team ? Array.from({ length: 6 }, (_, index) => ({
    registrationId: `synthetic-${index}`, memberId: `synthetic-member-${index}`, memberName: `Synthetic ${index}`,
    courseKind: "team", lessonDate: date, lessonTime: "14:00", lessonTopic: "Synthetic Team topic",
    status: "action_required", operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
  })) : [];
  return buildInstructorLessonScheduleSummaries({ startDate: date, endDate: date, lectures, registrations })[0];
}

test("two sequential Team sessions of six verify capacity six, not twelve", () => {
  const result = summary(pair());
  assert.equal(result.metadataSource, "registration");
  assert.equal(result.sessionCount, 2);
  assert.equal(result.startAt, new Date(at("14:00")).toISOString());
  assert.equal(result.endAt, new Date(at("15:50")).toISOString());
  assert.equal(result.capacitySource, "lecture");
  assert.equal(result.capacity, 6);
  assert.equal(result.occupiedCount, 6);
  assert.equal(result.remainingSeats, 0);
});

test("sequential Team capacity is the bottleneck five even when six is first", () => {
  for (const capacities of [[5, 6], [6, 5]]) {
    const rows = pair().map((row, index) => ({ ...row, capacity: capacities[index] }));
    const result = summary(rows);
    assert.equal(result.capacitySource, "lecture");
    assert.equal(result.capacity, 5);
    assert.equal(result.overbookedCount, 1);
    assert.equal(result.remainingSeats, 0);
  }
});

test("unordered source rows are normalized without mutating their order", () => {
  const rows = pair().reverse(), before = JSON.stringify(rows);
  assert.equal(summary(rows).capacity, 6);
  assert.equal(JSON.stringify(rows), before);
});

test("same-start Team rooms sum, then sequential slots take the minimum", () => {
  const result = summary([lecture("parallel-a", "14:00", "14:50", 3),
    lecture("parallel-b", "14:00", "14:50", 3), lecture("later", "15:00", "15:50", 5)]);
  assert.equal(result.metadataSource, "registration");
  assert.equal(result.sessionCount, 3);
  assert.equal(result.capacitySource, "lecture");
  assert.equal(result.capacity, 5);
});

for (const [label, patch] of [
  ["missing start", { startAt: null }], ["invalid start", { startAt: "not-a-time" }],
  ["missing end", { endAt: null }], ["invalid end", { endAt: "not-a-time" }],
  ["reversed interval", { endAt: at("13:50") }], ["empty interval", { endAt: at("14:00") }],
  ["ordinary instructor title", { title: "강사레슨 (2T)" }],
  ["earliest start mismatch", { startAt: at("13:00") }],
] as const) {
  test(`Team ${label} produces a conflict, not verified capacity`, () => {
    const rows = pair(); rows[0] = { ...rows[0], ...patch };
    const result = summary(rows);
    assert.equal(result.metadataSource, "conflict");
    assert.equal(result.capacitySource, "default");
    assert.equal(result.capacity, INSTRUCTOR_LESSON_DEFAULT_CAPACITY);
    assert.equal(result.startAt, null);
    assert.equal(result.endAt, null);
  });
}

test("partially overlapping distinct Team starts are rejected, including a longer parallel room", () => {
  for (const rows of [
    [lecture("first", "14:00", "14:50"), lecture("overlap", "14:30", "15:20")],
    [lecture("parallel-a", "14:00", "14:50", 3), lecture("parallel-b", "14:00", "15:10", 3), lecture("later", "15:00", "15:50")],
  ]) assert.equal(summary(rows).metadataSource, "conflict");
});

for (const capacity of [null, undefined, 0, -1, 1.5, "6", NaN, Infinity]) {
  test(`Team incomplete/invalid capacity ${String(capacity)} cannot verify any surviving slot`, () => {
    const rows = pair(); rows[1] = { ...rows[1], capacity };
    const result = summary(rows);
    assert.equal(result.metadataSource, "registration");
    assert.equal(result.capacitySource, "default");
    assert.equal(result.capacity, INSTRUCTOR_LESSON_DEFAULT_CAPACITY);
  });
}

test("missing capacity in one same-start Team room invalidates the complete event capacity", () => {
  const result = summary([lecture("parallel-a", "14:00", "14:50", 3),
    { ...lecture("parallel-b", "14:00", "14:50", 3), capacity: null }, lecture("later", "15:00", "15:50")]);
  assert.equal(result.capacitySource, "default");
});

test("Team lecture-only source uses the same bottleneck without an intake time assertion", () => {
  const rows = pair(); rows[1].capacity = 5;
  const result = summary(rows, false);
  assert.equal(result.capacitySource, "lecture");
  assert.equal(result.capacity, 5);
});

test("regular simultaneous rooms still sum and sequential slots still use the existing maximum", () => {
  const rows = [lecture("regular-a", "14:00", "14:50", 5), lecture("regular-b", "14:00", "14:50", 6),
    lecture("regular-later", "15:00", "15:50", 4)].map(row => ({ ...row, title: "강사레슨 (2T)" }));
  const result = summary(rows, false);
  assert.equal(result.capacitySource, "lecture");
  assert.equal(result.capacity, 11);
});

test("regular missing-capacity slot preserves the previous valid-slot maximum behavior", () => {
  const rows = pair().map(row => ({ ...row, title: "강사레슨 (2T)" }));
  rows[1].capacity = null;
  assert.equal(summary(rows, false).capacity, 6);
});
