import { createHash } from "node:crypto";

export const HOLDING_ROSTER_LANE = "holding-allowance-notice";
export const HOLDING_ROSTER_STATE = `workLanes/${HOLDING_ROSTER_LANE}/state/excelHoldingRoster`;
export const HOLDING_ROSTER_JOBS = `workLanes/${HOLDING_ROSTER_LANE}/readbackJobs`;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = value => String(value ?? "").trim().replace(/\s+/g, " ");
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function holdingRosterPhone(value) {
  let phone = text(value).replace(/\D/g, "");
  if (phone.startsWith("82")) phone = `0${phone.slice(2)}`;
  return /^01[016789]\d{7,8}$/.test(phone) ? phone : "";
}
export const holdingRosterMemberKey = phone => {
  const normalized = holdingRosterPhone(phone);
  return normalized ? hash(normalized) : "";
};
const isHeld = status => /^(?:일시|사용)?(?:정지|중지|홀딩)(?:중|예정)?(?:\([^()]*\))?$/.test(text(status).replace(/\s/g, "")) &&
  !/해제|취소|만료/.test(status);
const blocked = reason => ({ ok: false, mode: "discovery_only", reason, jobs: [], sends: 0 });

export function buildHoldingRoster(rows) {
  if (!Array.isArray(rows) || !rows.length || !rows.every(row => record(row) &&
    ["전화번호", "수강권명", "수강권상태"].every(key => Object.hasOwn(row, key))))
    throw new Error("empty_or_incomplete_holding_export");
  const members = new Map();
  for (const row of rows) {
    const phone = holdingRosterPhone(row["전화번호"]), ticketName = text(row["수강권명"]);
    const status = text(row["수강권상태"]), held = isHeld(status);
    if (held && (!phone || !ticketName)) throw new Error("holding_row_identity_missing");
    if (!held && /정지|중지|홀딩/.test(status) && !/해제|취소|만료/.test(status))
      throw new Error("unrecognized_holding_status");
    if (!phone) continue;
    const key = holdingRosterMemberKey(phone);
    const member = members.get(key) || { key, rows: 0, tickets: [], productCounts: Object.create(null) };
    member.rows++;
    if (ticketName) member.productCounts[ticketName] = (member.productCounts[ticketName] || 0) + 1;
    if (held) member.tickets.push({ ticketName, status, startText: text(row["수강권시작일"]),
      endText: text(row["수강권종료일"]), updatedAtText: text(row["수강권최종수정일"]) });
    members.set(key, member);
  }
  if (!members.size) throw new Error("export_has_no_member_identities");
  for (const member of members.values()) {
    member.tickets.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    member.fingerprint = hash(member.tickets);
  }
  return members;
}

function validState(value) {
  return record(value) && value.schemaVersion === 2 && value.mode === "discovery_only" &&
    instant(value.downloadedAt) && instant(value.initializedAt) && instant(value.updatedAt) &&
    Date.parse(value.initializedAt) <= Date.parse(value.updatedAt) &&
    Date.parse(value.downloadedAt) <= Date.parse(value.updatedAt) &&
    typeof value.sourceImportId === "string" && !!value.sourceImportId.trim() &&
    Number.isSafeInteger(value.totalRows) && value.totalRows > 0 &&
    record(value.rowCounts) && Object.keys(value.rowCounts).length > 0 &&
    Object.entries(value.rowCounts).every(([key, count]) => digest(key) && Number.isSafeInteger(count) && count > 0) &&
    Object.values(value.rowCounts).reduce((a, b) => a + b, 0) <= value.totalRows &&
    record(value.held) && Object.entries(value.held).every(([key, member]) => digest(key) && value.rowCounts[key] &&
      record(member) && digest(member.fingerprint) && Array.isArray(member.tickets) && member.tickets.length > 0 &&
      member.tickets.length <= value.rowCounts[key] &&
      member.tickets.every(ticket => record(ticket) && typeof ticket.ticketName === "string" && !!ticket.ticketName &&
        [ticket.status, ticket.startText, ticket.endText, ticket.updatedAtText].every(v => typeof v === "string") && isHeld(ticket.status)) &&
      hash(member.tickets) === member.fingerprint);
}

