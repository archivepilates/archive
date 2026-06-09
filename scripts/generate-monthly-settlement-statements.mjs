#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const HOME = os.homedir();
const DEFAULT_ROOT = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-kihyo2215@gmail.com/내 드라이브/10_업무/아카이브필라테스/아카이브필라테스/03_재무_대출_정산/아카이브 월말정산",
);
const args = parseArgs(process.argv.slice(2));
const ym = String(args.month || previousMonthYyyyMm());
const rootDir = expandHome(String(args.root || process.env.ARCHIVE_MONTHLY_SETTLEMENT_ROOT || DEFAULT_ROOT));
const targetDir = path.join(rootDir, ym);
const statementXlsx = path.join(targetDir, `아카이브 정산명세서 ${ym}.xlsx`);
const settlementXlsx = path.join(targetDir, `아카이브 정산 ${ym}.xlsx`);
const apply = Boolean(args.apply);

main();

function main() {
  mkdirSync(targetDir, { recursive: true });
  if (!existsSync(statementXlsx)) throw new Error(`정산명세서 원본을 찾을 수 없습니다: ${statementXlsx}`);
  const statement = readStatementWorkbook(statementXlsx);
  const previous = readPreviousSummary(rootDir, ym);
  const operation = existsSync(settlementXlsx) ? readOperationWorkbook(settlementXlsx) : null;
  const summary = buildSummary(statement.instructors, previous?.totalPayout || 0, operation);
  const files = [];
  for (const instructor of statement.instructors) {
    const html = renderInstructorHtml({ ym, instructor, generatedAt: new Date() });
    const fileName = `아카이브 정산명세서 ${ym} ${instructor.name}.html`;
    const outputPath = path.join(targetDir, fileName);
    if (apply) writeFileSync(outputPath, html);
    files.push({ name: instructor.name, fileName, payout: instructor.finalPayout });
  }
  const indexHtml = renderIndexHtml({ ym, summary, files, generatedAt: new Date() });
  const indexPath = path.join(targetDir, `아카이브 정산명세서 ${ym}_INDEX.html`);
  if (apply) writeFileSync(indexPath, indexHtml);

  const result = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    month: ym,
    targetDir,
    statementXlsx,
    settlementXlsx: existsSync(settlementXlsx) ? settlementXlsx : "",
    indexPath,
    instructorFiles: files.length,
    summary,
  };
  console.log(JSON.stringify(result, null, 2));
}

function readStatementWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const info = rows(wb, "강사정보");
  const ledger = rows(wb, "정산대장");
  const infoByName = new Map();
  for (const row of info.slice(4)) {
    const name = clean(row[1]);
    if (!name) continue;
    infoByName.set(name, {
      name,
      role: clean(row[2]),
      groupGrade: clean(row[3]),
      privateGrade: clean(row[4]),
      bank: clean(row[5]),
      account: clean(row[6]),
      accountHolder: clean(row[7]),
    });
  }
  const instructors = ledger
    .slice(4)
    .filter((row) => /^\d+$/.test(clean(row[0])) && clean(row[1]))
    .map((row) => {
      const name = clean(row[1]);
      const base = infoByName.get(name) || { name, role: clean(row[2]) };
      const freelancerPayout = money(row[14]);
      const combinedPayout = money(row[15]);
      const regularPayout = money(row[16]);
      const finalPayout = combinedPayout || freelancerPayout;
      return {
        ...base,
        groupCount: number(row[3]),
        privateCount: number(row[4]),
        groupAverage: number(row[5]),
        groupPay: money(row[6]),
        privatePay: money(row[7]),
        adjustmentAmount: money(row[8]),
        adjustmentText: clean(row[9]),
        pretaxPay: money(row[10]),
        deductionTotal: money(row[11]),
        incomeTax: money(row[12]),
        localTax: money(row[13]),
        freelancerPayout,
        combinedPayout,
        regularPayout,
        finalPayout,
      };
    });
  return { instructors };
}

function readPreviousSummary(root, currentYm) {
  const previousYm = shiftYyyyMm(currentYm, -1);
  const previousFile = path.join(root, previousYm, `아카이브 정산명세서 ${previousYm}.xlsx`);
  if (!existsSync(previousFile)) return null;
  const statement = readStatementWorkbook(previousFile);
  return {
    month: previousYm,
    totalPayout: statement.instructors.reduce((sum, row) => sum + row.finalPayout, 0),
  };
}

function readOperationWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet3 = rows(wb, "Sheet3");
  const byLabel = new Map();
  for (const row of sheet3) {
    const label = clean(row[0]);
    if (label) byLabel.set(label, row);
  }
  return {
    groupAttendanceAverage: number(byLabel.get("그룹 출석 인원 평균")?.[7]),
    groupReservationAverage: number(byLabel.get("그룹 예약 인원 평균")?.[7]),
    groupRevenue: money(byLabel.get("강사 그룹 매출")?.[7]),
    groupPay: money(byLabel.get("강사 그룹 보수")?.[7]),
    privateCount: number(byLabel.get("강사 프라이빗 횟수")?.[7]),
    privateRevenue: money(byLabel.get("강사 프라이빗 매출")?.[7]),
    privatePay: money(byLabel.get("강사 프라이빗 보수")?.[7]),
  };
}

function buildSummary(instructors, previousTotalPayout, operation) {
  const totalPayout = instructors.reduce((sum, row) => sum + row.finalPayout, 0);
  const groupTotal = instructors.reduce((sum, row) => sum + row.groupCount, 0);
  const privateTotal = instructors.reduce((sum, row) => sum + row.privateCount, 0);
  const weightedGroupAverage = groupTotal
    ? instructors.reduce((sum, row) => sum + row.groupAverage * row.groupCount, 0) / groupTotal
    : 0;
  return {
    totalPayout,
    previousTotalPayout,
    diffFromPrevious: totalPayout - previousTotalPayout,
    groupTotal,
    privateTotal: operation?.privateCount || privateTotal,
    totalClassCount: groupTotal + (operation?.privateCount || privateTotal),
    monthlyGroupAverage: operation?.groupAttendanceAverage || weightedGroupAverage,
    groupRevenue: operation?.groupRevenue || 0,
    groupPay: operation?.groupPay || instructors.reduce((sum, row) => sum + row.groupPay, 0),
    privateRevenue: operation?.privateRevenue || 0,
    privatePay: operation?.privatePay || instructors.reduce((sum, row) => sum + row.privatePay, 0),
  };
}

