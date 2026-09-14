/**
 * Read-only, Firestore-shaped adapter; deliberately imports neither Firebase nor settings.
 * Grounding: types/models.ts (sends have no type; requests use lookup.memberId/memberPhone),
 * alimtalk/processAlimtalkQueue.ts (done/sent means provider acceptance, not delivery),
 * scripts/reconcile-member-phone-duplicates.mjs and refund/refundOperations.ts (alias fields).
 * Complete means exhausted canonical queries for this identity, NOT permission to send,
 * provider coverage, or an atomic snapshot. The caller must separately attest provider
 * history and serialize/recheck its queue/send guard. No mirror/workLane data is read.
 * Assumes canonical identity fields and Korean local/+82 phone spellings below. Unlinked
 * historical identities, arbitrary unindexed phone spellings and deleted records cannot
 * be certified by this loader. Missing/ambiguous evidence is never a clean history.
 */
type Data = Record<string, unknown>;
export interface WelcomeHistoryDocument {
  readonly id: string;
  readonly exists: boolean;
  data(): Data | undefined;
}
export interface WelcomeHistoryQuery {
  where(field: string, operator: "==" | "array-contains", value: string): WelcomeHistoryQuery;
  orderBy(field: string): WelcomeHistoryQuery;
  limit(count: number): WelcomeHistoryQuery;
  startAfter(id: string): WelcomeHistoryQuery;
  get(): Promise<{ readonly docs: readonly WelcomeHistoryDocument[] }>;
}
export interface WelcomeHistoryDb {
  collection(path: string): WelcomeHistoryQuery & {
    doc(id: string): { get(): Promise<WelcomeHistoryDocument> };
  };
}
export type MembershipWelcomeHistoryStatus =
  | "accepted"
  | "delivered"
  | "queued"
  | "sending"
  | "unknown"
  | "failed"
  | "cancelled"
  | "skipped";
export interface MembershipWelcomeHistoryRecord {
  /** Collection-qualified identity, so equal candidate/send IDs remain distinct evidence. */
  id: string;
  sourceId: string;
  sourceCollection: string;
  family: "new_member_welcome";
  templateId: string;
  status: MembershipWelcomeHistoryStatus;
  sourceStatus: string;
  /** true includes unknown/possibly attempted; only explicit safe false is retained. */
  attempted: boolean;
  attempts: number | null;
}
export interface MembershipWelcomeHistory {
  records: MembershipWelcomeHistoryRecord[];
  complete: boolean;
  reason: string;
  memberIds: string[];
  checkedAt: string;
  providerComplete: false;
}
export interface MembershipWelcomeHistoryInput {
  studioId: string;
  memberId: string;
  phone: string;
  ignoreCandidateId?: string;
  now?: Date | string | number;
  /** Millisecond elapsed-time clock, separate from the business timestamp; injectable for tests. */
  elapsedNow?: () => number;
}

// v2/v3: docs/kakao-alimtalk-automation-handoff.md:82-86 (including deleted v2).
// v5: alimtalk/templates.ts; v6: memberSignup/membershipWelcomePolicy.ts
// (moved from scripts/lib/studiomate-membership-welcome.mjs during this lane).
// No v1/v4 ID was evidenced in those sources or local templates.ts Git history.
export const MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS: readonly string[] = Object.freeze([
  "KA01TP260513132546184k4RpQF0exqz",
  "KA01TP260514081318309wQGfeIJxIAJ",
  "KA01TP260602101939427lPhGyuDLvFM",
  "KA01TP260914091233543JoFDsn7KfCr",
]);
export const MEMBERSHIP_WELCOME_HISTORY_LIMITS = Object.freeze({
  pageSize: 100,
  pagesPerQuery: 10,
  readCalls: 768,
  documents: 10_000,
  memberIds: 32,
  elapsedMs: 15_000,
});
const WELCOME_TYPES = ["new_member", "onsite_welcome", "membership_welcome"];
const OTHER_TYPES = [
  "reservation_open",
  "private_survey",
  "group_survey",
  "instructor_lesson_confirmation",
  "instructor_lesson_material",
  "private_lesson_report",
  "inbody_report",
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
  "pricing_info",
  "recommended_meal_survey",
  "recommended_meal_report",
  "staff_private_survey",
  "staff_private_chart",
  "staff_group_survey",
];
const ALIAS_POINTERS = ["canonicalMemberId", "mergedInto", "memberMerge.canonicalMemberId"];
const ALIAS_LISTS = ["mergedMemberIds", "memberMerge.mergedMemberIds"];
const PROFILE_ID_FIELDS = ["memberId", "studiomateMemberId", ...ALIAS_POINTERS];
const HISTORY_COLLECTIONS = ["alimtalkCandidates", "alimtalkSends", "onsiteWelcomeRequests"];
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const validId = (value: unknown): value is string =>
  typeof value === "string" && !!value && value === value.trim() && value.length <= 512 && !value.includes("/");