/** Excel determines read-only discovery scope, never a hold identity, allowance, or send. */
export function planHoldingRoster({ rows, source, previous = null, profiles = [], now = new Date().toISOString() }) {
  if (!instant(now) || !instant(source?.downloadedAt) || source.applied !== true || source.complete !== true ||
    source.studioId !== "5330" || typeof source.sourceImportId !== "string" || !source.sourceImportId.trim() ||
    Date.parse(now) - Date.parse(source.downloadedAt) < 0 || Date.parse(now) - Date.parse(source.downloadedAt) > 30 * 60_000)
    return blocked("fresh_complete_applied_member_export_required");
  if (!Array.isArray(profiles)) return blocked("invalid_native_member_profiles");
  if (previous !== null && !validState(previous)) return blocked("invalid_roster_baseline_review_required");
  if (previous && Date.parse(previous.downloadedAt) >= Date.parse(source.downloadedAt))
    return { ok: true, mode: "discovery_only", reason: "already_observed_or_older_download", jobs: [], sends: 0 };
  let members;
  try { members = buildHoldingRoster(rows); } catch (error) { return blocked(error.message); }
  const rowCounts = Object.fromEntries([...members.values()].map(member => [member.key, member.rows]));
  const priorKeys = previous ? Object.keys(previous.rowCounts) : [];
  const missing = priorKeys.filter(key => !rowCounts[key]);
  if (previous && (missing.length / priorKeys.length > 0.05 || rows.length < previous.totalRows * 0.95))
    return blocked("holding_export_coverage_loss_review_required");
  const byKey = new Map();
  for (const profile of profiles) {
    if (!record(profile) || !nativeId(profile.memberId) || profile.studioId !== "5330") continue;
    const key = holdingRosterMemberKey(profile.phone);
    if (!key) continue;
    const ids = byKey.get(key) || new Set();
    ids.add(profile.memberId);
    byKey.set(key, ids);
  }
  const held = Object.fromEntries([...members.values()].filter(member => member.tickets.length).map(member =>
    [member.key, { fingerprint: member.fingerprint, tickets: member.tickets }]));
  const jobs = [], counts = { baseline: 0, entered: 0, continued: 0, changed: 0, left: 0, review: 0 };
  for (const memberKey of new Set([...Object.keys(held), ...Object.keys(previous?.held || {})])) {
    const current = held[memberKey], old = previous?.held[memberKey];
    const transition = !previous ? "baseline" : !current ? "left" : !old ? "entered" :
      current.fingerprint === old.fingerprint ? "continued" : "changed";
    counts[transition]++;
    const currentMember = members.get(memberKey), memberIds = [...(byKey.get(memberKey) || [])];
    const names = new Set([...(current?.tickets || []), ...(old?.tickets || [])].map(ticket => ticket.ticketName));
    for (const ticketName of names) {
      const ambiguous = (currentMember?.productCounts[ticketName] || 0) > 1 ||
        (old?.tickets.filter(ticket => ticket.ticketName === ticketName).length || 0) > 1;
      const reason = memberIds.length !== 1 ? "native_member_phone_match_required" : ambiguous ? "duplicate_product_readback_review_required" : "";
      if (reason) counts.review++;
      const jobId = hash([memberKey, ticketName]);
      jobs.push({ jobId, memberKey, memberId: memberIds.length === 1 ? memberIds[0] : null,
        studioId: "5330", ticketName, transition, status: reason ? "review" : "pending", reason,
        sourceImportId: source.sourceImportId, downloadedAt: source.downloadedAt,
        discoveryVersion: hash([source.sourceImportId, source.downloadedAt, memberKey, ticketName, current?.fingerprint || "absent"]),
        baselineOnly: transition === "baseline", absenceConfirmed: false, sendAllowed: false, requestedAt: now });
    }
  }
  const state = { schemaVersion: 2, mode: "discovery_only", sourceImportId: source.sourceImportId,
    downloadedAt: source.downloadedAt, initializedAt: previous?.initializedAt || now, updatedAt: now,
    totalRows: rows.length, rowCounts, held };
  if (jobs.length > 400 || Buffer.byteLength(JSON.stringify(state)) > 700_000)
    return blocked("holding_roster_bounded_capacity_review_required");
  return { ok: true, mode: "discovery_only", reason: previous ? "roster_compared" : "no_send_baseline",
    counts, state, jobs, sends: 0 };
}

export async function observeHoldingRoster({ db, rows, source, profiles, now = new Date().toISOString() }) {
  return db.runTransaction(async tx => {
    const stateRef = db.doc(HOLDING_ROSTER_STATE), previous = (await tx.get(stateRef)).data() || null;
    const plan = planHoldingRoster({ rows, source, profiles, previous, now });
    if (!plan.ok || !plan.state) return { ...plan, state: undefined };
    const refs = plan.jobs.map(job => db.doc(`${HOLDING_ROSTER_JOBS}/${job.jobId}`));
    const oldJobs = [];
    for (const ref of refs) oldJobs.push((await tx.get(ref)).data());
    for (const [index, job] of plan.jobs.entries()) {
      const old = oldJobs[index];
      tx.set(refs[index], { ...job, requestedAt: old?.status === "pending" && instant(old.requestedAt) ? old.requestedAt : now,
        ...(old?.status === "pending" && instant(old.lastCheckedAt) ? { lastCheckedAt: old.lastCheckedAt } : {}),
        updatedAt: now });
    }
    tx.set(stateRef, plan.state);
    return { ok: true, mode: plan.mode, reason: plan.reason, counts: plan.counts,
      readbackJobs: plan.jobs.length, sourceImportId: source.sourceImportId, sends: 0 };
  });
}

export function holdingRosterReadbackIssue(job, profile) {
  if (!record(job) || !digest(job.memberKey) || !nativeId(job.memberId) || !digest(job.discoveryVersion) ||
    job.jobId !== hash([job.memberKey, job.ticketName]) || typeof job.ticketName !== "string" || !job.ticketName.trim() ||
    job.status !== "pending" || job.studioId !== "5330" || job.sendAllowed !== false || job.absenceConfirmed !== false ||
    !instant(job.downloadedAt) || !instant(job.requestedAt) ||
    typeof job.sourceImportId !== "string" || !job.sourceImportId.trim()) return "holding_roster_job_invalid";
  return profile?.studioId === "5330" && holdingRosterMemberKey(profile.phone) === job.memberKey
    ? "" : "holding_roster_native_member_recheck_failed";
}

export function holdingRosterReadbackIsCurrent(current, target) {
  return !!current && current.status === "pending" && current.discoveryVersion === target.discoveryVersion &&
    current.memberKey === target.memberKey && current.memberId === target.memberId && current.ticketName === target.ticketName &&
    current.sendAllowed === false && current.absenceConfirmed === false;
}
