import type { Timestamp } from "firebase-admin/firestore";
import { refs } from "./refs";
import { nowTimestamp } from "../utils/date";
import type { DashboardData, DashboardMemberRevenueRow, DashboardMonthlyMemberRow, DashboardSnapshotDoc } from "../types/dashboard";
import { stableHash } from "../utils/hash";

export async function saveDashboardSnapshot(input: {
  data: DashboardData;
  sourceSpreadsheetId: string;
}): Promise<DashboardSnapshotDoc> {
  const snapshotData = compactDashboardSnapshotData(input.data);
  const doc: DashboardSnapshotDoc = {
    snapshotId: "current",
    sourceSpreadsheetId: input.sourceSpreadsheetId,
    syncedAt: nowTimestamp(),
    ...snapshotData,
  };
  await refs.dashboardSnapshot("current").set(doc, { merge: true });
  await saveDashboardMetricDocs(input.data, input.sourceSpreadsheetId, doc.syncedAt);
  return doc;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshotDoc | null> {
  const snap = await refs.dashboardSnapshot("current").get();
  return snap.exists ? snap.data() ?? null : null;
}

async function saveDashboardMetricDocs(
  data: DashboardData,
  sourceSpreadsheetId: string,
  syncedAt: Timestamp,
): Promise<void> {
  await Promise.all([clearCollection(refs.dashboardMemberSales()), clearCollection(refs.dashboardMonthlyMembers())]);

  const firestore = refs.dashboardSnapshots().firestore;
  const batches = [firestore.batch()];
  let writeCount = 0;
  const setDoc = (
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData,
    options: FirebaseFirestore.SetOptions = { merge: true },
  ) => {
    if (writeCount >= 450) {
      batches.push(firestore.batch());
      writeCount = 0;
    }
    batches[batches.length - 1].set(ref, data, options);
    writeCount += 1;
  };

  data.summary.forEach((row) => {
    setDoc(
      refs.dashboardMonthlyMetric(row.월),
      {
        metricId: row.월,
        sourceSpreadsheetId,
        syncedAt,
        ...row,
      },
      { merge: true },
    );
  });

  const salesByKey = new Map(data.강사별.map((row) => [`${row.월}_${row.강사}`, row]));
  data.강사통계.forEach((row) => {
    const sales = salesByKey.get(`${row.월}_${row.강사}`);
    setDoc(
      refs.dashboardInstructorMetric(row.월, row.강사),
      {
        metricId: `${row.월}_${row.강사}`,
        월: row.월,
        강사: row.강사,
        총매출: sales?.총매출 || 0,
        세전총액: sales?.세전총액 || 0,
        실지급액: sales?.실지급액 || 0,
        그룹예약률: row.그룹예약률,
        그룹출석률: row.그룹출석률,
        그룹평균인원: row.그룹평균인원,
        sourceSpreadsheetId,
        syncedAt,
      },
      { merge: true },
    );
  });

  data.수강권TOP5.forEach((row, index) => {
    const monthRowsBefore = data.수강권TOP5.slice(0, index).filter((item) => item.월 === row.월).length;
    const rank = monthRowsBefore + 1;
    setDoc(
      refs.dashboardTicketMetric(row.월, rank),
      {
        metricId: `${row.월}_${rank}`,
        월: row.월,
        라벨: row.라벨,
        값: row.값,
        종류수: row.종류수 || 0,
        rank,
        sourceSpreadsheetId,
        syncedAt,
      },
      { merge: true },
    );
  });

  buildMemberRevenueRows(data).forEach((row) => {
    const metricId = memberSalesMetricId(row.연락처, row.회원명);
    setDoc(
      refs.dashboardMemberSale(metricId),
      {
        metricId,
        sourceSpreadsheetId,
        syncedAt,
        ...row,
      },
      { merge: true },
    );
  });

  buildMonthlyMemberRows(data).forEach((row) => {
    const metricId = `${row.구분}_${row.월}`;
    setDoc(
      refs.dashboardMonthlyMember(metricId),
      {
        metricId,
        sourceSpreadsheetId,
        syncedAt,
        ...row,
      },
      { merge: true },
    );
  });

  await Promise.all(batches.map((batch) => batch.commit()));
}

async function clearCollection(collection: FirebaseFirestore.CollectionReference): Promise<void> {
  while (true) {
    const snap = await collection.limit(450).get();
    if (snap.empty) return;
    const batch = collection.firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

function buildMemberRevenueRows(data: DashboardData): DashboardMemberRevenueRow[] {
  if (data.회원별누적매출?.length) return data.회원별누적매출;
  return data.회원매출
    .map((row) => ({
      회원명: row.memberName,
      연락처: row.memberPhone,
      누적매출: row.totalRevenue,
      최근결제월: row.lastMonth,
      최근수강권명: row.recentTicketName || "",
      최근결제일: row.recentPaymentDate || "",
      보유수강권요약: row.ticketSummary || "",
    }))
    .filter((row) => row.누적매출 > 0 && (row.회원명 || row.연락처));
}

function buildMonthlyMemberRows(data: DashboardData): DashboardMonthlyMemberRow[] {
  if (data.월별회원?.length) return data.월별회원;
  return data.월별이용회원
    .map((row) => ({
      월: row.월,
      구분: "유효" as const,
      회원수: row.이용회원수,
    }))
    .filter((row) => row.월 && row.회원수 > 0);
}

function memberSalesMetricId(phone: string, memberName: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits) return `phone_${digits}`;
  return `name_${stableHash(memberName).slice(0, 20)}`;
}

function compactDashboardSnapshotData(data: DashboardData): DashboardData {
  return {
    ...data,
    회원매출: [...(data.회원매출 || [])].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 500),
    매출일일누적: [...(data.매출일일누적 || [])]
      .sort((a, b) => a.기준일.localeCompare(b.기준일))
      .slice(-180),
  };
}
