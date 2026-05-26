import type { InBodyDetailData } from "./inbodyApiClient";

export interface InBodyReportSummary {
  name: string;
  memberId: string;
  mobileLast4: string;
  gender: string;
  age: number | null;
  heightCm: number | null;
  testDatetimes: string;
  weightKg: number | null;
  skeletalMuscleMassKg: number | null;
  bodyFatMassKg: number | null;
  percentBodyFat: number | null;
  bmi: number | null;
  inBodyScore: number | null;
  basalMetabolicRateKcal: number | null;
  visceralFatLevel: number | null;
  targetWeightKg: number | null;
  weightControlKg: number | null;
  fatControlKg: number | null;
  muscleControlKg: number | null;
}

interface InBodyReportArgs {
  summary: InBodyReportSummary;
  detail: InBodyDetailData;
  generatedAtIso: string;
}

interface RangeMetric {
  label: string;
  value: number | null;
  unit: string;
  low: number | null;
  high: number | null;
}

export function summarizeInBodyDetail(detail: InBodyDetailData, fallbackDatetimes: string): InBodyReportSummary {
  return {
    name: getString(detail, "Name") || "이름 미확인",
    memberId: getString(detail, "ID"),
    mobileLast4: getString(detail, "MobileNumber").replace(/\D/g, "").slice(-4),
    gender: getString(detail, "Gender"),
    age: getNumber(detail, "Age"),
    heightCm: getNumber(detail, "Height"),
    testDatetimes: normalizeDatetimes(getString(detail, "TestDate/Time") || fallbackDatetimes),
    weightKg: getNumber(detail, "Weight"),
    skeletalMuscleMassKg: getNumber(detail, "SMM(SkeletalMuscleMass)"),
    bodyFatMassKg: getNumber(detail, "BFM(BodyFatMass)"),
    percentBodyFat: getNumber(detail, "PBF(PercentBodyFat)"),
    bmi: getNumber(detail, "BMI(BodyMassIndex)"),
    inBodyScore: getNumber(detail, "InBodyScore"),
    basalMetabolicRateKcal: getNumber(detail, "BMR(BasalMetabolicRate)"),
    visceralFatLevel: getNumber(detail, "VFL(VisceralFatLevel)"),
    targetWeightKg: getNumber(detail, "TargetWeight"),
    weightControlKg: getNumber(detail, "WeightControl"),
    fatControlKg: getNumber(detail, "BFMControl"),
    muscleControlKg: getNumber(detail, "FFMControl"),
  };
}

