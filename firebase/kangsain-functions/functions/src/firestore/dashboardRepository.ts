import type { Timestamp } from "firebase-admin/firestore";
import { refs } from "./refs";
import { nowTimestamp } from "../utils/date";
import type { DashboardData, DashboardSnapshotDoc } from "../types/dashboard";

export async function saveDashboardSnapshot(input: {
  data: DashboardData;
  sourceSpreadsheetId: string;
}): Promise<DashboardSnapshotDoc> {
  const doc: DashboardSnapshotDoc = {
    snapshotId: "current",
    sourceSpreadsheetId: input.sourceSpreadsheetId,
    syncedAt: nowTimestamp(),
    ...input.data,
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
  const batch = refs.dashboardSnapshots().firestore.batch();
  data.summary.forEach((row) => {
    batch.set(
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
    batch.set(
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
    batch.set(
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

  await batch.commit();
}
