export const archiveCollections = {
  memberProfiles: "memberProfiles",
  bookings: "bookings",
  memberMemos: "memberMemos",
  memberTags: "memberTags",
  alimtalkCandidates: "alimtalkCandidates",
  alimtalkSends: "alimtalkSends",
  contactSyncJobs: "contactSyncJobs",
  privateLessonChartRequests: "privateLessonChartRequests",
  privateLessonChartRecords: "privateLessonChartRecords",
  adminSyncRequests: "adminSyncRequests",
  studiomateMemberProfileWriteJobs: "studiomateMemberProfileWriteJobs",
  workLanes: "workLanes",
  membersMirror: "members",
  member360CardsMirror: "member360Cards",
} as const;

export type ArchiveCollectionName = (typeof archiveCollections)[keyof typeof archiveCollections];

export const sourceOfTruthCollections = [
  archiveCollections.memberProfiles,
  archiveCollections.bookings,
  archiveCollections.memberMemos,
  archiveCollections.memberTags,
  archiveCollections.alimtalkCandidates,
  archiveCollections.alimtalkSends,
  archiveCollections.contactSyncJobs,
  archiveCollections.privateLessonChartRequests,
  archiveCollections.privateLessonChartRecords,
  archiveCollections.adminSyncRequests,
  archiveCollections.studiomateMemberProfileWriteJobs,
] as const;

export const mirrorCollections = [archiveCollections.membersMirror, archiveCollections.member360CardsMirror] as const;

export const incubationCollections = [archiveCollections.workLanes] as const;
