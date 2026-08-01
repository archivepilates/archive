#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = parseArgs(process.argv.slice(2));
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = String(args["studio-id"] || process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330");
const DEFAULT_CREDENTIALS = path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json");
const AS_OF_DATE = String(args.date || kstDateKey(new Date()));
const REPORT_PATH = path.resolve(args.report || `docs/reports/${AS_OF_DATE}-studiomate-ticket-liability.html`);
const JSON_PATH = path.resolve(args.json || `artifacts/${AS_OF_DATE}-studiomate-ticket-liability.json`);
const DAY_MS = 86_400_000;

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_CREDENTIALS;
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [profilesSnap, latestImportSnap] = await Promise.all([
    db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get(),
    db.collection("sourceImports").orderBy("importedAt", "desc").limit(30).get(),
  ]);

  const sourceImportDoc = latestImportSnap.docs.find((doc) => doc.data().sourceKind === "studiomate_member_excel");
  const sourceImport = sourceImportDoc ? { id: sourceImportDoc.id, ...sourceImportDoc.data() } : null;
  const { tickets, expiredExcluded } = collectTickets(profilesSnap.docs, AS_OF_DATE);
  const historyUnitPrices = await loadHistoricalUnitPrices(new Set(tickets.map((ticket) => ticket.name)));
  const summary = summarizeTickets(tickets, historyUnitPrices, profilesSnap.size, sourceImport, expiredExcluded);

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  mkdirSync(path.dirname(JSON_PATH), { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(REPORT_PATH, renderHtml(summary));
  console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, jsonPath: JSON_PATH, totals: summary.totals, coverage: summary.coverage }, null, 2));
}

function collectTickets(profileDocs, asOfDate) {
  const tickets = [];
  let expiredExcluded = 0;
  const asOfMs = Date.parse(`${asOfDate}T00:00:00+09:00`);
  for (const doc of profileDocs) {
    const profile = doc.data();
    for (const raw of Array.isArray(profile.activeTickets) ? profile.activeTickets : []) {
      const name = clean(raw.name || raw.ticketName);
      if (!name) continue;
      const endMs = millis(raw.expiresAt || raw.endDate || raw.expireAt);
      if (endMs > 0 && endMs < asOfMs) {
        expiredExcluded += 1;
        continue;
      }
      const period = periodPolicy(name);
      const remaining = period ? periodRemaining(raw, period, asOfDate) : countRemaining(raw);
      const denominator = period?.totalCount || positiveNumber(raw.maxCount ?? raw.totalCount ?? raw.usableCount);
      const paymentAmount = money(raw.paymentAmount ?? raw.amountTotal ?? raw.price);
      tickets.push({
        memberId: doc.id,
        name,
        classType: clean(raw.classType || raw.lessonType) || "미분류",
        status: clean(raw.status || raw.ticketStatus),
        kind: period ? "기간권" : "횟수권",
        paymentAmount,
        denominator,
        remainingCount: remaining.count,
        remainingDays: remaining.days,
        period,
      });
    }
  }
  return { tickets, expiredExcluded };
}