const object = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);
function field(data: Data, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (object(value) ? value[key] : undefined), data);
}
function phone(value: unknown): string {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value)) return "";
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("82") ? `0${digits.slice(2).replace(/^0/, "")}` : digits;
  return /^0\d{8,10}$/.test(local) ? local : "";
}
function phoneVariants(value: string): string[] {
  const local = phone(value);
  if (!local) return [];
  const prefix = local.startsWith("02") ? 2 : 3;
  const parts = [local.slice(0, prefix), local.slice(prefix, -4), local.slice(-4)];
  const international = [parts[0].slice(1), ...parts.slice(1)];
  return [
    ...new Set([
      value,
      local,
      `82${local.slice(1)}`,
      `+82${local.slice(1)}`,
      ...["-", " ", "."].flatMap((separator) => [
        parts.join(separator),
        `+82${separator}${international.join(separator)}`,
        `82${separator}${international.join(separator)}`,
      ]),
      `+82 ${international.join("-")}`,
      `+82 (0)${international.join(" ")}`,
    ]),
  ];
}

class BoundedReader {
  readonly issues = new Set<string>();
  private calls = 0;
  private documents = 0;
  private readonly queries = new Set<string>();
  private startedAt?: number;
  private lastClock?: number;
  constructor(
    private readonly db: WelcomeHistoryDb,
    private readonly clock: () => number,
  ) {
    this.withinTimeBudget();
  }
  // This prevents further reads, not cancellation of an in-flight SDK get(). Late results
  // retain useful blockers but cannot certify completeness, including a late final empty page.
  withinTimeBudget(): boolean {
    if (this.issues.has("history_time_limit") || this.issues.has("invalid_history_elapsed_clock")) return false;
    let current: number;
    try {
      current = this.clock();
    } catch {
      this.issues.add("invalid_history_elapsed_clock");
      return false;
    }
    if (!Number.isFinite(current) || (this.lastClock !== undefined && current < this.lastClock)) {
      this.issues.add("invalid_history_elapsed_clock");
      return false;
    }
    this.startedAt ??= current;
    this.lastClock = current;
    if (current - this.startedAt >= MEMBERSHIP_WELCOME_HISTORY_LIMITS.elapsedMs) {
      this.issues.add("history_time_limit");
      return false;
    }
    return true;
  }
  private reserve(): boolean {
    if (!this.withinTimeBudget()) return false;
    if (
      this.calls >= MEMBERSHIP_WELCOME_HISTORY_LIMITS.readCalls ||
      this.documents >= MEMBERSHIP_WELCOME_HISTORY_LIMITS.documents
    ) {
      this.issues.add("history_read_limit");
      return false;
    }
    this.calls += 1;
    return true;
  }
  async doc(id: string): Promise<WelcomeHistoryDocument | undefined> {
    if (!this.reserve()) return undefined;
    try {
      const doc = await this.db.collection("memberProfiles").doc(id).get();
      this.documents += 1;
      this.withinTimeBudget();
      if (doc.id !== id || !doc.exists) {
        this.issues.add("missing_member_alias");
        return undefined;
      }
      return doc;
    } catch {
      this.issues.add("memberProfiles_read_failed");
      return undefined;
    }
  }
  async scan(
    collection: string,
    key: string,
    value: string,
    visit: (doc: WelcomeHistoryDocument) => void,
    operator: "==" | "array-contains" = "==",
  ): Promise<void> {
    const queryKey = JSON.stringify([collection, key, operator, value]);
    if (this.queries.has(queryKey)) return;
    this.queries.add(queryKey);
    const seen = new Set<string>();
    let cursor = "";
    for (let page = 0; page < MEMBERSHIP_WELCOME_HISTORY_LIMITS.pagesPerQuery; page += 1) {
      if (!this.reserve()) return;
      const size = Math.min(
        MEMBERSHIP_WELCOME_HISTORY_LIMITS.pageSize,
        MEMBERSHIP_WELCOME_HISTORY_LIMITS.documents - this.documents,
      );
      try {
        let query = this.db.collection(collection).where(key, operator, value).orderBy("__name__").limit(size);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        this.withinTimeBudget();
        if (!Array.isArray(snapshot.docs) || snapshot.docs.length > size) {
          this.issues.add("invalid_history_page");
          return;
        }
        this.documents += snapshot.docs.length;
        for (const doc of snapshot.docs) {
          if (!validId(doc.id) || !doc.exists || seen.has(doc.id)) {
            this.issues.add("invalid_history_cursor");
            return;
          }
          seen.add(doc.id);
          visit(doc);
        }
        if (!this.withinTimeBudget()) return;
        if (snapshot.docs.length < size) return;
        cursor = snapshot.docs[snapshot.docs.length - 1].id;
      } catch {
        this.issues.add(`${collection}_read_failed`);
        return;
      }
    }
    // Even an exactly full final page needs another read to establish exhaustion.
    this.issues.add("history_page_limit");
  }
}

