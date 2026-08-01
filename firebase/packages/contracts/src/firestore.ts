export const archiveCollections = {
  lectures: "lectures",
  memberProfiles: "memberProfiles",
  memberContactIndex: "memberContactIndex",
  bookings: "bookings",
  memberMemos: "memberMemos",
  memberTags: "memberTags",
  alimtalkCandidates: "alimtalkCandidates",
  alimtalkSends: "alimtalkSends",
  renewalCases: "renewalCases",
  contactSyncJobs: "contactSyncJobs",
  memberSignupContracts: "memberSignupContracts",
  onsiteWelcomeRequests: "onsiteWelcomeRequests",
  privateSurveyRequests: "privateSurveyRequests",
  privateSurveyResponses: "privateSurveyResponses",
  privateLessonChartRequests: "privateLessonChartRequests",
  privateLessonChartRecords: "privateLessonChartRecords",
  privateLessonSessions: "privateLessonSessions",
  methodCueCardReviews: "methodCueCardReviews",
  adminSyncRequests: "adminSyncRequests",
  privateSessionLedger: "privateSessionLedger",
  attendanceSummaries: "attendanceSummaries",
  adminActions: "adminActions",
  instructorViews: "instructorViews",
  dashboardSnapshots: "dashboardSnapshots",
  ticketLiabilityReports: "ticketLiabilityReports",
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
  archiveCollections.privateSurveyRequests,
  archiveCollections.privateLessonChartRequests,
  archiveCollections.privateLessonChartRecords,
  archiveCollections.privateLessonSessions,
  archiveCollections.methodCueCardReviews,
  archiveCollections.adminSyncRequests,
] as const;

export const mirrorCollections = [archiveCollections.membersMirror, archiveCollections.member360CardsMirror] as const;

export const incubationCollections = [archiveCollections.workLanes] as const;
