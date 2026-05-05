import type { BookingDoc, MemberMemoDoc, MemberTagDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { saveMemberTags } from "../firestore/memberTagRepository";
import { addDays, nowTimestamp } from "../utils/date";

type MemberTag = MemberTagDoc["tags"][number];

const PAIN_KEYWORDS = [
  "통증",
  "허리",
  "목",
  "어깨",
  "무릎",
  "손목",
  "발목",
  "고관절",
  "골반",
  "디스크",
  "부상",
  "재활",
];

export async function rebuildMemberInsights(input: {
  studioId: string;
  endDate: string;
  bookings: BookingDoc[];
}): Promise<void> {
  const periodStart = addDays(input.endDate, -29);
  const rowsByMember = new Map<string, BookingDoc[]>();
  input.bookings
    .filter((booking) => booking.memberId && booking.lectureDate >= periodStart && booking.lectureDate <= input.endDate)
    .forEach((booking) => {
      const list = rowsByMember.get(booking.memberId) || [];
      list.push(booking);
      rowsByMember.set(booking.memberId, list);
    });

  const memberIds = [...rowsByMember.keys()];
  const [memoMap, currentTagMap] = await Promise.all([
    getMemoMap(input.studioId, memberIds),
    getCurrentTagMap(memberIds),
  ]);

  await Promise.all(
    memberIds.map((memberId) => {
      const current = currentTagMap.get(memberId);
      const manualTags = current?.tags.filter((tag) => tag.source === "manual") || [];
      const autoTags = buildAutoTags(rowsByMember.get(memberId) || [], memoMap.get(memberId) || []);
      const tags = [...manualTags, ...autoTags].slice(0, 8);
      const doc: MemberTagDoc = {
        memberId,
        studioId: input.studioId,
        tags,
        updatedAt: nowTimestamp(),
      };
      return saveMemberTags(doc);
    }),
  );
}

async function getCurrentTagMap(memberIds: string[]): Promise<Map<string, MemberTagDoc>> {
  const snaps = await Promise.all(memberIds.map((memberId) => refs.memberTag(memberId).get()));
  return new Map(
    snaps
      .map((snap) => snap.data())
      .filter((doc): doc is MemberTagDoc => Boolean(doc))
      .map((doc) => [doc.memberId, doc]),
  );
}

async function getMemoMap(studioId: string, memberIds: string[]): Promise<Map<string, MemberMemoDoc[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < memberIds.length; i += 10) chunks.push(memberIds.slice(i, i + 10));
  const snaps = await Promise.all(
    chunks.map((chunk) =>
      refs.memberMemos().where("studioId", "==", studioId).where("memberId", "in", chunk).limit(200).get(),
    ),
  );
  const map = new Map<string, MemberMemoDoc[]>();
  snaps
    .flatMap((snap) => snap.docs.map((doc) => doc.data()))
    .forEach((memo) => {
      const list = map.get(memo.memberId) || [];
      list.push(memo);
      map.set(memo.memberId, list);
    });
  return map;
}

function buildAutoTags(bookings: BookingDoc[], memos: MemberMemoDoc[]): MemberTag[] {
  const now = nowTimestamp();
  const tags: MemberTag[] = [];
  const attended = bookings.filter((booking) => booking.attendanceStatus === "attended").length;
  const absent = bookings.filter((booking) => booking.attendanceStatus === "absent" || booking.attendanceStatus === "late_cancel").length;

  tags.push({
    tagId: `attended30_${attended}`,
    label: `30일 출석 ${attended}회`,
    level: attended >= 8 ? "positive" : "info",
    source: "auto_attendance",
    updatedAt: now,
  });

  if (absent > 0) {
    tags.push({
      tagId: `absent30_${absent}`,
      label: `30일 결석 ${absent}회`,
      level: absent >= 3 ? "danger" : "warning",
      source: "auto_attendance",
      updatedAt: now,
    });
  }

  const painLabels = painTags(memos);
  painLabels.forEach((label) => {
    tags.push({
      tagId: `pain_${label}`,
      label,
      level: "warning",
      source: "auto_memo",
      updatedAt: now,
    });
  });

  const recent = bookings
    .filter((booking) => booking.appStatus === "reserved")
    .sort((a, b) => (b.lectureStartAt?.toMillis() || 0) - (a.lectureStartAt?.toMillis() || 0))
    .slice(0, 10);
  const topStaff = topValue(recent.map((booking) => booking.staffName).filter(Boolean));
  if (topStaff && topStaff.count >= 3) {
    tags.push({
      tagId: `recent_staff_${topStaff.value}`,
      label: `최근강사 ${topStaff.value}`,
      level: "info",
      source: "auto_pattern",
      updatedAt: now,
    });
  }

  const topBand = topValue(recent.map((booking) => timeBand(booking.lectureStartAt?.toDate())).filter(Boolean));
  if (topBand && topBand.count >= 3) {
    tags.push({
      tagId: `time_band_${topBand.value}`,
      label: `${topBand.value} 선호`,
      level: "info",
      source: "auto_pattern",
      updatedAt: now,
    });
  }

  return tags;
}

function painTags(memos: MemberMemoDoc[]): string[] {
  const text = memos
    .map((memo) => memo.content)
    .join(" ")
    .toLowerCase();
  return PAIN_KEYWORDS.filter((word) => text.includes(word)).slice(0, 3).map((word) => `주의 ${word}`);
}

function topValue(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)[0] || null;
}

function timeBand(date?: Date): string {
  if (!date) return "";
  const hour = Number(
    new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(date),
  );
  if (hour < 12) return "오전";
  if (hour < 17) return "오후";
  return "저녁";
}
