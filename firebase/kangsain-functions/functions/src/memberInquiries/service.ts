import { memberInquiryContract as contract } from "./contract";
import { assertActor, assertAssignee, assertRead, hash, InquiryError, manager, text, transition, validateSubmission } from "./policy";
import type { Actor, InquiryRow } from "./policy";
import {guidanceEvidence} from './guidance';
import {readInquiryMemberContext,readInquiryMemberLink} from './memberContext';

type Dependencies = { db: any; now?: () => number };
const requestId = (key: string) => "mi_" + hash(["member_inquiry_v1", key]).slice(0, 32);
const validId = (value: unknown): value is string => typeof value === "string" && /^mi_[a-f0-9]{32}$/.test(value);
const mask = (phone: string) => phone.slice(0, 3) + "-****-" + phone.slice(-4);
const expireMillis = (value: any) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Date.parse(value));
const contactRecorded = (row: any) => Boolean(row.reviewHash&&row.notification?.reviewHash===row.reviewHash&&['manual_contact_recorded','not_required'].includes(row.notification.outcome));

export function createInquiryService({ db, now = Date.now }: Dependencies) {
  const requests = () => db.collection(contract.requests);
  async function assignmentIssue(staffId: string) {
    if(!staffId)return null;
    const doc=await db.collection('staffs').doc(staffId).get(),target=doc.data();
    try { if(!target||target.staffId!==staffId) return 'not_current_staff'; assertAssignee(target); return null; }
    catch { return 'not_current_staff'; }
  }
  function readable(actor: Actor, row: InquiryRow) {
    assertRead(actor, row);
    if (!Number.isFinite(expireMillis(row.expiresAt)) || expireMillis(row.expiresAt) <= now())
      throw new InquiryError(404, "보관기간이 만료된 문의입니다.");
  }
  async function settings() {
    const result = await db.doc(contract.settingsPath).get(), value = result.data();
    if (!result.exists || value?.enabled !== true || value?.promotionApproved !== true || value?.privacyApproved !== true || value?.retentionReady !== true ||
      value?.policyVersion !== contract.policyVersion || value?.privacyVersion !== contract.privacyVersion ||
      value?.retentionDays !== contract.retentionDays || value?.studioId !== contract.studioId)
      throw new InquiryError(503, "문의 접수를 준비 중입니다. 센터로 문의해 주세요.");
    return value;
  }
  async function submit(body: unknown, ip: string) {
    const config = await settings();
    const payload = validateSubmission(body), key = (body as any).requestKey;
    const id = requestId(key), ref = requests().doc(id), payloadHash = hash(payload), clock = now();
    const assigned = config.defaultAssignees?.[payload.category] || "";
    if (assigned && !/^[a-zA-Z0-9_-]{1,128}$/.test(assigned)) throw new InquiryError(503, "담당자 설정 확인이 필요합니다.");
    const bucket = Math.floor(clock / (15 * 60 * 1000));
    const ipRef = db.collection(contract.limits).doc(hash(["ip", ip, bucket]));
    const phoneRef = db.collection(contract.limits).doc(hash(["phone", payload.memberPhone, bucket]));
    return db.runTransaction(async (tx: any) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        if (existing.data()?.payloadHash !== payloadHash) throw new InquiryError(409, "접수 내용이 바뀌었습니다. 새 문의로 접수해 주세요.");
        return { ok: true, receiptId: id, status: "received", duplicate: true };
      }
      const [ipLimit, phoneLimit, staff] = await Promise.all([
        tx.get(ipRef), tx.get(phoneRef), assigned ? tx.get(db.collection("staffs").doc(assigned)) : Promise.resolve(null),
      ]);
      if ((ipLimit.data()?.count || 0) >= 20 || (phoneLimit.data()?.count || 0) >= 5)
        throw new InquiryError(429, "접수가 많습니다. 잠시 후 다시 시도해 주세요.");
      if (assigned) {
        const actor = staff?.data();
        if (!actor || actor.staffId !== assigned) throw new InquiryError(503, "담당자 설정 확인이 필요합니다.");
        assertAssignee(actor);
      }
      const at = new Date(clock).toISOString(), expiresAt = new Date(clock + contract.retentionDays * 86400000);
      const row = { ...payload, id, studioId: contract.studioId, status: "received", revision: 1,
        identityStatus: "unverified", source: "member_help_form", payloadHash,
        assignedStaffId: assigned, assignedStaffName: staff?.data()?.name || "",
        createdAt: at, updatedAt: at, expiresAt, review: null, reviewHash: null, approval: null,
        completion: null, execution: null, notification: null, workflowVersion:2, policyGuidance:guidanceEvidence(payload.category,payload.answers),
        memberNotificationStatus: "not_sent_by_system", externalExecutionAuthorized: false };
      tx.create(ref, row);
      tx.create(ref.collection(contract.events).doc("r000001"), { revision: 1, action: "received", at,
        actor: "member_form", source: "unverified_member_claim", policyVersion: contract.policyVersion, expiresAt });
      for (const [limit, snap] of [[ipRef, ipLimit], [phoneRef, phoneLimit]])
        tx.set(limit, { count: (snap.data()?.count || 0) + 1, bucket, expiresAt: new Date(clock + 86400000) });
      return { ok: true, receiptId: id, status: "received", duplicate: false };
    });
  }
  async function lookup(body: any, ip: string) {
    await settings();
    if (!body || Object.keys(body).some(key => !["action", "requestKey"].includes(key)) ||
      typeof body.requestKey !== "string" || !/^[a-f0-9]{48}$/.test(body.requestKey)) throw new InquiryError(400, "접수 확인 정보를 확인해 주세요.");
    const clock = now(), id = requestId(body.requestKey);
    const limit = db.collection(contract.limits).doc(hash(["lookup", ip, Math.floor(clock / 900000)]));
    return db.runTransaction(async (tx: any) => {
      const [prior, snap] = await Promise.all([tx.get(limit), tx.get(requests().doc(id))]);
      if ((prior.data()?.count || 0) >= 30) throw new InquiryError(429, "잠시 후 다시 확인해 주세요.");
      tx.set(limit, { count: (prior.data()?.count || 0) + 1, expiresAt: new Date(clock + 86400000) });
      // The random browser key is a receipt capability, never a member/ticket lookup credential.
      return snap.exists && expireMillis(snap.data()?.expiresAt) > clock ? { ok: true, receiptId: id, status: "received" } :
        { ok: true, receiptId: null, status: "unconfirmed" };
    });
  }
  async function staff(actor: Actor, input: any) {
    assertActor(actor);
    const config = await settings();
    if (!input || typeof input.action !== "string") throw new InquiryError(400, "처리 내용을 확인해 주세요.");
    if (input.action === "access") {
      const eligible = manager(actor) ? await db.collection("staffs").where("studioId", "==", actor.studioId).where("active", "==", true).limit(200).get() : null;
      return { ok: true, manager: manager(actor), staffId: actor.staffId, name: actor.name,
        responseDelayHours:[24,48].includes(config.responseDelayHours)?config.responseDelayHours:null,
        assignees: eligible ? eligible.docs.filter((doc: any) => {
          const item = doc.data();
          try { assertAssignee(item); return doc.id === item.staffId; } catch { return false; }
        }).map((doc: any) => { const item = doc.data(); return { staffId: item.staffId, name: item.name }; }) : [] };
    }
    if (input.action === "list") {
      let query = requests().where("studioId", "==", actor.studioId);
      query = query.orderBy("createdAt", "desc");
      if (input.cursor) {
        if (!validId(input.cursor)) throw new InquiryError(400, "조회 위치를 확인해 주세요.");
        const cursor = await requests().doc(input.cursor).get();
        if (!cursor.exists) throw new InquiryError(409, "목록을 새로 조회해 주세요.");
        assertRead(actor, cursor.data());
        query = query.startAfter(cursor);
      }
      // Filter before pagination; expired rows are excluded from the response even before TTL deletion.
      const snapshot = await query.limit(100).get();
      const rows = snapshot.docs.map((doc: any) => doc.data()).filter((row: InquiryRow) =>
        row.studioId === actor.studioId && expireMillis(row.expiresAt) > now());
      const last = snapshot.docs.at(-1);
      const nextCursor = snapshot.size === 100 && last ? last.id : null;
      const staffIds=[...new Set(rows.map((row:any)=>row.assignedStaffId).filter(Boolean))] as string[];
      const issues=new Map(await Promise.all(staffIds.map(async id=>[id,await assignmentIssue(id)] as const)));
      return { ok: true, rows: rows.map((row: any) => ({ id: row.id, category: row.category, memberName: row.memberName,
        maskedPhone: mask(row.memberPhone), status: row.status, revision: row.revision, assignedStaffName: row.assignedStaffName,
        assignedStaffId:row.assignedStaffId,assignmentIssue:issues.get(row.assignedStaffId)||null,contactRecorded:contactRecorded(row),
        createdAt: row.createdAt, updatedAt: row.updatedAt })), nextCursor,
        coverage: { scanned: snapshot.size, limited: snapshot.size === 100,
          note: "같은 지점의 전체 문의를 최신순 100건씩 조회" } };
    }
    if (!validId(input.id)) throw new InquiryError(400, "문의번호를 확인해 주세요.");
    const ref = requests().doc(input.id);
    if (input.action === "get" || input.action === "context") {
      const snap = await ref.get();
      if (!snap.exists) throw new InquiryError(404, "문의 내역을 찾을 수 없습니다.");
      const row = snap.data(); readable(actor, row);
      if(input.action==='context')return {ok:true,context:await readInquiryMemberContext(db,row,now())};
      const [memberLink,events]=await Promise.all([
        readInquiryMemberLink(db,row,now()).catch(()=>({status:'unavailable'})),
        ref.collection(contract.events).orderBy("revision", "desc").limit(50).get(),
      ]);
      return { ok: true, row: { ...row, memberLink,contactRecorded:contactRecorded(row),assignmentIssue:await assignmentIssue(row.assignedStaffId),expiresAt: new Date(expireMillis(row.expiresAt)).toISOString() },
        events: events.docs.map((doc: any) => { const event = doc.data(); return { ...event, expiresAt: new Date(expireMillis(event.expiresAt)).toISOString() }; }) };
    }
    if (typeof input.commandId !== "string" || !/^[a-f0-9]{48}$/.test(input.commandId)) throw new InquiryError(400, "작업 식별값을 확인해 주세요.");
    const command = ref.collection(contract.commands).doc(hash([actor.staffId, input.commandId]));
    const commandHash = hash(input);
    return db.runTransaction(async (tx: any) => {
      const [snap, prior] = await Promise.all([tx.get(ref), tx.get(command)]);
      if (!snap.exists) throw new InquiryError(404, "문의 내역을 찾을 수 없습니다.");
      const row = snap.data() as InquiryRow; readable(actor, row);
      if (prior.exists) {
        if (prior.data()?.inputHash !== commandHash) throw new InquiryError(409, "같은 작업의 내용이 변경되었습니다.");
        return { ...prior.data()?.result, replayed: true };
      }
      let patch: Record<string, any>;
      if (input.action === "assign") {
        if (!manager(actor) || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.assignedStaffId || "")) throw new InquiryError(403, "관리자가 담당자를 지정해 주세요.");
        if (input.expectedRevision !== row.revision || row.status === "completed") throw new InquiryError(409, "현재 문의 상태를 다시 조회해 주세요.");
        const target = (await tx.get(db.collection("staffs").doc(input.assignedStaffId))).data();
        if (!target || target.staffId !== input.assignedStaffId) throw new InquiryError(400, "담당자를 확인해 주세요.");
        assertAssignee(target);
        const assignmentReason=text(input.assignmentReason??'',500,Boolean(row.assignedStaffId&&row.assignedStaffId!==target.staffId));
        patch = { assignedStaffId: target.staffId, assignedStaffName: target.name, revision: row.revision + 1,
          handoffReason:assignmentReason,
          updatedAt: new Date(now()).toISOString() };
      } else patch = transition(row, actor, input, new Date(now()).toISOString());
      const result = { ok: true, id: row.id, revision: patch.revision, status: patch.status || row.status };
      tx.update(ref, patch);
      tx.create(ref.collection(contract.events).doc("r" + String(patch.revision).padStart(6, "0")), {
        action: input.action, revision: patch.revision, actor: actor.staffId, actorName: actor.name, at: patch.updatedAt,
        previousStatus: row.status, status: result.status, reviewHash: patch.reviewHash || row.reviewHash || null,
        ...(input.action==='assign'||input.action==='claim'?{assignment:{fromStaffId:row.assignedStaffId||'',fromName:row.assignedStaffName||'',toStaffId:patch.assignedStaffId,toName:patch.assignedStaffName,reason:patch.handoffReason||''}}:{}),
        ...(patch.execution?{execution:patch.execution}:{}),...(patch.notification?{notification:patch.notification}:{}),
        decision: patch.approval || null, expiresAt: row.expiresAt });
      tx.create(command, { inputHash: commandHash, result, at: patch.updatedAt, expiresAt: row.expiresAt });
      return result;
    });
  }
  return { submit, lookup, staff };
}