export function generateInBodyReportHtml(args: InBodyReportArgs): string {
  const { summary, detail, generatedAtIso } = args;
  const metrics: RangeMetric[] = [
    metric(detail, "체중", "Weight", "LowerLimit(WeightNormalRange)", "UpperLimit(WeightNormalRange)", "kg"),
    metric(
      detail,
      "골격근량",
      "SMM(SkeletalMuscleMass)",
      "LowerLimit(SMMNormalRange)",
      "UpperLimit(SMMNormalRange)",
      "kg",
    ),
    metric(detail, "체지방량", "BFM(BodyFatMass)", "LowerLimit(BFMNormalRange)", "UpperLimit(BFMNormalRange)", "kg"),
    metric(detail, "BMI", "BMI(BodyMassIndex)", "LowerLimit(BMINormalRange)", "UpperLimit(BMINormalRange)", "kg/m2"),
    metric(detail, "체지방률", "PBF(PercentBodyFat)", "LowerLimit(PBFNormalRange)", "UpperLimit(PBFNormalRange)", "%"),
  ];

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(summary.name)} 인바디 자동 리포트</title>
<style>
:root{color-scheme:light;--ink:#171717;--muted:#6d6d6d;--line:#d7d7d7;--soft:#f4f5f5;--accent:#9d2415;--paper:#fffdf9}
*{box-sizing:border-box}body{margin:0;background:#ece9e3;color:var(--ink);font-family:Arial,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;line-height:1.45}
.page{max-width:1180px;margin:0 auto;padding:28px 22px 40px;background:var(--paper);min-height:100vh}
.top{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end;border-bottom:5px solid var(--accent);padding-bottom:12px}
.brand{font-size:46px;font-weight:900;color:var(--accent);letter-spacing:0}.studio{font-size:34px;font-weight:800;text-align:right}
.meta{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;border-bottom:1px solid var(--line);margin:0 0 24px}
.meta div{padding:10px 12px;border-right:1px solid var(--line)}.meta div:last-child{border-right:0}.meta span{display:block;color:var(--muted);font-size:13px}.meta strong{font-size:18px}
.grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,.9fr);gap:32px}.section{margin:0 0 28px}.section h2{font-size:22px;margin:0 0 9px;color:#5d6265}.small{font-size:12px;color:var(--muted)}
.table{border-top:2px solid #9aa1a5}.row{display:grid;grid-template-columns:minmax(120px,1fr) 120px 90px minmax(140px,1fr);align-items:center;min-height:38px;border-bottom:1px solid var(--line)}
.row b{padding:8px;background:#dfe3e7;height:100%;display:flex;align-items:center}.value{font-size:20px;text-align:right;padding-right:12px}.unit{font-size:13px;color:#333}
.bar{height:15px;background:#e5e6e7;position:relative;border-radius:0;overflow:hidden}.bar i{position:absolute;left:0;top:0;bottom:0;background:#111}.bar em{position:absolute;top:0;bottom:0;border-left:2px solid #fff;left:50%}
.score{border-top:1px solid var(--line);padding:18px 0 8px}.score strong{font-size:48px}.score span{font-size:22px}
.control{display:grid;grid-template-columns:1fr auto;gap:6px;font-size:18px}.control b{font-weight:800}.control span{text-align:right}
.body3d{display:grid;grid-template-columns:1fr 1fr;gap:18px}.figure{background:#dfe3e7;min-height:330px;position:relative;display:grid;place-items:center;overflow:hidden}.figure:before{content:"";position:absolute;width:180px;height:270px;border-radius:80px 80px 36px 36px;background:linear-gradient(145deg,#fff,#f5f5f5);box-shadow:24px 24px 0 rgba(0,0,0,.06);transform:perspective(520px) rotateY(-16deg)}
.figure:after{content:"";position:absolute;top:48px;width:70px;height:70px;border-radius:50%;background:#fff;box-shadow:14px 16px 0 rgba(0,0,0,.06)}
.limb{position:absolute;background:#fff;border-radius:999px;box-shadow:16px 18px 0 rgba(0,0,0,.055)}.arm-l{width:46px;height:148px;left:72px;top:126px;transform:rotate(12deg)}.arm-r{width:46px;height:148px;right:72px;top:126px;transform:rotate(-12deg)}.leg-l{width:42px;height:150px;left:calc(50% - 48px);bottom:18px;transform:rotate(5deg)}.leg-r{width:42px;height:150px;right:calc(50% - 48px);bottom:18px;transform:rotate(-5deg)}
.caption{position:absolute;left:16px;right:16px;bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:18px;text-align:center}.caption span{background:rgba(255,255,255,.6);padding:6px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.card{border:1px solid var(--line);padding:12px;background:#fff}.card span{display:block;color:var(--muted);font-size:12px}.card strong{font-size:22px}
.note{border-top:1px solid var(--line);font-size:12px;color:var(--muted);padding-top:10px}.foot{margin-top:26px;border-top:5px solid var(--accent);padding-top:8px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:12px}
@media(max-width:820px){.page{padding:18px 14px}.top,.grid,.body3d{grid-template-columns:1fr}.brand{font-size:36px}.studio{text-align:left;font-size:27px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.row{grid-template-columns:1fr 90px 58px}.row .bar{grid-column:1/-1;margin:0 8px 10px}.cards{grid-template-columns:1fr 1fr}.figure{min-height:280px}}
@media(max-width:390px){.cards,.meta{grid-template-columns:1fr}.brand{font-size:31px}.studio{font-size:23px}.score strong{font-size:40px}}
</style>
</head>
<body><main class="page">
<header class="top"><div class="brand">ARCHIVE IN</div><div class="studio">ARCHIVE PILATES</div></header>
<section class="meta">
<div><span>회원</span><strong>${escapeHtml(summary.name)}</strong></div>
<div><span>회원번호</span><strong>${escapeHtml(summary.memberId || "-")}</strong></div>
<div><span>신장</span><strong>${formatValue(summary.heightCm, "cm")}</strong></div>
<div><span>나이/성별</span><strong>${formatValue(summary.age, "")} ${escapeHtml(summary.gender)}</strong></div>
<div><span>검사일시</span><strong>${escapeHtml(formatDatetimes(summary.testDatetimes))}</strong></div>
</section>
<section class="grid">
<div>
<div class="section"><h2>체성분 핵심 지표 <span class="small">Body Composition</span></h2><div class="table">${metrics.map(renderMetricRow).join("")}</div></div>
<div class="section"><h2>부위별 상태 <span class="small">Segmental View</span></h2><div class="body3d">
${renderFigure("근육", segmentLabels(detail, "Evaluation(FFMof"))}
${renderFigure("체지방", segmentLabels(detail, "Evaluation(BFMof"))}
</div></div>
</div>
<aside>
<div class="section score"><h2>인바디점수 <span class="small">InBody Score</span></h2><strong>${formatPlain(summary.inBodyScore)}</strong><span>/100 점</span></div>
<div class="section"><h2>체중조절 <span class="small">Weight Control</span></h2><div class="control">
<b>적정체중</b><span>${formatValue(summary.targetWeightKg, "kg")}</span>
<b>체중조절</b><span>${formatSigned(summary.weightControlKg, "kg")}</span>
<b>지방조절</b><span>${formatSigned(summary.fatControlKg, "kg")}</span>
<b>근육조절</b><span>${formatSigned(summary.muscleControlKg, "kg")}</span>
</div></div>
<div class="section"><h2>연구항목 <span class="small">Research Parameters</span></h2><div class="cards">
${renderCard("기초대사량", summary.basalMetabolicRateKcal, "kcal")}
${renderCard("내장지방레벨", summary.visceralFatLevel, "")}
${renderCard("체지방률", summary.percentBodyFat, "%")}
${renderCard("BMI", summary.bmi, "")}
${renderCard("골격근량", summary.skeletalMuscleMassKg, "kg")}
${renderCard("체지방량", summary.bodyFatMassKg, "kg")}
</div></div>
<p class="note">이 리포트는 LookinBody API 수신 데이터로 자동 생성된 내부 운영용 시각화입니다. 의료 진단 목적이 아니라 수업 품질 관리와 운동효과 추적을 위한 참고 자료입니다.</p>
</aside>
</section>
<footer class="foot"><span>Generated ${escapeHtml(generatedAtIso)}</span><span>Source: LookinBody Web API</span></footer>
</main></body></html>`;
}

function metric(
  detail: InBodyDetailData,
  label: string,
  valueKey: string,
  lowKey: string,
  highKey: string,
  unit: string,
): RangeMetric {
  return {
    label,
    value: getNumber(detail, valueKey),
    unit,
    low: getNumber(detail, lowKey),
    high: getNumber(detail, highKey),
  };
}

function renderMetricRow(metric: RangeMetric): string {
  const width = barWidth(metric.value, metric.low, metric.high);
  const status = metric.value === null ? "" : rangeStatus(metric.value, metric.low, metric.high);
  return `<div class="row"><b>${escapeHtml(metric.label)}</b><div class="value">${formatPlain(metric.value)}</div><div class="unit">${escapeHtml(metric.unit)}</div><div class="bar" title="${escapeHtml(status)}"><i style="width:${width}%"></i><em></em></div></div>`;
}

function renderFigure(title: string, labels: string[]): string {
  return `<div class="figure" aria-label="${escapeHtml(title)} 분석"><div class="limb arm-l"></div><div class="limb arm-r"></div><div class="limb leg-l"></div><div class="limb leg-r"></div><div class="caption">${labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div></div>`;
}

function segmentLabels(detail: InBodyDetailData, prefix: string): string[] {
  return [
    getString(detail, `${prefix}LeftArm)`) || "-",
    getString(detail, `${prefix}RightArm)`) || "-",
    getString(detail, `${prefix}LeftLeg)`) || "-",
    getString(detail, `${prefix}RightLeg)`) || "-",
  ];
}

function renderCard(label: string, value: number | null, unit: string): string {
  return `<div class="card"><span>${escapeHtml(label)}</span><strong>${formatValue(value, unit)}</strong></div>`;
}

function getString(detail: InBodyDetailData, key: string): string {
  const value = detail[key];
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function getNumber(detail: InBodyDetailData, key: string): number | null {
  const value = detail[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeDatetimes(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 14 ? digits.slice(0, 14) : value;
}

function formatDatetimes(value: string): string {
  const digits = normalizeDatetimes(value);
  const match = digits.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${year}.${month}.${day}. ${hour}:${minute}`;
}

function formatPlain(value: number | null): string {
  if (value === null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "-";
  return `${formatPlain(value)}${unit ? ` ${unit}` : ""}`;
}

function formatSigned(value: number | null, unit: string): string {
  if (value === null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPlain(value)} ${unit}`;
}

function barWidth(value: number | null, low: number | null, high: number | null): number {
  if (value === null) return 0;
  if (low === null || high === null || low >= high) return Math.max(5, Math.min(100, value));
  const min = Math.max(0, low - (high - low));
  const max = high + (high - low);
  return Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
}

function rangeStatus(value: number, low: number | null, high: number | null): string {
  if (low !== null && value < low) return "표준이하";
  if (high !== null && value > high) return "표준이상";
  return "표준";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