function summarizeTickets(tickets, historyUnitPrices, profileCount, sourceImport, expiredExcluded) {
  const currentUnitsByName = new Map();
  for (const ticket of tickets) {
    const unit = directUnitPrice(ticket);
    if (unit == null) continue;
    const rows = currentUnitsByName.get(ticket.name) || [];
    rows.push(unit);
    currentUnitsByName.set(ticket.name, rows);
  }

  const enriched = tickets.map((ticket) => {
    const directUnit = directUnitPrice(ticket);
    const currentMedian = median(currentUnitsByName.get(ticket.name) || []);
    const historicalMedian = median(historyUnitPrices.get(ticket.name) || []);
    const free = isExplicitFreeTicket(ticket.name);
    const unitPrice = directUnit ?? currentMedian ?? historicalMedian ?? (free ? 0 : null);
    const priceSource = directUnit != null ? "실결제" : currentMedian != null ? "동일권종 중앙값" : historicalMedian != null ? "구매이력 중앙값" : free ? "무료 보상권" : "산정불가";
    return {
      ...ticket,
      unitPrice,
      priceSource,
      residualValue: unitPrice == null ? null : Math.round(ticket.remainingCount * unitPrice),
    };
  });

  const grouped = new Map();
  for (const ticket of enriched) {
    let group = grouped.get(ticket.name);
    if (!group) {
      group = {
        name: ticket.name,
        kind: ticket.kind,
        classTypes: new Set(),
        memberIds: new Set(),
        ticketCount: 0,
        remainingDays: 0,
        remainingCount: 0,
        confirmedResidualValue: 0,
        memberWeightedResidualValue: 0,
        unpricedRemainingCount: 0,
        directUnitPrices: [],
        allUnitPrices: [],
        priceSources: new Map(),
      };
      grouped.set(ticket.name, group);
    }
    group.classTypes.add(ticket.classType);
    group.memberIds.add(ticket.memberId);
    group.ticketCount += 1;
    group.remainingDays += ticket.remainingDays || 0;
    group.remainingCount += ticket.remainingCount || 0;
    const directUnit = directUnitPrice(ticket);
    if (directUnit != null) {
      group.directUnitPrices.push(directUnit);
      group.confirmedResidualValue += Math.round(ticket.remainingCount * directUnit);
    }
    if (ticket.unitPrice != null) {
      group.allUnitPrices.push(ticket.unitPrice);
      group.memberWeightedResidualValue += ticket.residualValue || 0;
    } else {
      group.unpricedRemainingCount += ticket.remainingCount || 0;
    }
    group.priceSources.set(ticket.priceSource, (group.priceSources.get(ticket.priceSource) || 0) + 1);
  }

  const rows = [...grouped.values()]
    .map((group) => {
      const directMedian = median(group.directUnitPrices);
      const valuedMedian = median(group.allUnitPrices);
      const representativeUnitPrice = directMedian ?? valuedMedian;
      const representativePriceSource = directMedian != null ? "현재 실결제 중앙값" : valuedMedian != null ? "구매이력 중앙값/무료권" : "산정불가";
      return {
        name: group.name,
        kind: group.kind,
        classTypes: [...group.classTypes].sort((a, b) => a.localeCompare(b, "ko")),
        holderCount: group.memberIds.size,
        ticketCount: group.ticketCount,
        remainingDays: round1(group.remainingDays),
        remainingCount: round1(group.remainingCount),
        unitPrice: representativeUnitPrice == null ? null : Math.round(representativeUnitPrice),
        unitPriceMin: group.allUnitPrices.length ? Math.round(Math.min(...group.allUnitPrices)) : null,
        unitPriceMax: group.allUnitPrices.length ? Math.round(Math.max(...group.allUnitPrices)) : null,
        representativePriceSource,
        confirmedResidualValue: Math.round(group.confirmedResidualValue),
        memberWeightedResidualValue: Math.round(group.memberWeightedResidualValue),
        estimatedResidualValue: representativeUnitPrice == null ? 0 : Math.round(group.remainingCount * representativeUnitPrice),
        unpricedRemainingCount: round1(group.unpricedRemainingCount),
        directPriceCoverage: ratio(group.directUnitPrices.length, group.ticketCount),
        valuedCoverage: ratio(group.allUnitPrices.length, group.ticketCount),
        priceSources: Object.fromEntries([...group.priceSources.entries()].sort((a, b) => b[1] - a[1])),
      };
    })
    .sort((a, b) => b.estimatedResidualValue - a.estimatedResidualValue || b.remainingCount - a.remainingCount || a.name.localeCompare(b.name, "ko"));

  const directPriced = enriched.filter((ticket) => directUnitPrice(ticket) != null).length;
  const valued = enriched.filter((ticket) => ticket.unitPrice != null).length;
  const zeroPriced = enriched.filter((ticket) => ticket.priceSource === "무료 보상권").length;
  const holderIds = new Set(enriched.map((ticket) => ticket.memberId));
  const countTickets = enriched.filter((ticket) => ticket.kind === "횟수권");
  const periodTickets = enriched.filter((ticket) => ticket.kind === "기간권");
  const estimatedResidualValue = rows.reduce((sum, row) => sum + row.estimatedResidualValue, 0);
  const confirmedResidualValue = rows.reduce((sum, row) => sum + row.confirmedResidualValue, 0);
  const memberWeightedResidualValue = rows.reduce((sum, row) => sum + row.memberWeightedResidualValue, 0);

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: AS_OF_DATE,
    studioId: STUDIO_ID,
    source: {
      collection: "memberProfiles.activeTickets",
      profileCount,
      importId: sourceImport?.id || "",
      sourceFileName: sourceImport?.sourceFileName || "",
      importedAt: sourceImport?.importedAt || "",
      sourceRows: number(sourceImport?.rowCount),
      status: sourceImport?.status || "",
    },
    methodology: {
      representativeUnit: "동일 수강권의 현재 실결제 회당금액 중앙값",
      countTicket: "수강권별 총 잔여횟수 × 대표 회당금액",
      periodTicket: "min(전체 약정회차, 잔여일수 ÷ 7 × 주당횟수) × 대표 회당금액",
      scheduledPeriodTicket: "사용예정 기간권은 전체 약정회차로 계산",
      missingPrice: "동일권종 현재 실결제 회당금액 중앙값 → 구매이력 중앙값 → 명시적 무료 보상권 0원 → 산정불가",
    },
    totals: {
      activeHolders: holderIds.size,
      activeTicketRows: enriched.length,
      ticketTypes: rows.length,
      countTicketRows: countTickets.length,
      periodTicketRows: periodTickets.length,
      remainingCountEquivalent: round1(enriched.reduce((sum, ticket) => sum + ticket.remainingCount, 0)),
      periodRemainingDays: round1(periodTickets.reduce((sum, ticket) => sum + ticket.remainingDays, 0)),
      confirmedResidualValue,
      memberWeightedResidualValue,
      estimatedResidualValue,
      estimatedAdjustment: estimatedResidualValue - confirmedResidualValue,
    },
    coverage: {
      directPricedRows: directPriced,
      directPriceCoverage: ratio(directPriced, enriched.length),
      valuedRows: valued,
      valuedCoverage: ratio(valued, enriched.length),
      zeroPricedRows: zeroPriced,
      unpricedRows: enriched.length - valued,
      unpricedRemainingCount: round1(enriched.filter((ticket) => ticket.unitPrice == null).reduce((sum, ticket) => sum + ticket.remainingCount, 0)),
      expiredExcluded,
    },
    rows,
  };
}

