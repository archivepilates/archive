// Source evidence: core/assets/app.js and sequence-store.js; canonical schemas
// in Functions types/models.ts, mealPlan, parking, social and registration handlers.
// These are saved workflow records, not live StudioMate or dispatch authority.
// Keep projections top-level: store.mjs does not project nested field paths.
// Never admit whole answers, content, snapshots, errors, URLs, signatures or HR maps.
export const AREAS = {
  memberProfiles: {
    collection: 'memberProfiles', studioField: 'studioId',
    filters: ['memberId', 'studiomateMemberId', 'name', 'phone', 'memberGrade'], sensitive: true,
    allowedFields: ['memberId', 'studiomateMemberId', 'studioId', 'name', 'phoneLast4',
      'memberGrade', 'activeTicketCount', 'isNewMember', 'newMemberBasis',
      'registeredAt', 'sourceUpdatedAt', 'syncedAt', 'updatedAt'],
  },
  bookings: {
    collection: 'bookings', studioField: 'studioId',
    filters: ['memberId', 'lectureId', 'lectureDate', 'staffId', 'sourceStatus',
      'appStatus', 'attendanceStatus', 'syncStatus', 'canonicalBookingKey'], sensitive: true,
    allowedFields: ['bookingId', 'studioId', 'memberId', 'memberName', 'lectureId',
      'staffId', 'staffName', 'lectureDate', 'lectureStartAt', 'lectureEndAt',
      'lessonType', 'sourceStatus', 'appStatus', 'attendanceStatus', 'syncStatus',
      'canonicalBookingKey', 'supersededByBookingId', 'ticketName',
      'parkingStatus', 'parkingPreRegistrationStatus', 'syncedAt', 'updatedAt'],
  },
  lectures: {
    collection: 'lectures', studioField: 'studioId',
    filters: ['date', 'staffId', 'lessonType', 'status'], sensitive: true,
    allowedFields: ['lectureId', 'studioId', 'date', 'startAt', 'endAt', 'staffId',
      'staffName', 'title', 'lessonType', 'status', 'syncedAt', 'updatedAt'],
  },
  lessonOccurrences: {
    collection: 'lessonOccurrences', studioField: 'studioId',
    filters: ['lessonOccurrenceId', 'staffName', 'lessonType', 'sourceKind', 'sourceImportId'], sensitive: true,
    allowedFields: ['lessonOccurrenceId', 'studioId', 'staffName', 'lessonType',
      'startsAt', 'endsAt', 'sourceKind', 'sourceImportId', 'createdAt', 'updatedAt'],
  },
  deletedClassLogs: {
    collection: 'deletedClassLogs', studioField: 'studioId',
    filters: ['logId', 'date', 'month', 'staffName', 'lessonType', 'operationalCategory'], sensitive: true,
    allowedFields: ['logId', 'studioId', 'source', 'date', 'month', 'startTime', 'endTime',
      'staffName', 'lessonType', 'operationalCategory', 'includeInClosureReport',
      'needsOperatorReview', 'importedAt', 'updatedAt'],
  },

  mealRequests: {
    collection: 'recommendedMealProgramRequests', studioField: 'studioId',
    filters: ['requestId', 'memberId', 'candidateId', 'status', 'recommendationStatus', 'templateCode'], sensitive: true,
    allowedFields: ['requestId', 'studioId', 'memberId', 'memberName', 'memberPhoneLast4',
      'status', 'recommendationStatus', 'templateCode', 'candidateId', 'dedupeKey',
      'draftRevision', 'reviewReasonCount', 'requestedByStaffId',
      'submittedAt', 'expiresAt', 'createdAt', 'updatedAt'],
  },
  mealSurveys: {
    collection: 'recommendedMealProgramResponses', studioField: 'studioId',
    filters: ['requestId', 'responseId', 'memberId', 'recommendationStatus'], sensitive: true,
    allowedFields: ['responseId', 'requestId', 'studioId', 'memberId', 'memberName',
      'recommendationStatus', 'submittedAt', 'createdAt', 'updatedAt'],
  },
  mealDrafts: {
    collection: 'recommendedMealProgramDrafts', studioField: 'studioId',
    filters: ['requestId', 'responseId', 'memberId', 'status', 'provider'], sensitive: true,
    allowedFields: ['requestId', 'responseId', 'studioId', 'memberId', 'memberName',
      'status', 'provider', 'model', 'revision', 'reviewAcknowledgedAt',
      'reviewAcknowledgedByUid', 'editedByUid', 'editedAt', 'createdAt', 'updatedAt'],
  },
  mealReports: {
    collection: 'recommendedMealProgramReports', studioField: 'studioId',
    filters: ['requestId', 'reportId', 'memberId', 'approvalStatus', 'publicationStatus'], sensitive: true,
    allowedFields: ['reportId', 'requestId', 'studioId', 'memberId', 'memberName',
      'memberPhoneLast4', 'reportRevision', 'approvedRevision', 'publishedRevision',
      'sentRevision', 'approvalStatus', 'publicationStatus', 'approvedByStaffId',
      'publishedByStaffId', 'approvedAt', 'publishedAt', 'expiresAt', 'createdAt', 'updatedAt'],
  },

  signupContracts: {
    collection: 'memberSignupContracts', studioField: 'studioId',
    filters: ['contractId', 'memberId', 'status', 'source',
      'studiomateProfileSyncStatus', 'studiomateSyncStatus'], sensitive: true,
    allowedFields: ['contractId', 'studioId', 'memberId', 'memberName', 'memberPhoneLast4',
      'status', 'source', 'termsVersion', 'studiomateProfileSyncStatus', 'studiomateSyncStatus',
      'openedAt', 'submittedAt', 'expiresAt', 'cancelledAt', 'purgeAfter', 'createdAt', 'updatedAt'],
  },
  membershipContracts: {
    collection: 'studiomateMembershipContracts', studioField: 'studioId',
    filters: ['contractId', 'binding.memberId', 'status', 'observationStatus', 'welcomeStatus'], sensitive: true,
    allowedFields: ['contractId', 'studioId', 'memberName', 'schemaVersion', 'source',
      'bindingVerified', 'status', 'observationStatus', 'observationReason',
      'welcomeStatus', 'nextObservationAt', 'createdAt', 'updatedAt'],
  },
  onsiteWelcomeRequests: {
    collection: 'onsiteWelcomeRequests', studioField: 'studioId',
    filters: ['requestId', 'status', 'contractId', 'alimtalkCandidateId', 'alimtalkSendId'], sensitive: true,
    allowedFields: ['requestId', 'studioId', 'status', 'phoneLast4', 'source', 'progressPercent',
      'contractId', 'alimtalkCandidateId', 'alimtalkSendId', 'startedAt',
      'completedAt', 'createdAt', 'updatedAt'],
  },
  instructorRegistrations: {
    collection: 'instructorLessonRegistrations', studioField: 'studioId',
    filters: ['registrationId', 'memberId', 'lessonDate', 'status', 'mode'], sensitive: true,
    allowedFields: ['registrationId', 'studioId', 'memberId', 'memberName', 'phoneLast4',
      'lessonDate', 'ticketName', 'mode', 'status', 'createdAt', 'updatedAt'],
  },
  instructorCancellations: {
    collection: 'studiomateInstructorLessonCancellations', studioField: 'studioId',
    filters: ['jobId', 'registrationId', 'memberId', 'lessonDate', 'status'], sensitive: true,
    allowedFields: ['jobId', 'registrationId', 'studioId', 'memberId', 'lessonDate',
      'status', 'stage', 'attempts', 'maxAttempts', 'externalEffectStarted',
      'createdAt', 'updatedAt', 'completedAt'],
  },

  ticketHolds: {
    collection: 'memberTicketHolds', studioField: 'studioId',
    filters: ['sourceId', 'memberId', 'ticketId', 'noticeStatus', 'identityVerified'], sensitive: true,
    allowedFields: ['schemaVersion', 'sourceId', 'studioId', 'memberId', 'memberName',
      'ticketId', 'ticketName', 'source', 'sourceVersion', 'observedAt', 'baselineAt',
      'holdsComplete', 'identityVerified', 'noticeStatus', 'createdAt', 'updatedAt'],
  },
  // Claims have no studioId; only non-content workflow metadata is exposed.
  holdingClaims: {
    collection: 'holdingNoticeClaims', studioField: null, allowUnscoped: true,
    filters: ['candidateId', 'sourceId', 'holdId', 'status'], sensitive: true,
    allowedFields: ['candidateId', 'sourceId', 'sourceVersion', 'holdId', 'status',
      'externalAttempted', 'attemptedAt', 'acceptedAt', 'deferredAt', 'nextEligibleAt',
      'quietHoursPolicy', 'deferredProof', 'updatedAt'],
  },
  messageCandidates: {
    collection: 'alimtalkCandidates', studioField: 'studioId',
    filters: ['candidateId', 'memberId', 'type', 'status', 'templateCode',
      'sourceActionKey', 'dedupeKey', 'sourceDate'], sensitive: true,
    allowedFields: ['candidateId', 'studioId', 'memberId', 'memberName', 'type', 'status',
      'templateCode', 'sourceActionKey', 'sourceDate', 'dedupeKey', 'reasonCode', 'skipCode',
      'attempts', 'maxAttempts', 'queuedBy', 'reviewedByUid', 'reviewedAt', 'sentAt',
      'providerAttemptedAt', 'nextEligibleAt', 'createdAt', 'updatedAt'],
  },
  messageSends: {
    collection: 'alimtalkSends', studioField: 'studioId',
    filters: ['sendId', 'candidateId', 'memberId', 'status', 'templateCode', 'dedupeKey', 'providerOutcome'], sensitive: true,
    allowedFields: ['sendId', 'studioId', 'candidateId', 'memberId', 'memberName', 'templateCode',
      'dedupeKey', 'dedupePolicy', 'dedupeWindowDays', 'status', 'attempts', 'maxAttempts',
      'nextRunAt', 'solapiMessageId', 'solapiGroupId', 'providerOutcome', 'externalAttempted',
      'sentAt', 'deliveredAt', 'nextEligibleAt', 'createdAt', 'updatedAt'],
  },
  pricingInquiryRequests: {
    collection: 'pricingInquiryAlimtalkRequests', studioField: 'studioId',
    filters: ['requestId', 'candidateId', 'status', 'templateCode'], sensitive: true,
    allowedFields: ['requestId', 'studioId', 'memberName', 'status', 'templateCode',
      'candidateId', 'dedupeKey', 'requestedByStaffId', 'createdAt', 'updatedAt'],
  },

  parkingVehicles: {
    collection: 'parkingVehicles', studioField: 'studioId',
    filters: ['vehicleId', 'ownerType', 'ownerId', 'memberId', 'staffId', 'status', 'validDate'], sensitive: true,
    allowedFields: ['vehicleId', 'studioId', 'ownerType', 'ownerId', 'memberId', 'staffId',
      'ownerPhoneLast4', 'carNumberLast4', 'status', 'validDate', 'isDefault',
      'source', 'createdAt', 'updatedAt'],
  },
  parkingJobs: {
    collection: 'parkingDiscountJobs', studioField: 'studioId',
    filters: ['jobId', 'bookingId', 'memberId', 'staffId', 'status', 'ownerType'], sensitive: true,
    allowedFields: ['jobId', 'studioId', 'bookingId', 'memberId', 'staffId', 'ownerType',
      'status', 'carNumberLast4', 'requestedDiscountHours', 'operatorAlertStatus',
      'attempts', 'maxAttempts', 'nextRunAt', 'createdAt', 'updatedAt', 'completedAt'],
  },
  instructorParkingRequests: {
    collection: 'instructorLessonParkingPreRegistrations', studioField: 'studioId',
    filters: ['requestId', 'memberId', 'lessonDate', 'status'], sensitive: true,
    allowedFields: ['requestId', 'studioId', 'memberId', 'lessonDate', 'lessonStartAt',
      'status', 'vehicleId', 'carNumberLast4', 'expiresAt', 'submittedAt', 'createdAt', 'updatedAt'],
  },

  writeJobs: {
    collection: 'writeQueue', studioField: 'studioId',
    filters: ['jobId', 'type', 'status', 'createdByUid'], sensitive: true,
    allowedFields: ['jobId', 'studioId', 'type', 'status', 'attempts', 'maxAttempts',
      'nextRunAt', 'createdByUid', 'createdAt', 'updatedAt'],
  },
  contactSyncJobs: {
    collection: 'contactSyncJobs', studioField: 'studioId',
    filters: ['jobId', 'memberId', 'target', 'status', 'sourceReason'], sensitive: true,
    allowedFields: ['jobId', 'studioId', 'memberId', 'target', 'status', 'sourceReason',
      'attempts', 'maxAttempts', 'nextRunAt', 'createdAt', 'updatedAt'],
  },
  memoWriteJobs: {
    collection: 'studiomateMemoWriteJobs', studioField: 'studioId',
    filters: ['jobId', 'memoId', 'memberId', 'registrationId', 'status'], sensitive: true,
    allowedFields: ['jobId', 'memoId', 'studioId', 'memberId', 'registrationId', 'status',
      'attempts', 'maxAttempts', 'nextRunAt', 'createdAt', 'updatedAt', 'completedAt'],
  },
  profileWriteJobs: {
    collection: 'studiomateProfileWriteJobs', studioField: 'studioId',
    filters: ['jobId', 'memberId', 'contractId', 'status'], sensitive: true,
    allowedFields: ['jobId', 'studioId', 'memberId', 'contractId', 'status',
      'attempts', 'maxAttempts', 'nextRunAt', 'createdAt', 'updatedAt', 'completedAt'],
  },
  instructorLessonJobs: {
    collection: 'studiomateInstructorLessonJobs', studioField: 'studioId',
    filters: ['jobId', 'registrationId', 'lessonDate', 'status', 'currentStep'], sensitive: true,
    allowedFields: ['jobId', 'registrationId', 'studioId', 'lessonDate', 'ticketName',
      'status', 'currentStep', 'attempts', 'maxAttempts', 'externalEffectStarted',
      'createdAt', 'updatedAt', 'completedAt'],
  },
  membershipContractJobs: {
    collection: 'studiomateMembershipContractJobs', studioField: 'studioId',
    filters: ['jobKey', 'memberId', 'userTicketId', 'contractId', 'action', 'stage'], sensitive: true,
    allowedFields: ['schemaVersion', 'jobKey', 'studioId', 'memberId', 'userTicketId',
      'productId', 'contractId', 'action', 'stage', 'sourceCapturedAt', 'createdAt', 'updatedAt'],
  },

  socialDrafts: {
    collection: 'socialContentDrafts', studioField: 'studioId',
    filters: ['contentId', 'channel', 'accountHandle', 'contentType', 'pillar', 'status'], sensitive: true,
    allowedFields: ['contentId', 'studioId', 'channel', 'accountHandle', 'contentType',
      'pillar', 'status', 'publishAt', 'reviewRequestedAt', 'approvedAt', 'heldAt',
      'externalMediaId', 'publishedAt', 'metricsUpdatedAt', 'createdAt', 'updatedAt'],
  },
  socialJobs: {
    collection: 'socialPublishJobs', studioField: 'studioId',
    filters: ['jobId', 'contentId', 'channel', 'accountHandle', 'status', 'stage'], sensitive: true,
    allowedFields: ['jobId', 'contentId', 'studioId', 'channel', 'accountHandle', 'status',
      'stage', 'attempts', 'maxAttempts', 'nextRunAt', 'externalMediaId', 'createdAt', 'updatedAt'],
  },
  socialLogs: {
    collection: 'socialPublishLogs', studioField: 'studioId',
    filters: ['contentId', 'jobId', 'channel', 'accountHandle', 'status'], sensitive: true,
    allowedFields: ['contentId', 'jobId', 'studioId', 'channel', 'accountHandle',
      'status', 'externalMediaId', 'createdAt'],
  },

  instructors: {
    collection: 'staffs', studioField: 'studioId',
    filters: ['staffId', 'studiomateStaffId', 'role', 'active'], sensitive: true,
    allowedFields: ['staffId', 'studiomateStaffId', 'studioId', 'name', 'role',
      'active', 'createdAt', 'updatedAt'],
  },
  instructorHR: {
    collection: 'staffHrCards', studioField: 'studioId',
    filters: ['staffId', 'staffRole', 'active', 'source'], sensitive: true,
    allowedFields: ['staffId', 'studioId', 'staffName', 'staffRole', 'active',
      'source', 'createdAt', 'updatedAt'],
  },
  instructorEvaluations: {
    collection: 'staffEvaluationSubmissions', studioField: 'studioId',
    filters: ['submissionId', 'staffId', 'quizId', 'quizVersion', 'status'], sensitive: true,
    allowedFields: ['submissionId', 'studioId', 'staffId', 'staffName', 'staffRole',
      'quizId', 'quizVersion', 'status', 'submittedByStaffId', 'submittedAt', 'updatedAt'],
  },
  // Sequence schemas are owner-scoped, not studio-scoped. The MCP owner gate
  // must remain in force; this does not grant instructor-wide library access.
  sequenceNotes: {
    collection: 'sequenceNotes', studioField: null, allowUnscoped: true,
    filters: ['ownerUid', 'deleted', 'date', 'equipment'], sensitive: true,
    allowedFields: ['ownerUid', 'revision', 'deleted', 'date', 'equipment',
      'moveCount', 'createdAt', 'updatedAt'],
  },
  sequenceImages: {
    collection: 'sequenceNoteImages', studioField: null, allowUnscoped: true,
    filters: ['ownerUid', 'noteId'], sensitive: true,
    allowedFields: ['ownerUid', 'noteId'],
  },
  renewalCases: {
    collection: 'renewalCases', studioField: 'studioId',
    filters: ['caseId', 'memberId', 'kind', 'active', 'workflowStatus', 'priority', 'sourceDate'], sensitive: true,
    allowedFields: ['caseId', 'studioId', 'memberId', 'memberName', 'kind', 'active',
      'workflowStatus', 'ticketIdentity', 'ticketName', 'priority', 'sourceDate',
      'sourceCollection', 'sourceCandidateId', 'nextActionAt', 'operatorUpdatedAt',
      'createdAt', 'updatedAt'],
  },

  privateSessions: {
    collection: 'privateLessonSessions', studioField: 'studioId',
    filters: ['sessionId', 'memberId', 'bookingId', 'staffId', 'lessonDate',
      'workflowStage', 'reportStatus', 'deliveryStatus'], sensitive: true,
    allowedFields: ['sessionId', 'studioId', 'bookingId', 'occurrenceId', 'memberId',
      'staffId', 'lessonDate', 'lessonStartAt', 'workflowStage', 'preStatus', 'postStatus',
      'reportStatus', 'deliveryStatus', 'reportRevision', 'approvedRevision', 'sentRevision',
      'legacyRequestId', 'legacyRecordId', 'createdAt', 'updatedAt'],
  },
  privateChartRequests: {
    collection: 'privateLessonChartRequests', studioField: 'studioId',
    filters: ['requestId', 'memberId', 'bookingId', 'staffId', 'lessonDate', 'status', 'preStatus', 'postStatus'], sensitive: true,
    allowedFields: ['requestId', 'studioId', 'workflowVersion', 'bookingId', 'lectureId',
      'memberId', 'staffId', 'lessonDate', 'lessonStartAt', 'lessonEndAt',
      'status', 'preStatus', 'postStatus', 'cancelledAt', 'createdAt', 'updatedAt'],
  },
  privateChartRecords: {
    collection: 'privateLessonChartRecords', studioField: 'studioId',
    filters: ['recordId', 'requestId', 'memberId', 'bookingId', 'staffId', 'lessonDate', 'gptStatus'], sensitive: true,
    allowedFields: ['recordId', 'requestId', 'studioId', 'bookingId', 'lectureId', 'memberId',
      'staffId', 'lessonDate', 'lessonStartAt', 'preSubmittedAt', 'postSubmittedAt',
      'gptStatus', 'gptTaskId', 'gptProvider', 'gptModel', 'cancelledAt', 'createdAt', 'updatedAt'],
  },
  privateSessionLedger: {
    collection: 'privateSessionLedger', studioField: 'studioId',
    filters: ['ledgerId', 'memberId', 'bookingId', 'staffName', 'status'], sensitive: true,
    allowedFields: ['ledgerId', 'studioId', 'memberId', 'bookingId', 'startsAt',
      'staffName', 'status', 'createdAt', 'updatedAt'],
  },
  refundCases: {
    collection: 'refundCases', studioField: 'studioId',
    filters: ['caseId', 'memberId', 'status'], sensitive: true,
    allowedFields: ['caseId', 'studioId', 'memberId', 'status', 'createdAt', 'updatedAt'],
  },

  // Project-wide health metadata has no studioId. Do not expose findings,
  // source references, lastResult, warning text or repair payloads here.
  automationStatus: {
    collection: 'automationStatus', studioField: null, allowUnscoped: true,
    filters: ['automationId', 'ownerArea', 'status'], sensitive: true,
    allowedFields: ['automationId', 'ownerArea', 'status', 'lastRunAt', 'nextRunAt',
      'runId', 'updatedAt'],
  },
  codexActions: {
    collection: 'codexActionQueue', studioField: null, allowUnscoped: true,
    filters: ['queueId', 'source', 'status', 'priority', 'area', 'owner', 'checkKey'], sensitive: true,
    allowedFields: ['queueId', 'source', 'sourceType', 'sourceRunId', 'sourceFindingId',
      'checkKey', 'status', 'owner', 'priority', 'area', 'repairStatus',
      'firstSeenAt', 'lastSeenAt', 'updatedAt'],
  },
  sourceImports: {
    collection: 'sourceImports', studioField: 'studioId',
    filters: ['importId', 'sourceKind', 'status'], sensitive: true,
    allowedFields: ['importId', 'studioId', 'sourceKind', 'status', 'rowCount', 'normalizedRows',
      'appliedRows', 'skippedRows', 'duplicateRows', 'errorRows', 'sourceVersion',
      'downloadedAt', 'importedAt', 'updatedAt'],
  },
  dataQualityIssues: {
    collection: 'dataQualityIssues', studioField: 'studioId',
    filters: ['issueId', 'issueType', 'memberId', 'severity', 'status'], sensitive: true,
    allowedFields: ['issueId', 'studioId', 'issueType', 'memberId', 'severity',
      'status', 'createdAt', 'updatedAt', 'resolvedAt'],
  },
};

// Preserve the reviewed policy against accidental mutation by tool consumers.
for (const area of Object.values(AREAS)) {
  Object.freeze(area.filters);
  Object.freeze(area.allowedFields);
  Object.freeze(area);
}
Object.freeze(AREAS);
