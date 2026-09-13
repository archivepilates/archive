import { healthTimestampMs } from "./system-health-queue-policy.mjs";

const HOUR_MS = 60 * 60 * 1000;
export const BACKUP_FIRST_SCHEDULE_GRACE_HOURS = 26;
export const SYSTEM_HEALTH_SCHEDULERS = [
  { functionName: "scheduledProcessAlimtalkQueue", expectedState: "ENABLED", collection: "alimtalkCandidates" },
  { functionName: "scheduledProcessContactSyncJobs", expectedState: "ENABLED", collection: "contactSyncJobs" },
  { functionName: "scheduledSyncPrivateSurveyResponses", expectedState: "ENABLED" },
  { functionName: "scheduledProcessWriteQueue", expectedState: "PAUSED", collection: "writeQueue", intentionallyRetired: true },
  { functionName: "scheduledSyncDashboardDaily", expectedState: "PAUSED", intentionallyRetired: true },
  { functionName: "scheduledAttendanceReminder", expectedState: "PAUSED", intentionallyRetired: true },
];

export function classifyCloudReadError(error) {
  const code = String(error?.response?.status || error?.code || "unknown");
  return { state: ["401", "403", "7", "16", "PERMISSION_DENIED", "UNAUTHENTICATED"].includes(code)
    ? "permission_unavailable" : "metadata_unavailable", code, needsAttention: true };
}

export function classifySchedulerState(job, policy, error = null) {
  if (error) return classifyCloudReadError(error);
  const actualState = job?.state || "UNKNOWN";
  if (actualState === "PAUSED" && policy.expectedState === "PAUSED" && policy.intentionallyRetired) {
    return { state: "intentionally_retired", actualState, needsAttention: false };
  }
  if (actualState === "ENABLED" && policy.expectedState === "ENABLED") {
    const actualSchedule = typeof job?.schedule === "string" ? job.schedule.trim().replace(/\s+/g, " ") : "";
    const cadenceMatches = ["*/10 * * * *", "every 10 minutes"].includes(actualSchedule.toLowerCase());
    return { state: cadenceMatches ? "enabled" : "unexpected_scheduler_cadence", actualState,
      actualSchedule, expectedSchedule: "*/10 * * * * or every 10 minutes", needsAttention: !cadenceMatches };
  }
  return { state: "unexpected_scheduler_state", actualState, expectedState: policy.expectedState, needsAttention: true };
}

export function classifyDatabaseProtection(database) {
  return [
    { id: "firestore-deletion-protection", value: database?.deleteProtectionState, expected: "DELETE_PROTECTION_ENABLED" },
    { id: "firestore-pitr", value: database?.pointInTimeRecoveryEnablement, expected: "POINT_IN_TIME_RECOVERY_ENABLED" },
  ].map(({ id, value, expected }) => ({ id, value: value || "UNKNOWN", expected,
    state: value === expected ? "enabled" : "protection_unavailable", needsAttention: value !== expected }));
}

export function classifyBackupState({ database, schedules = [], backups = [], nowMs = Date.now(), complete = true }) {
  if (!complete) return { state: "metadata_incomplete", needsAttention: true };
  const eligibleSchedules = schedules.filter((schedule) => schedule.dailyRecurrence || schedule.weeklyRecurrence);
  if (!eligibleSchedules.length) return { state: "backup_schedule_missing", needsAttention: true };
  const matching = backups.filter((backup) => backup.database === database?.name &&
    (!database?.uid || backup.databaseUid === database.uid));
  const ready = matching.filter((backup) => backup.state === "READY" &&
    healthTimestampMs(backup.snapshotTime) !== null && healthTimestampMs(backup.snapshotTime) <= nowMs &&
    healthTimestampMs(backup.expireTime) > nowMs);
  const latestMs = Math.max(...ready.map((backup) => healthTimestampMs(backup.snapshotTime)));
  const maxAgeHours = eligibleSchedules.some((schedule) => schedule.dailyRecurrence) ? 26 : 8 * 24;
  if (Number.isFinite(latestMs) && nowMs - latestMs <= maxAgeHours * HOUR_MS) {
    return { state: "backup_current", latestSnapshotAt: new Date(latestMs).toISOString(), needsAttention: false };
  }
  // Only an entirely new schedule with no backup history gets first-run grace.
  const created = eligibleSchedules.map((schedule) => healthTimestampMs(schedule.createTime));
  const firstScheduleMs = created.every((ms) => ms !== null) ? Math.min(...created) : null;
  const firstScheduleAgeHours = firstScheduleMs === null ? null : (nowMs - firstScheduleMs) / HOUR_MS;
  const failed = matching.some((backup) => backup.state === "NOT_AVAILABLE");
  if (!ready.length && !failed && !matching.some((backup) => backup.state === "READY") &&
      firstScheduleAgeHours !== null && firstScheduleAgeHours >= 0 && firstScheduleAgeHours < BACKUP_FIRST_SCHEDULE_GRACE_HOURS) {
    return { state: "first_schedule_grace", graceUntil: new Date(firstScheduleMs + BACKUP_FIRST_SCHEDULE_GRACE_HOURS * HOUR_MS).toISOString(),
      verifiedBackup: false, needsAttention: false };
  }
  return { state: "backup_missing_or_stale", firstScheduleAgeHours, needsAttention: true };
}