async function loadHistoricalUnitPrices(targetNames) {
  const result = new Map();
  if (!targetNames.size) return result;
  const snapshot = await db.collectionGroup("purchases").get();
  for (const doc of snapshot.docs) {
    const row = doc.data();
    const name = clean(row.ticketName || row.name || row.productName);
    if (!targetNames.has(name)) continue;
    const amount = money(row.amountTotal ?? row.paymentAmount ?? row.price);
    const period = periodPolicy(name);
    const denominator = period?.totalCount || positiveNumber(row.maxCount ?? row.totalCount ?? row.usableCount);
    if (!(amount > 0) || !(denominator > 0)) continue;
    const unit = amount / denominator;
    const rows = result.get(name) || [];
    rows.push(unit);
    result.set(name, rows);
  }
  return result;
}

function directUnitPrice(ticket) {
  if (!(ticket.paymentAmount > 0) || !(ticket.denominator > 0)) return null;
  return ticket.paymentAmount / ticket.denominator;
}

function periodPolicy(name) {
  const match = name.match(/(\d+)\s*주\s*\(\s*주\s*(\d+)\s*회\s*\)/);
  if (!match) return null;
  const weeks = Number(match[1]);
  const weeklyCount = Number(match[2]);
  if (!(weeks > 0) || !(weeklyCount > 0)) return null;
  return { weeks, weeklyCount, totalCount: weeks * weeklyCount, totalDays: weeks * 7 };
}

