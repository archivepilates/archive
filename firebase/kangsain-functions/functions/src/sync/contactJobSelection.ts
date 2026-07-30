import type { ContactSyncJobDoc } from "../types/models";

export function chooseRunnableContactJobs(
  jobs: Array<{ job: ContactSyncJobDoc; nextRunAtMillis: number }>,
): ContactSyncJobDoc[] {
  const byPhone = new Map<string, { job: ContactSyncJobDoc; nextRunAtMillis: number }>();
  for (const entry of jobs.sort((a, b) => a.nextRunAtMillis - b.nextRunAtMillis)) {
    const phoneKey = normalizePhone(entry.job.memberPhone);
    const previous = byPhone.get(phoneKey);
    if (!previous || contactJobPriority(entry.job) > contactJobPriority(previous.job)) {
      byPhone.set(phoneKey, entry);
    }
  }

  return [...byPhone.values()]
    .sort((a, b) => {
      const priorityDiff = contactJobPriority(b.job) - contactJobPriority(a.job);
      if (priorityDiff) return priorityDiff;
      return a.nextRunAtMillis - b.nextRunAtMillis;
    })
    .slice(0, 25)
    .map(({ job }) => job);
}

export function contactJobPriority(job: ContactSyncJobDoc): number {
  if (job.sourceReason === "staff_profile_refresh") return 2;
  return ["consultation_schedule", "consultation_member_excel"].includes(job.sourceReason) ? 0 : 1;
}

export function assertSingleExistingContact(count: number): void {
  if (count > 1) throw new Error(`같은 전화번호 연락처가 ${count}개 있습니다`);
}

function normalizePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}