function renderIndexHtml({ ym, summary, files, generatedAt }) {
  const title = `${formatYm(ym)} 정산명세서`;
  const direction = summary.diffFromPrevious >= 0 ? "증가" : "감소";
  const diffClass = summary.diffFromPrevious >= 0 ? "up" : "down";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ARCHIVE PILATES ${title}</title>
  <style>${baseCss()}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px;margin-top:24px}.summary-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px}.summary-card b{display:block;font-size:26px;margin-top:6px}.summary-card .sub{color:var(--muted);font-size:13px}.up{color:#0f7b50}.down{color:#bf3b21}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;margin-top:20px}.cards .card{display:flex;justify-content:space-between;gap:12px;text-decoration:none;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px}.cards span{color:var(--accent-dark);font-weight:900}.section-title{margin:30px 0 0;font-size:22px}</style>
</head>
<body><main><article class="statement">
  <div class="eyebrow">ARCHIVE PILATES</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">강사별 전달용 HTML 파일 인덱스입니다. 생성일 ${formatDate(generatedAt)}</p>
  <section class="summary">
    <div class="summary-card"><span class="label">총 지급 합계</span><b>${formatWon(summary.totalPayout)}</b><span class="sub ${diffClass}">전월대비 ${direction} ${formatWon(Math.abs(summary.diffFromPrevious))}</span></div>
    <div class="summary-card"><span class="label">그룹수업 합계</span><b>${formatCount(summary.groupTotal)}회</b><span class="sub">그룹 보수 ${formatWon(summary.groupPay)}</span></div>
    <div class="summary-card"><span class="label">프라이빗 수업 합계</span><b>${formatCount(summary.privateTotal)}회</b><span class="sub">프라이빗 보수 ${formatWon(summary.privatePay)}</span></div>
    <div class="summary-card"><span class="label">총수업 수</span><b>${formatCount(summary.totalClassCount)}회</b><span class="sub">그룹 + 프라이빗</span></div>
    <div class="summary-card"><span class="label">월 그룹 평균</span><b>${formatNumber(summary.monthlyGroupAverage, 2)}명</b><span class="sub">출석 인원 기준</span></div>
  </section>
  <h2 class="section-title">강사별 명세서</h2>
  <section class="cards">
    ${files
      .map((file) => `<a class="card" href="${encodeURI(file.fileName)}"><strong>${escapeHtml(file.name)}</strong><span>${formatWon(file.payout)}</span></a>`)
      .join("")}
  </section>
</article></main></body></html>`;
}

function renderInstructorHtml({ ym, instructor, generatedAt }) {
  const title = `ARCHIVE PILATES 정산명세서 ${ym} ${instructor.name}`;
  const adjustmentRows = parseAdjustmentRows(instructor);
  const rows = [
    detailRow("그룹 보수", `${formatCount(instructor.groupCount)}회 · 평균 ${formatNumber(instructor.groupAverage, 2)}명`, instructor.groupPay),
    detailRow("프라이빗 보수", `${formatCount(instructor.privateCount)}회`, instructor.privatePay),
    ...adjustmentRows,
    detailRow("세전 보수총액", "3.3% 공제 전 기준", instructor.pretaxPay),
    detailRow("소득세 3%", "원천징수", instructor.incomeTax),
    detailRow("주민세 0.3%", "원천징수", instructor.localTax),
    detailRow("공제 합계", "소득세 + 주민세", instructor.deductionTotal),
    detailRow("프리랜서 지급액", "세전 보수총액 - 공제 합계", instructor.freelancerPayout, true),
  ];
  if (instructor.regularPayout) rows.push(detailRow("정규직 실지급", "급여 지급분", instructor.regularPayout));
  if (instructor.combinedPayout) rows.push(detailRow("실지급 합산", "프리랜서 지급액 + 정규직 실지급", instructor.combinedPayout, true));
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${baseCss()}</style>
</head>
<body>
<main>
  <article class="statement">
    <header class="brand-row">
      <div>
        <div class="brand-mark">AP</div>
        <div class="eyebrow" style="margin-top:18px;">ARCHIVE PILATES</div>
        <h1>정산명세서</h1>
      </div>
      <div class="meta">
        <strong>${escapeHtml(formatYm(ym))} 정산</strong>
        작성일 ${formatDate(generatedAt)}<br>
        전달용 HTML
      </div>
    </header>
    <section class="person">
      <div class="panel">
        <div class="label">강사</div>
        <div class="name">${escapeHtml(instructor.name)}</div>
        <div class="role">${escapeHtml([instructor.role, `그룹 ${instructor.groupGrade || "-"}`, `프라이빗 ${instructor.privateGrade || "-"}`].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="panel">
        <div class="label">최종 지급 기준액</div>
        <div class="total">${formatWon(instructor.finalPayout)}</div>
        <div class="role">${instructor.combinedPayout ? "실지급 합산" : "지급액"}</div>
      </div>
    </section>
    <section class="grid">
      <div class="metric"><div class="label">그룹</div><div class="value">${formatCount(instructor.groupCount)}회</div></div>
      <div class="metric"><div class="label">프라이빗</div><div class="value">${formatCount(instructor.privateCount)}회</div></div>
      <div class="metric"><div class="label">그룹 평균</div><div class="value">${formatNumber(instructor.groupAverage, 2)}명</div></div>
      <div class="metric"><div class="label">세전 보수</div><div class="value">${formatWon(instructor.pretaxPay)}</div></div>
    </section>
    <section>
      <table aria-label="정산 상세">
        <thead><tr><th>항목</th><th>금액</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </section>
    <section>
      <ul class="note-list">
        ${instructor.combinedPayout ? "<li>프리랜서 수업 보수와 정규직 실지급을 합산해 최종 지급 기준액을 표시했습니다.</li>" : "<li>세전 보수총액에서 원천징수 3.3%를 반영해 지급액을 표시했습니다.</li>"}
        ${instructor.bank ? `<li>지급 계좌: ${escapeHtml(instructor.bank)} · ${escapeHtml(String(instructor.account || ""))} · ${escapeHtml(instructor.accountHolder || instructor.name)}</li>` : ""}
        <li>본 명세서는 ARCHIVE PILATES 내부 정산 기준에 따라 작성되었습니다.</li>
      </ul>
    </section>
    <footer class="footer">
      <span>ARCHIVE PILATES</span>
      <span>정산 관련 문의는 운영자에게 확인해 주세요.</span>
    </footer>
  </article>
</main>
</body>
</html>`;
}

