import type { BookingDoc, MemberMemoDoc, MemberTagDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { saveMemberTags } from "../firestore/memberTagRepository";
import { addDays, nowTimestamp } from "../utils/date";

type MemberTag = MemberTagDoc["tags"][number];

const MEMO_TAG_RULES = [
  { tagId: "waist_caution", label: "허리주의", keywords: ["허리", "요통", "디스크", "척추", "좌골"] },
  { tagId: "neck_shoulder_caution", label: "목어깨주의", keywords: ["목", "어깨", "승모근", "라운드숄더"] },
  { tagId: "knee_caution", label: "무릎주의", keywords: ["무릎", "슬개", "반월상"] },
  { tagId: "wrist_caution", label: "손목주의", keywords: ["손목", "손가락", "터널증후군"] },
  { tagId: "pregnancy_postpartum", label: "임신/산후", keywords: ["임신", "산후", "출산", "산전", "임산부"] },
  { tagId: "intensity_control", label: "강도조절필요", keywords: ["강도", "무리", "약하게", "조절", "힘들", "천천히"] },
  { tagId: "beginner", label: "운동초보", keywords: ["초보", "입문", "운동 처음", "필라테스 처음"] },
  { tagId: "new_member", label: "신규회원", keywords: ["신규", "첫수업", "첫 수업", "체험", "신입"] },
  { tagId: "returning_after_gap", label: "오랜만에 방문", keywords: ["오랜만", "오랫만", "복귀", "오래 쉬"] },
  { tagId: "condition_down", label: "최근 컨디션저하", keywords: ["컨디션", "피곤", "감기", "몸살", "어지러", "저하", "불편"] },
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

  tags.push(
    {
      tagId: `attendance30_attended_${attended}`,
      label: `30일 출석 ${attended}회`,
      level: attended >= 8 ? "positive" : "info",
      source: "auto_attendance",
      updatedAt: now,
    },
    {
      tagId: `attendance30_absent_${absent}`,
      label: `30일 결석 ${absent}회`,
      level: absent >= 3 ? "danger" : "info",
      source: "auto_attendance",
      updatedAt: now,
    },
  );

  const memoTags = buildMemoTags(memos);
  memoTags.forEach((tag) => {
    tags.push({
      tagId: `memo_${tag.ruleId}_${tag.memoId}`,
      label: tag.label,
      level: "warning",
      source: "auto_memo",
      sourceMemoId: tag.memoId,
      sourceDate: tag.sourceDate,
      locked: true,
      updatedAt: now,
    });
  });

  const recentAttended = bookings
    .filter((booking) => booking.attendanceStatus === "attended")
    .sort((a, b) => (b.lectureStartAt?.toMillis() || 0) - (a.lectureStartAt?.toMillis() || 0))
    .slice(0, 10);
  const topStaff = topValue(recentAttended.map((booking) => booking.staffName).filter(Boolean));
  if (topStaff && isMeaningfulPattern(topStaff.count, recentAttended.length)) {
    tags.push({
      tagId: `recent_staff_${topStaff.value}`,
      label: `최근강사 ${topStaff.value} ${topStaff.count}/${recentAttended.length}`,
      level: "info",
      source: "auto_pattern",
      updatedAt: now,
    });
  }

  const topBand = topValue(recentAttended.map((booking) => timeBand(booking.lectureStartAt?.toDate())).filter(Boolean));
  if (topBand && isMeaningfulPattern(topBand.count, recentAttended.length)) {
    tags.push({
      tagId: `time_band_${topBand.value}`,
      label: `${topBand.value}수업 ${topBand.count}/${recentAttended.length}`,
      level: "info",
      source: "auto_pattern",
      updatedAt: now,
    });
  }

  return tags;
}

function buildMemoTags(memos: MemberMemoDoc[]): Array<{ ruleId: string; label: string; memoId: string; sourceDate: string }> {
  const sorted = [...memos].sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  const tags: Array<{ ruleId: string; label: string; memoId: string; sourceDate: string }> = [];
  for (const rule of MEMO_TAG_RULES) {
    const memo = sorted.find((item) => rule.keywords.some((keyword) => item.content.includes(keyword)));
    if (!memo) continue;
    tags.push({
      ruleId: rule.tagId,
      label: rule.label,
      memoId: memo.memoId,
      sourceDate: memoDate(memo),
    });
  }
  return tags.slice(0, 5);
}

function memoDate(memo: MemberMemoDoc): string {
  const date = memo.createdAt?.toDate();
  if (date) return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(date);
  return memo.lectureDate || "";
}

function topValue(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)[0] || null;
}

function isMeaningfulPattern(count: number, total: number): boolean {
  return total >= 5 && count >= 4 && count / total >= 0.6;
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
