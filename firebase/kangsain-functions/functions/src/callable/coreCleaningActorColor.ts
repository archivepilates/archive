// StudioMate color keys identify staff entries rather than editable display names.
export type CleaningActor = { staffId: string; wasManager: boolean };

export function resolveCleaningActorColor(
  actor: CleaningActor | undefined,
  palette: ReadonlyMap<string, string>,
  managerColor: string,
): string | undefined {
  if (!actor) return;
  const color = actor.wasManager ? managerColor : palette.get(actor.staffId);
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}