function periodRemaining(raw, policy, asOfDate) {
  const status = clean(raw.status || raw.ticketStatus);
  const startMs = millis(raw.availableFrom || raw.startDate || raw.issuedAt);
  const endMs = millis(raw.expiresAt || raw.endDate || raw.expireAt);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00+09:00`);
  const scheduled = /사용\s*예정/.test(status) || (startMs > 0 && startMs > asOfMs);
  if (scheduled) return { count: policy.totalCount, days: policy.totalDays };
  const statusDays = Number(status.match(/(\d+)\s*일\s*남음/)?.[1] || "");
  const remainingDays = Number.isFinite(statusDays) && statusDays >= 0 ? statusDays : endMs > 0 ? Math.max(0, Math.ceil((endMs - asOfMs) / DAY_MS)) : 0;
  return { count: Math.min(policy.totalCount, (remainingDays / 7) * policy.weeklyCount), days: Math.min(policy.totalDays, remainingDays) };
}

function countRemaining(raw) {
  return { count: Math.max(0, number(raw.remainingCount ?? raw.remaining) || 0), days: 0 };
}

function isExplicitFreeTicket(name) {
  return /보상\s*쿠폰|무료\s*쿠폰/.test(name);
}

function renderHtml(summary) {
  const maxValue = Math.max(...summary.rows.map((row) => row.estimatedResidualValue), 1);
  const chartRows = summary.rows
    .filter((row) => row.estimatedResidualValue > 0)
    .slice(0, 12)
    .map(
      (row) => `
        <div class="bar-row">
          <div class="bar-head"><strong>${escapeHtml(row.name)}</strong><span>${won(row.estimatedResidualValue)}</span></div>
          <div class="bar-track"><span style="width:${Math.max(1, (row.estimatedResidualValue / maxValue) * 100).toFixed(1)}%"></span></div>
          <small>${formatCount(row.remainingCount)}회 · ${row.holderCount}명</small>
        </div>`,
    )
    .join("");
  const tableRows = summary.rows
    .map((row) => {
      const range = row.unitPriceMin != null && row.unitPriceMax != null && row.unitPriceMin !== row.unitPriceMax ? `<small>${won(row.unitPriceMin)}–${won(row.unitPriceMax)}</small>` : "";
      const sourceText = Object.entries(row.priceSources)
        .map(([source, count]) => `${source} ${count}`)
        .join(" · ");
      return `
        <tr>
          <td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.classTypes.join("/"))} · ${row.kind}</small></td>
          <td>${row.holderCount}명<small>${row.ticketCount}건</small></td>
          <td>${row.kind === "기간권" ? `${formatCount(row.remainingDays)}일<small>${formatCount(row.remainingCount)}회 환산</small>` : `${formatCount(row.remainingCount)}회`}</td>
          <td>${row.unitPrice != null ? won(row.unitPrice) : "산정불가"}${range}</td>
          <td><strong>${won(row.estimatedResidualValue)}</strong><small>${row.representativePriceSource} · ${sourceText || "가격 없음"}</small></td>
          <td><span class="coverage ${row.valuedCoverage === 1 ? "good" : "warn"}">${percent(row.valuedCoverage)}</span></td>
        </tr>`;
    })
    .join("");
  const sourceTime = summary.source.importedAt ? kstDateTime(summary.source.importedAt) : "기록 없음";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>수강권 잔여금액 통계 · ${summary.asOfDate}</title>
  <style>
    :root{--ink:#121212;--muted:#69655f;--line:#ddd8d0;--paper:#f4f2ed;--card:#fff;--accent:#ff4d22;--blue:#2f65f5;--green:#0f7b68;--amber:#ae6f00}
    *{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif;line-height:1.5;overflow-x:clip}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:40px 0 72px}h1,h2,p{margin:0}h1{font-size:clamp(2rem,5vw,4rem);line-height:1.05;letter-spacing:0}.eyebrow{color:var(--accent);font-weight:800;font-size:.82rem;margin-bottom:14px}.lead{max-width:72ch;color:var(--muted);font-size:1rem;margin-top:16px}.source{margin-top:18px;color:var(--muted);font-size:.84rem}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:30px 0}.metric,.panel{background:var(--card);border:1px solid var(--line);border-radius:8px}.metric{padding:22px;min-height:142px}.metric span{display:block;color:var(--muted);font-size:.82rem;font-weight:700}.metric strong{display:block;margin-top:18px;font-size:clamp(1.65rem,3vw,2.5rem);line-height:1}.metric small{display:block;margin-top:10px;color:var(--muted)}.panel{padding:24px;margin-top:16px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:20px}.section-head h2{font-size:1.35rem}.section-head p{color:var(--muted);font-size:.85rem}.grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:16px}.bar-row{padding:10px 0}.bar-head{display:flex;justify-content:space-between;gap:16px;font-size:.88rem}.bar-track{height:8px;background:#edeae4;border-radius:99px;margin:8px 0 5px;overflow:hidden}.bar-track span{display:block;height:100%;background:var(--blue);border-radius:inherit}.bar-row small{color:var(--muted)}.method-list{display:grid;gap:12px}.method{border-top:1px solid var(--line);padding-top:12px}.method:first-child{border-top:0;padding-top:0}.method strong{display:block;font-size:.9rem}.method p{color:var(--muted);font-size:.85rem;margin-top:3px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fff}table{width:100%;border-collapse:collapse;min-width:900px}th,td{text-align:left;padding:14px 12px;border-bottom:1px solid #ebe7e0;vertical-align:top}th{position:sticky;top:0;background:#f8f7f4;color:var(--muted);font-size:.78rem;z-index:1}td{font-size:.88rem}td small{display:block;color:var(--muted);margin-top:3px}.coverage{display:inline-flex;padding:3px 8px;border-radius:99px;font-weight:800;font-size:.75rem}.coverage.good{color:var(--green);background:#e4f5ef}.coverage.warn{color:var(--amber);background:#fff0ce}.note{color:var(--muted);font-size:.84rem;margin-top:14px}.callout{border-left:4px solid var(--accent);padding:4px 0 4px 14px;margin-top:18px}.callout strong{display:block}.callout p{color:var(--muted);font-size:.86rem;margin-top:4px}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}@media(max-width:520px){main{width:min(100% - 24px,1180px);padding-top:24px}.metrics{grid-template-columns:1fr 1fr;gap:8px}.metric{padding:16px;min-height:126px}.metric strong{font-size:1.45rem}.panel{padding:18px}.section-head{align-items:start;flex-direction:column}.lead{font-size:.94rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">ARCHIVE PILATES · STUDIO OPERATIONS</div>
    <h1>수강권 잔여금액 통계</h1>
    <p class="lead">StudioMate 최신 회원목록의 현재·사용예정 수강권을 수강권명별로 집계했습니다. 횟수권은 실제 잔여횟수, 기간권은 남은 기간을 약정 주당 횟수로 환산했습니다.</p>
    <p class="source">기준일 ${summary.asOfDate} · 최신 원본 ${escapeHtml(summary.source.sourceFileName || "확인되지 않음")} · 반영 ${sourceTime}</p>
  </header>

  <section class="metrics" aria-label="핵심 통계">
    <article class="metric"><span>수강권 보유 회원</span><strong>${numberFormat(summary.totals.activeHolders)}명</strong><small>현재·사용예정 포함</small></article>
    <article class="metric"><span>환산 잔여회차</span><strong>${formatCount(summary.totals.remainingCountEquivalent)}회</strong><small>기간권 회차 환산 포함</small></article>
    <article class="metric"><span>전체 잔여금액</span><strong>${won(summary.totals.estimatedResidualValue)}</strong><small>보정 포함 추정치</small></article>
    <article class="metric"><span>직접 결제 커버리지</span><strong>${percent(summary.coverage.directPriceCoverage)}</strong><small>${summary.coverage.directPricedRows}/${summary.totals.activeTicketRows}건</small></article>
  </section>

  <section class="grid">
    <article class="panel">
      <div class="section-head"><div><h2>잔여금액 상위 수강권</h2><p>수강권별 환산 잔여금액</p></div></div>
      ${chartRows}
    </article>
    <article class="panel">
      <div class="section-head"><div><h2>계산 기준</h2><p>실결제 기준, 기간권 회차 환산</p></div></div>
      <div class="method-list">
        <div class="method"><strong>대표 회당금액</strong><p>${escapeHtml(summary.methodology.representativeUnit)}</p></div>
        <div class="method"><strong>횟수권</strong><p>${escapeHtml(summary.methodology.countTicket)}</p></div>
        <div class="method"><strong>기간권</strong><p>${escapeHtml(summary.methodology.periodTicket)}</p></div>
        <div class="method"><strong>사용예정 기간권</strong><p>${escapeHtml(summary.methodology.scheduledPeriodTicket)}</p></div>
        <div class="method"><strong>결제금액 누락</strong><p>${escapeHtml(summary.methodology.missingPrice)}</p></div>
      </div>
      <div class="callout"><strong>대표단가 적용 ${won(summary.totals.estimatedResidualValue)}</strong><p>동일 수강권의 현재 실결제 회당금액 중앙값을 전체 잔여회차에 적용했습니다. 회원별 실결제 연결액 합계는 ${won(summary.totals.confirmedResidualValue)}, 누락 단가를 보정한 회원별 합계는 ${won(summary.totals.memberWeightedResidualValue)}입니다.</p></div>
      <p class="note">명시적 무료 보상쿠폰 ${summary.coverage.zeroPricedRows}건은 0원으로 처리했습니다. 산정불가 ${summary.coverage.unpricedRows}건, 미산정 잔여 ${formatCount(summary.coverage.unpricedRemainingCount)}회입니다. 기준일 이전 만료 ${summary.coverage.expiredExcluded}건은 제외했습니다.</p>
    </article>
  </section>

  <section class="panel">
    <div class="section-head"><div><h2>수강권별 상세</h2><p>${summary.totals.ticketTypes}개 수강권 · ${summary.totals.activeTicketRows}건</p></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>수강권</th><th>보유</th><th>잔여</th><th>대표 회당금액</th><th>전체 잔여금액</th><th>가격 커버리지</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <p class="note">대표 회당금액은 동일 수강권 보유 건의 실결제 회당금액 중앙값입니다. 할인·분할결제로 회원별 실제 회당금액 범위가 다를 수 있으며, 전체 잔여금액은 각 회원 수강권 건별 금액을 계산한 뒤 합산했습니다.</p>
  </section>
</main>
</body>
</html>`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    result[rawKey] = inlineValue ?? (argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true);
  }
  return result;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveNumber(value) {
  const parsed = number(value);
  return parsed > 0 ? parsed : null;
}

function money(value) {
  const parsed = number(value);
  return parsed > 0 ? parsed : null;
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function kstDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function kstDateTime(value) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function numberFormat(value) {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

function formatCount(value) {
  return Number.isInteger(value) ? numberFormat(value) : new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value || 0);
}

function won(value) {
  return `${numberFormat(Math.round(value || 0))}원`;
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
