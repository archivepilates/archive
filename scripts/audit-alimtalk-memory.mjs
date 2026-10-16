import { createRequire } from "node:module";

const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
const { GoogleAuth } = require("google-auth-library");
const startTime = process.argv[2];
const endTime = process.argv[3] || new Date().toISOString();
if (!startTime || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime))) {
  throw new Error("Usage: node scripts/audit-alimtalk-memory.mjs START_ISO [END_ISO]");
}
const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const functions = await client.request({ url: "https://cloudfunctions.googleapis.com/v2/projects/archive-pilates/locations/asia-northeast3/functions?pageSize=1000" });
if (functions.data.nextPageToken) throw new Error("Function inventory is incomplete");
const limits = new Map((functions.data.functions || []).map((fn) => {
  const memory = String(fn.serviceConfig?.availableMemory || "");
  const match = memory.match(/^(\d+)(Mi|Gi)$/);
  return [fn.name.split("/").at(-1), match ? Number(match[1]) * 1024 ** (match[2] === "Gi" ? 3 : 2) : null];
}));
const series = [];
let pageToken = "";
for (let page = 0; page < 20; page++) {
  const url = new URL("https://monitoring.googleapis.com/v3/projects/archive-pilates/timeSeries");
  const filter = 'metric.type="cloudfunctions.googleapis.com/function/user_memory_bytes" AND resource.type="cloud_function" AND resource.labels.function_name=monitoring.regex.full_match(".*[Aa]limtalk.*")';
  for (const [key, value] of Object.entries({ filter, "interval.startTime": startTime, "interval.endTime": endTime, view: "FULL", pageSize: "10000" })) url.searchParams.set(key, value);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await client.request({ url: String(url) });
  series.push(...(response.data.timeSeries || []));
  pageToken = response.data.nextPageToken || "";
  if (!pageToken) break;
}
if (pageToken) throw new Error("Metric pagination incomplete");
const byFunction = new Map();
for (const item of series) {
  const name = item.resource.labels.function_name;
  const row = byFunction.get(name) || { functionName: name, limitBytes: limits.get(name), daily: new Map(), multiExecutionPoints: 0, samples: 0 };
  for (const point of item.points || []) {
    const value = point.value?.distributionValue;
    const count = Number(value?.count || 0);
    if (!count) continue;
    const kstDay = new Date(Date.parse(point.interval.endTime) + 9 * 3600_000).toISOString().slice(0, 10);
    const day = row.daily.get(kstDay) || { date: kstDay, maxMinuteMeanBytes: 0, samples: 0 };
    day.maxMinuteMeanBytes = Math.max(day.maxMinuteMeanBytes, Number(value.mean || 0));
    day.samples += count;
    row.samples += count;
    if (count > 1) row.multiExecutionPoints++;
    row.daily.set(kstDay, day);
  }
  byFunction.set(name, row);
}
const rows = [...byFunction.values()].map((row) => {
  const daily = [...row.daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
    date: day.date, maxMinuteMeanMiB: +(day.maxMinuteMeanBytes / 1024 ** 2).toFixed(2),
    utilizationPercent: row.limitBytes ? +(day.maxMinuteMeanBytes / row.limitBytes * 100).toFixed(2) : null,
    samples: day.samples,
  }));
  return { functionName: row.functionName, currentLimitMiB: row.limitBytes / 1024 ** 2,
    observedDays: daily.length, daysAtLeast90Percent: daily.filter((day) => day.utilizationPercent >= 90).length,
    daysAtLeast98Percent: daily.filter((day) => day.utilizationPercent >= 98).length,
    maxMiB: Math.max(0, ...daily.map((day) => day.maxMinuteMeanMiB)),
    samples: row.samples, multiExecutionPoints: row.multiExecutionPoints, daily };
}).sort((a, b) => b.daysAtLeast90Percent - a.daysAtLeast90Percent);
console.log(JSON.stringify({ readOnly: true, startTime, endTime,
  metric: "cloudfunctions.googleapis.com/function/user_memory_bytes",
  statistic: "Daily maximum (KST) of per-minute mean of per-execution peak memory; missing/OOM samples are not zero; current memory limits used, not historical limits",
  rows }, null, 2));