function normalizedStatus(status: string): MembershipWelcomeHistoryStatus {
  if (["done", "sent", "accepted"].includes(status)) return "accepted";
  if (status === "delivered") return "delivered";
  if (
    ["candidate", "reviewed", "pending", "queued", "retry", "ready", "lookup_ready", "template_pending"].includes(
      status,
    )
  )
    return "queued";
  if (["processing", "running", "sending"].includes(status)) return "sending";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  return status === "skipped" ? "skipped" : "unknown";
}
export function membershipWelcomeOutboundMarker(data: Data, depth = 0): boolean {
  if (depth > 5) return true;
  if (
    (Object.hasOwn(data, "attempted") && data.attempted !== false) ||
    (Object.hasOwn(data, "attempts") && data.attempts !== 0)
  )
    return true;
  return Object.entries(data).some(([key, value]) => {
    if (value == null || value === "") return false;
    if (
      /provider|solapi|outbound|messageId|groupId|sendId|sentAt|delivered|dispatch|acceptedAt|attemptedAt|attemptStartedAt|sendingStartedAt|lastAttempt|sendStartedAt|response|receipt/i.test(
        key,
      )
    )
      return true;
    return object(value)
      ? membershipWelcomeOutboundMarker(value, depth + 1)
      : Array.isArray(value) && value.some((item) => object(item) && membershipWelcomeOutboundMarker(item, depth + 1));
  });
}
function family(data: Data, id: string, collection: string): "welcome" | "other" | "unknown" {
  const type = text(data.type);
  const template = [text(data.templateCode), text(data.templateId), text(field(data, "kakaoOptions.templateId"))];
  const identities = [id, text(data.candidateId), text(data.alimtalkCandidateId)];
  if (
    collection === "onsiteWelcomeRequests" ||
    data.family === "new_member_welcome" ||
    WELCOME_TYPES.includes(type) ||
    template.some((value) => MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS.includes(value)) ||
    identities.some((value) => WELCOME_TYPES.some((prefix) => value.startsWith(`${prefix}_`)))
  )
    return "welcome";
  if (
    OTHER_TYPES.includes(type) ||
    identities.some((value) => OTHER_TYPES.some((prefix) => value.startsWith(`${prefix}_`)))
  )
    return "other";
  return "unknown";
}

