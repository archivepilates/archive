import { archiveCollections } from "./firestore";

export const archiveDataLayers = {
  source: "source",
  action: "action",
  computed: "computed",
  mirror: "mirror",
  incubation: "incubation",
  externalProjection: "externalProjection",
} as const;

export type ArchiveDataLayer = (typeof archiveDataLayers)[keyof typeof archiveDataLayers];

export const archiveSourceCollections = [
  archiveCollections.memberProfiles,
  archiveCollections.memberContactIndex,
  archiveCollections.bookings,
  archiveCollections.lectures,
  archiveCollections.memberMemos,
  archiveCollections.memberTags,
  archiveCollections.privateSurveyResponses,
] as const;

export const archiveActionCollections = [
  archiveCollections.alimtalkCandidates,
  archiveCollections.alimtalkSends,
  archiveCollections.contactSyncJobs,
  archiveCollections.adminSyncRequests,
  archiveCollections.memberSignupContracts,
  archiveCollections.onsiteWelcomeRequests,
  archiveCollections.privateLessonChartRequests,
  archiveCollections.privateLessonChartRecords,
] as const;

export const archiveComputedCollections = [
  archiveCollections.privateSessionLedger,
  archiveCollections.attendanceSummaries,
  archiveCollections.adminActions,
  archiveCollections.instructorViews,
  archiveCollections.dashboardSnapshots,
] as const;

export const archiveMirrorCollections = [
  archiveCollections.membersMirror,
  archiveCollections.member360CardsMirror,
] as const;

export const archiveIncubationCollections = [archiveCollections.workLanes] as const;

export const archiveExternalProjectionTargets = ["notionPrivateCharts", "googleDriveReports", "solapi", "studiomate"] as const;

export const memberFacingActionForbiddenSourceCollections = [
  ...archiveMirrorCollections,
  ...archiveIncubationCollections,
] as const;

export const archiveCanonicalSourcePolicy = {
  reservationSelection: [archiveCollections.bookings],
  memberIdentitySelection: [archiveCollections.memberProfiles, archiveCollections.memberContactIndex],
  communicationSelection: [archiveCollections.alimtalkCandidates, archiveCollections.alimtalkSends],
  privateChartSelection: [
    archiveCollections.bookings,
    archiveCollections.privateLessonChartRequests,
    archiveCollections.privateLessonChartRecords,
    archiveCollections.privateSessionLedger,
  ],
  operatorDisplay: [...archiveMirrorCollections, ...archiveComputedCollections, ...archiveActionCollections],
} as const;

export function archiveCollectionLayer(collectionName: string): ArchiveDataLayer | "unknown" {
  if ((archiveSourceCollections as readonly string[]).includes(collectionName)) return archiveDataLayers.source;
  if ((archiveActionCollections as readonly string[]).includes(collectionName)) return archiveDataLayers.action;
  if ((archiveComputedCollections as readonly string[]).includes(collectionName)) return archiveDataLayers.computed;
  if ((archiveMirrorCollections as readonly string[]).includes(collectionName)) return archiveDataLayers.mirror;
  if ((archiveIncubationCollections as readonly string[]).includes(collectionName)) return archiveDataLayers.incubation;
  return "unknown";
}

export function isForbiddenMemberFacingActionSource(collectionName: string): boolean {
  return (memberFacingActionForbiddenSourceCollections as readonly string[]).includes(collectionName);
}