function detailRow(label, sub, value, accent = false) {
  return `<tr><td><strong>${escapeHtml(label)}</strong><br><span class="muted">${escapeHtml(sub)}</span></td><td class="amount ${accent ? "accent" : ""}">${formatWon(value)}</td></tr>`;
}

function parseAdjustmentRows(instructor) {
  if (!instructor.adjustmentAmount && !instructor.adjustmentText) return [];
  const text = instructor.adjustmentText || "정산 조정 반영";
  const rows = [];
  const salary = text.match(/정규직급여\\s*\\(([-,\\d]+)\\)/);
  const lesson = text.match(/강사\\s*레슨\\s*([-,\\d]+)/);
  if (salary) rows.push(detailRow("정규직 급여 공제", "프리랜서 수업 보수에서 차감", -Math.abs(money(salary[1]))));
  if (lesson) rows.push(detailRow("강사 레슨 조정", "정산 조정 반영", money(lesson[1])));
  if (!rows.length) rows.push(detailRow("조정금액", text, instructor.adjustmentAmount));
  return rows;
}

function baseCss() {
  return `
:root{color-scheme:light;--bg:#f7f4ef;--paper:#fffdfa;--ink:#171717;--muted:#726b62;--line:#e6ded3;--soft:#f1ebe3;--accent:#f36b21;--accent-dark:#c84f12}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100dvh;background:radial-gradient(circle at 20% 0%,#fff 0,#f7f4ef 36%,#efe7db 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","SF Pro Display","SF Pro Text",sans-serif;line-height:1.55}
main{width:min(960px,calc(100% - 32px));margin:0 auto;padding:34px 0 48px}.statement{background:var(--paper);border:1px solid rgba(55,45,35,.12);border-radius:28px;padding:clamp(24px,4vw,42px);box-shadow:0 24px 70px rgba(48,38,25,.13)}
.brand-row{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:24px}.brand-mark{width:62px;height:62px;border-radius:18px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900;font-size:22px;letter-spacing:.5px;box-shadow:0 18px 28px rgba(243,107,33,.22)}
.eyebrow{color:var(--accent-dark);font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}h1{margin:8px 0 0;font-size:clamp(30px,5vw,50px);line-height:1.05;letter-spacing:0}.meta{text-align:right;color:var(--muted);font-size:14px}.meta strong{color:var(--ink);display:block;font-size:18px}
.person{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:26px}.panel{background:linear-gradient(180deg,#fff,#fbf7f1);border:1px solid var(--line);border-radius:20px;padding:22px}.label{color:var(--muted);font-size:13px;font-weight:800}.name{margin:4px 0 0;font-size:34px;font-weight:900}.role{margin-top:8px;color:var(--muted)}.total{font-size:36px;font-weight:950;margin-top:5px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}.metric{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;min-width:0}.metric .value{font-size:22px;font-weight:900;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:15px}th,td{padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);text-align:left;font-size:12px;letter-spacing:.04em;text-transform:uppercase}td:last-child,th:last-child{text-align:right}.amount{font-weight:850}.muted{color:var(--muted)}.accent{color:var(--accent-dark)}.note-list{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:8px}.note-list li{background:var(--soft);border-radius:14px;padding:12px 14px;color:#5f554a}.footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media(max-width:760px){main{width:min(100% - 20px,960px);padding-top:16px}.statement{border-radius:22px}.brand-row,.person{grid-template-columns:1fr;display:grid}.meta{text-align:left}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:14px}}@media print{body{background:#fff}main{width:100%;padding:0}.statement{border:none;border-radius:0;box-shadow:none}}`;
}

function rows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (arg.startsWith("--")) {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

function previousMonthYyyyMm() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftYyyyMm(ym, diff) {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1 + diff, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatYm(ym) {
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월`;
}

function formatDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[,%원\\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return number(value);
}

function formatWon(value) {
  return `${Math.round(number(value)).toLocaleString("ko-KR")}원`;
}

function formatCount(value) {
  const n = number(value);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function formatNumber(value, digits = 1) {
  return number(value).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}
