import { archiveCollections } from "./firestore";

export const workLaneCollection = archiveCollections.workLanes;

export const workLaneSubcollections = {
  inputs: "inputs",
  outputs: "outputs",
  reports: "reports",
  decisions: "decisions",
  jobs: "jobs",
  handoffs: "handoffs",
} as const;

export type WorkLaneSubcollectionName = (typeof workLaneSubcollections)[keyof typeof workLaneSubcollections];

export const workLaneStatuses = ["draft", "active", "paused", "archived", "promoted"] as const;
export type WorkLaneStatus = (typeof workLaneStatuses)[number];

export const workLanePromotionStates = ["not_ready", "reviewing", "approved", "rejected", "promoted"] as const;
export type WorkLanePromotionState = (typeof workLanePromotionStates)[number];

export const workLaneForbiddenActions = [
  "kakao_alimtalk_send",
  "studio_mate_write",
  "google_contacts_write",
  "attendance_write",
  "memo_write",
  "payment_or_refund_decision",
  "reservation_decision",
] as const;

export type WorkLaneForbiddenAction = (typeof workLaneForbiddenActions)[number];

export interface WorkLanePromotionReview {
  targetCollection?: string;
  targetCodebase?: string;
  sourceOfTruth?: string;
  canonicalIdentityKey?: string;
  duplicateHandlingRule?: string;
  allowedReaders?: string[];
  forbiddenActions: WorkLaneForbiddenAction[];
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface WorkLaneDocument {
  laneId: string;
  title: string;
  purpose: string;
  ownerThread?: string;
  status: WorkLaneStatus;
  promotionState: WorkLanePromotionState;
  sourceCollections: string[];
  allowedReaders: string[];
  forbiddenActions: WorkLaneForbiddenAction[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastVerifiedAt?: string;
  promotionReview?: WorkLanePromotionReview;
}

export interface WorkLaneArtifact<TPayload = Record<string, unknown>> {
  laneId: string;
  artifactId: string;
  kind: WorkLaneSubcollectionName;
  title?: string;
  sourcePath?: string;
  payload: TPayload;
  createdAt: string;
  updatedAt: string;
}
