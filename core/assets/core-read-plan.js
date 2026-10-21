export function operationalReadPlan(document) {
  const has = selector => Boolean(document.querySelector(selector));
  return {
    lane: has("#laneStatus, #laneUpdated"),
    automation: has("#homeDecisionList, #automationList, #automationHealthList, #automationMode, #automationStatusCount, #automationFailedCount, #automationRecentRun, #automationConnectedState, #automationRunnerCount, #automationCodexActiveCount, #automationNextAction"),
    imports: has("#homeDecisionList, #importsTable, #importCount, #sourceImportCount, #importConnectionState, #latestImportKind, #latestImportNote"),
    quality: has("#homeDecisionList, #membersTable, #memberDetailName, #qualityList, #qualityCount, #qualityOpenCount, #qualityResolvedCount, #latestQualityTitle, #latestQualityNote"),
  };
}
