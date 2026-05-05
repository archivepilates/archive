import { stableHash } from "./hash";

export function noticeIdFor(input: {
  studioId: string;
  staffId: string;
  msgType: string;
  refLectureId: string;
  sourceCreatedAt: string;
}): string {
  return stableHash(input).slice(0, 32);
}

export function queueJobIdFor(input: unknown): string {
  return `job_${stableHash(input).slice(0, 32)}`;
}