export async function readSystemHealthCloudState({ request, projectId, databaseId = "(default)",
  region = "asia-northeast3", schedulers = SYSTEM_HEALTH_SCHEDULERS, nowMs = Date.now() }) {
  const checks = [];
  const workers = {};
  const successfulReads = new Set();
  const completedCheckIds = new Set();
  const databaseName = `projects/${projectId}/databases/${databaseId}`;
  // Firestore Admin list endpoints are not paginated; unreachable locations still make evidence incomplete.
  async function read(id, url) {
    try {
      const response = await request({ url, method: "GET", timeout: 15000, retry: false });
      if (!response?.data || typeof response.data !== "object") throw new Error("Missing metadata");
      if (response.data.unreachable?.length || response.data.nextPageToken) {
        checks.push({ id, state: "metadata_incomplete", needsAttention: true });
        return null;
      }
      successfulReads.add(id);
      return response.data;
    } catch (error) {
      checks.push({ id, ...classifyCloudReadError(error) });
      return null;
    }
  }
  const database = await read("firestore-database-metadata", `https://firestore.googleapis.com/v1/${databaseName}`);
  if (database) {
    const protection = classifyDatabaseProtection(database);
    checks.push(...protection);
    for (const check of protection) if (!check.needsAttention) completedCheckIds.add(check.id);
  }
  const schedules = await read("firestore-backup-schedules", `https://firestore.googleapis.com/v1/${databaseName}/backupSchedules`);
  const backups = await read("firestore-backups", `https://firestore.googleapis.com/v1/projects/${projectId}/locations/-/backups`);
  if (database && schedules && backups) {
    const backupState = { id: "firestore-backup-state", scheduleCount: (schedules.backupSchedules || []).length,
      ...classifyBackupState({ database, schedules: schedules.backupSchedules || [], backups: backups.backups || [], nowMs }),
    };
    checks.push(backupState);
    if (backupState.state === "backup_current") completedCheckIds.add(backupState.id);
  }
  for (const policy of schedulers) {
    const name = `projects/${projectId}/locations/${region}/jobs/firebase-schedule-${policy.functionName}-${region}`;
    const id = `scheduler:${policy.functionName}`;
    const job = await read(id, `https://cloudscheduler.googleapis.com/v1/${name}`);
    const state = job ? classifySchedulerState(job, policy) : checks.find((check) => check.id === id);
    if (job) checks.push({ id, name, ...state });
    if (job && !state.needsAttention) completedCheckIds.add(id);
    if (policy.collection) workers[policy.collection] = state;
  }
  for (const id of ["firestore-database-metadata", "firestore-backup-schedules", "firestore-backups"]) {
    if (successfulReads.has(id)) completedCheckIds.add(id);
  }
  if (successfulReads.size === 3 + schedulers.length) completedCheckIds.add("cloud-metadata");
  return { checks, workers, completedCheckIds: [...completedCheckIds] };
}

export function classifyMcpReachability(status, error = null) {
  // An unauthenticated HEAD may be rejected by MCP while still proving the route exists.
  const reachable = !error && ((status >= 200 && status < 300) || [400, 401, 403, 405, 406].includes(status));
  return { state: reachable ? "reachable_not_functionally_verified" : "unreachable", status,
    needsAttention: !reachable, severity: "warning" };
}

export async function probeMcpEndpoints(urls, { fetchImpl = fetch } = {}) {
  const checks = [];
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid endpoint");
    } catch {
      checks.push({ state: "invalid_endpoint", needsAttention: true, severity: "warning" });
      continue;
    }
    try {
      const response = await fetchImpl(url.href, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      checks.push({ url: url.href, ...classifyMcpReachability(response.status) });
    } catch {
      checks.push({ url: url.href, ...classifyMcpReachability(0, true) });
    }
  }
  return checks;
}