export async function loadMembershipWelcomeHistory(
  db: WelcomeHistoryDb,
  input: MembershipWelcomeHistoryInput,
): Promise<MembershipWelcomeHistory> {
  const reader = new BoundedReader(db, input.elapsedNow ?? Date.now);
  const records = new Map<string, MembershipWelcomeHistoryRecord>();
  const ids = new Set<string>();
  const profiles = new Map<string, Data>();
  const parents = new Map<string, Set<string>>();
  const variants = new Set<string>(phoneVariants(input.phone));
  const normalizedPhone = phone(input.phone);
  const clock = new Date(input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now()));
  const checkedAt = Number.isFinite(clock.getTime()) ? clock.toISOString() : "";
  const result = (): MembershipWelcomeHistory => {
    reader.withinTimeBudget();
    return {
      records: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
      complete: reader.issues.size === 0,
      reason: [...reader.issues].sort().join(","),
      memberIds: [...ids].sort(),
      checkedAt,
      providerComplete: false,
    };
  };
  if (
    !validId(input.studioId) ||
    !validId(input.memberId) ||
    !normalizedPhone ||
    !checkedAt ||
    (input.ignoreCandidateId !== undefined && !validId(input.ignoreCandidateId))
  ) {
    reader.issues.add("invalid_history_input");
    return result();
  }
  const addId = (value: unknown): void => {
    if (!validId(value)) {
      reader.issues.add("invalid_member_alias");
      return;
    }
    if (!ids.has(value) && ids.size >= MEMBERSHIP_WELCOME_HISTORY_LIMITS.memberIds) {
      reader.issues.add("member_alias_limit");
      return;
    }
    ids.add(value);
  };
  const link = (from: string, to: unknown): void => {
    addId(to);
    if (!validId(to) || from === to) return;
    if (!parents.has(from)) parents.set(from, new Set());
    parents.get(from)!.add(to);
  };
  const visitProfile = (doc: WelcomeHistoryDocument): void => {
    const data = doc.data();
    if (!object(data)) {
      reader.issues.add("invalid_member_profile");
      return;
    }
    const previous = profiles.get(doc.id);
    if (previous) {
      const identity = (profile: Data): string =>
        JSON.stringify(
          ["studioId", "phone", "status", ...PROFILE_ID_FIELDS, ...ALIAS_LISTS].map((key) => field(profile, key)),
        );
      if (identity(previous) !== identity(data)) reader.issues.add("member_alias_changed_during_read");
      return;
    }
    // Cross-studio phone matches are not aliases; an explicitly linked cross-studio ID is an error.
    if (data.studioId !== input.studioId) {
      if (ids.has(doc.id) || !text(data.studioId)) reader.issues.add("member_alias_studio_conflict");
      return;
    }
    addId(doc.id);
    if (!ids.has(doc.id)) return;
    profiles.set(doc.id, data);
    const profilePhone = phone(data.phone);
    if (!profilePhone || profilePhone !== normalizedPhone) reader.issues.add("member_alias_phone_conflict");
    if (profilePhone === normalizedPhone && typeof data.phone === "string") variants.add(data.phone);
    if (!validId(data.memberId)) reader.issues.add("missing_member_alias");
    for (const key of PROFILE_ID_FIELDS) {
      const value = field(data, key);
      if (value != null && value !== "") link(doc.id, value);
    }
    const targets = ALIAS_POINTERS.map((key) => text(field(data, key))).filter(Boolean);
    if (new Set(targets).size > 1) reader.issues.add("member_alias_conflict");
    if (data.status === "merged" && !targets.some((target) => target !== doc.id))
      reader.issues.add("missing_member_alias");
    for (const key of ALIAS_LISTS) {
      const values = field(data, key);
      if (values == null) continue;
      if (!Array.isArray(values)) {
        reader.issues.add("invalid_member_alias");
        continue;
      }
      if (values.length > MEMBERSHIP_WELCOME_HISTORY_LIMITS.memberIds) reader.issues.add("member_alias_limit");
      for (const value of values.slice(0, MEMBERSHIP_WELCOME_HISTORY_LIMITS.memberIds)) {
        addId(value);
        if (validId(value)) link(value, doc.id);
      }
    }
  };
  addId(input.memberId);
  // A last-four query discovers nonstandard profile formatting, but is never an identity match alone.
  await reader.scan("memberProfiles", "phoneLast4", normalizedPhone.slice(-4), (doc) => {
    const data = doc.data();
    if (!object(data) || !phone(data.phone)) reader.issues.add("invalid_member_profile");
    else if (phone(data.phone) === normalizedPhone) visitProfile(doc);
  });
  const checkedIds = new Set<string>();
  const checkedPhones = new Set<string>();
  // Resolve both frontiers to closure: ID lookups can reveal new raw phone spellings.
  while (checkedIds.size < ids.size || checkedPhones.size < variants.size) {
    for (const value of variants) {
      if (checkedPhones.has(value)) continue;
      checkedPhones.add(value);
      await reader.scan("memberProfiles", "phone", value, visitProfile);
    }
    for (const id of ids) {
      if (checkedIds.has(id)) continue;
      checkedIds.add(id);
      if (!profiles.has(id)) {
        const doc = await reader.doc(id);
        if (doc) visitProfile(doc);
      }
      for (const key of PROFILE_ID_FIELDS) await reader.scan("memberProfiles", key, id, visitProfile);
      for (const key of ALIAS_LISTS) await reader.scan("memberProfiles", key, id, visitProfile, "array-contains");
    }
  }
  const rootCache = new Map<string, Set<string>>();
  const roots = (id: string, path = new Set<string>()): Set<string> => {
    if (path.has(id)) {
      reader.issues.add("member_alias_cycle");
      return new Set();
    }
    const cached = rootCache.get(id);
    if (cached) return cached;
    if (!profiles.has(id)) reader.issues.add("missing_member_alias");
    const next = parents.get(id);
    if (!next?.size) return new Set([id]);
    const nextPath = new Set([...path, id]);
    const resolved = new Set([...next].flatMap((parent) => [...roots(parent, nextPath)]));
    rootCache.set(id, resolved);
    return resolved;
  };
  const allRoots = new Set([...ids].flatMap((id) => [...roots(id)]));
  if (allRoots.size !== 1) reader.issues.add("member_alias_conflict");

  for (const collection of HISTORY_COLLECTIONS) {
    const visit = (doc: WelcomeHistoryDocument): void => {
      // Only the exact candidate document is exempt, never its send/request or a sibling candidate.
      if (collection === "alimtalkCandidates" && doc.id === input.ignoreCandidateId) return;
      const data = doc.data();
      if (!object(data)) {
        reader.issues.add("invalid_history_document");
        return;
      }
      if (text(data.studioId) && data.studioId !== input.studioId) return;
      if (data.studioId !== input.studioId) reader.issues.add("history_studio_missing");
      const classification = family(data, doc.id, collection);
      if (classification === "other") return;
      if (classification === "unknown") reader.issues.add("unknown_welcome_family");
      for (const key of ["memberId", "lookup.memberId"]) {
        const value = field(data, key);
        if (value != null && value !== "" && (!validId(value) || !ids.has(value)))
          reader.issues.add("unresolved_history_alias");
      }
      for (const key of ["memberPhone", "phone", "lookup.memberPhone"]) {
        const value = field(data, key);
        if (value != null && value !== "" && phone(value) !== normalizedPhone)
          reader.issues.add("history_phone_conflict");
      }
      const sourceStatus = text(data.status);
      const status = classification === "unknown" ? "unknown" : normalizedStatus(sourceStatus);
      if (status === "unknown") reader.issues.add("unknown_history_state");
      const attempts =
        typeof data.attempts === "number" && Number.isSafeInteger(data.attempts) && data.attempts >= 0
          ? data.attempts
          : null;
      const attempted = !(
        data.attempted === false &&
        attempts === 0 &&
        !membershipWelcomeOutboundMarker(data) &&
        ["failed", "cancelled", "skipped", "queued"].includes(status)
      );
      const id = `${collection}/${doc.id}`;
      const record: MembershipWelcomeHistoryRecord = {
        id,
        sourceId: doc.id,
        sourceCollection: collection,
        family: "new_member_welcome",
        templateId: text(data.templateCode) || text(data.templateId) || text(field(data, "kakaoOptions.templateId")),
        status,
        sourceStatus,
        attempted,
        attempts,
      };
      const previous = records.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
        reader.issues.add("history_changed_during_read");
        record.status = "unknown";
        record.attempted = true;
      }
      records.set(id, record);
    };
    const idFields = collection === "onsiteWelcomeRequests" ? ["memberId", "lookup.memberId"] : ["memberId"];
    const phoneFields =
      collection === "onsiteWelcomeRequests"
        ? ["phone", "memberPhone", "lookup.memberPhone"]
        : ["memberPhone", "phone"];
    for (const id of ids) for (const key of idFields) await reader.scan(collection, key, id, visit);
    for (const value of variants) for (const key of phoneFields) await reader.scan(collection, key, value, visit);
  }
  return result();
}
