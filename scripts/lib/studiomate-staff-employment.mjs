export const STAFF_EMPLOYMENT_SOURCE = "studiomate_staff_tab_browser_scan";

export function validateStaffSnapshot(snapshot, { studioId = "5330", now = new Date() } = {}) {
  if (snapshot?.source !== STAFF_EMPLOYMENT_SOURCE || snapshot.studioId !== studioId || snapshot.complete !== true) {
    throw new Error("Staff snapshot source, studio or completeness is invalid");
  }
  const url = new URL(snapshot.scanUrl);
  if (url.origin !== "https://arcpilates.studiomate.kr" || url.pathname !== "/staffs") throw new Error("Unexpected staff source URL");
  const age = now.getTime() - Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 60 * 60 * 1000) throw new Error("Staff snapshot is not fresh");
  if (snapshot.filters?.role !== "전체" || snapshot.filters?.employmentType !== "전체" || snapshot.filters?.search !== "") {
    throw new Error("Staff source must be unfiltered");
  }
  if (!Number.isInteger(snapshot.total) || snapshot.total < 1 || snapshot.total > 200 || snapshot.staffs?.length !== snapshot.total) {
    throw new Error("Empty or incomplete staff roster; no employment changes allowed");
  }
  const ids = new Set(), phones = new Set();
  for (const staff of snapshot.staffs) {
    if (!/^\d+$/.test(staff.staffId) || !staff.name?.trim() || !/^010\d{8}$/.test(staff.phone)) throw new Error("Staff identity is incomplete");
    if (ids.has(staff.staffId) || phones.has(staff.phone)) throw new Error("Duplicate staff identity in source roster");
    ids.add(staff.staffId);
    phones.add(staff.phone);
  }
  return snapshot;
}

export function buildStaffEmploymentPlans(snapshot, existing, { staffIdScope = "", now = new Date() } = {}) {
  validateStaffSnapshot(snapshot, { now });
  const sourceById = new Map(snapshot.staffs.map(s => [s.staffId, s]));
  const existingById = new Map(existing.map(s => [String(s.staffId || s.docId), s]));
  if (staffIdScope && !sourceById.has(staffIdScope)) throw new Error("Scoped staff is absent from the complete source roster");
  const writes = [];
  for (const source of snapshot.staffs) {
    if (staffIdScope && source.staffId !== staffIdScope) continue;
    const current = existingById.get(source.staffId);
    const phone = String(current?.phone || "").replace(/\D/g, "");
    if (current && phone && phone !== source.phone) throw new Error(`Staff phone mismatch: ${source.staffId}`);
    const samePhone = existing.filter(s => String(s.phone || "").replace(/\D/g, "") === source.phone);
    if (samePhone.some(s => String(s.staffId || s.docId) !== source.staffId)) throw new Error(`Ambiguous staff phone: ${source.staffId}`);
    const data = {
      employmentStatus: "current", employmentSource: STAFF_EMPLOYMENT_SOURCE,
      employmentReason: null,
      employmentSyncedAt: snapshot.capturedAt, employmentSourceName: source.name,
      studiomateEmploymentType: source.employmentType || "", studiomateRole: source.sourceRole || "",
    };
    if (!current) Object.assign(data, {
      staffId: source.staffId, studiomateStaffId: source.staffId, studioId: snapshot.studioId,
      name: source.name, phone: source.phone, phoneLast4: source.phone.slice(-4),
      role: "instructor", active: false, createdAt: snapshot.capturedAt,
    });
    writes.push({ staffId: source.staffId, docId: current?.docId || source.staffId, name: source.name,
      change: current ? "sync_current_employment" : "create_unprovisioned_staff", before: current?.employmentStatus || null, data });
  }
  const skippedOperators = [];
  if (!staffIdScope) {
    for (const current of existing) {
      const id = String(current.staffId || current.docId);
      if (sourceById.has(id)) continue;
      if (!/^\d+$/.test(id) || !current.studiomateStaffId) {
        skippedOperators.push({ staffId: id, name: current.name });
        continue;
      }
      writes.push({ staffId: id, docId: current.docId || id, name: current.name,
        change: "sync_absent_employment", before: current.employmentStatus || null,
        data: { employmentStatus: "inactive", employmentSource: STAFF_EMPLOYMENT_SOURCE,
          employmentSyncedAt: snapshot.capturedAt, employmentReason: "StudioMate 전체 강사 명단에서 제외" } });
    }
    const previousCurrent = existing.filter(s => s.employmentStatus === "current" || (!s.employmentStatus && s.active === true && /^\d+$/.test(String(s.staffId || s.docId))));
    const lost = previousCurrent.filter(s => !sourceById.has(String(s.staffId || s.docId)));
    if (previousCurrent.length >= 4 && lost.length > previousCurrent.length / 2) throw new Error("Staff roster coverage loss requires operator review");
  }
  return { writes, skippedOperators };
}

export function staffScanDue(state, now = new Date()) {
  if (state?.fullScanComplete !== true) return true;
  const previous = Date.parse(state.lastFullScanAt || "");
  const age = now.getTime() - previous;
  return !Number.isFinite(previous) || age < -60000 || age >= 24 * 60 * 60 * 1000;
}
