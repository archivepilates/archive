export interface SheetSyncCheckpoint {
  version?: string;
  checkedAtMillis?: number;
}

export function canSkipUnchangedSurveySheet(
  version: string | undefined,
  checkpoint: SheetSyncCheckpoint | undefined,
  nowMillis: number,
): boolean {
  const age = nowMillis - Number(checkpoint?.checkedAtMillis);
  return Boolean(version && checkpoint?.version === version && age >= 0 && age < 24 * 60 * 60_000);
}
