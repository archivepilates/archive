import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const chartRepairHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const phoneHash = value => createHash('sha256').update(String(value)).digest('hex');
const time = value => value?.toMillis?.() ?? Date.parse(value);

// Operator-only, scoped CAS repair. The native reader is separate; this helper never browses or sends.
export async function repairPrivateChartMemberLink({ db, scope, audit, now = () => Date.now() }) {
  const proof = audit?.proof, notion = audit?.notionProof;
  const fresh = () => {
    for (const at of [proof?.checkedAt, proof?.bookingCheckedAt, notion?.checkedAt, audit?.observedAt]) {
      const age = now() - Date.parse(at);
      assert.ok(Number.isFinite(age) && age >= 0 && age <= 10 * 60000, 'Fresh live proof required');
    }
  };
  assert.ok(scope?.recordIds?.length === 2 && new Set(scope.recordIds).size === 2 &&
    scope.recordIds.every(id => /^plc_\d+$/.test(id)), 'Exact two-record scope required');
  assert.ok(/^excel_[a-f0-9]+$/.test(scope.profileId) && /^\d+$/.test(scope.nativeId) &&
    /^workLanes\/[a-z0-9-]+\/reports\/[a-z0-9-]+$/.test(scope.auditPath), 'Invalid repair scope');
  assert.ok(proof?.memberId === scope.profileId && proof.nativeMemberId === scope.nativeId &&
    proof.queryKind === 'full_phone' && proof.uniqueMatchCount === 1 && proof.liveReadback === true &&
    proof.sourceKind === 'studiomate_rendered_dom' && proof.coverage?.complete === true &&
    proof.coverage?.traversalComplete === true && proof.coverage?.atomicSnapshot === false,
  'Unique complete native identity/booking proof required');
  assert.ok(notion?.complete === true && notion.rootActive === true &&
    notion.matchingFolderIds?.length === 0 && notion.peers?.every(p => !p.hasPage) &&
    notion.bindings?.length === 2 && notion.bindings.every(b => !b.exists), 'Notion ownership requires review');
  assert.equal(audit.priorRepairExists, false, 'Prior repair requires readback, not replay');
  fresh();
  return db.runTransaction(async tx => {
    fresh();
    const profileRef = db.doc(`memberProfiles/${scope.profileId}`);
    const lookupRef = db.doc(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${scope.profileId}`);
    const auditRef = db.doc(scope.auditPath);
    const refs = [profileRef, lookupRef, auditRef, db.doc(`memberProfiles/${scope.nativeId}`),
      ...scope.recordIds.flatMap(id => [db.doc(`privateLessonChartRecords/${id}`), db.doc(`privateLessonChartRequests/${id}`), db.doc(`bookings/${id.slice(4)}`)]),
      db.doc('staffs/' + audit.staff.staffId), ...notion.bindings.map(b => db.doc(b.path))];
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    const values = new Map(snaps.map(s => [s.ref?.path || s.path, s.data()]));
    const profile = values.get(profileRef.path), lookup = values.get(lookupRef.path);
    assert.ok(!snaps[2].exists && !snaps[3].exists, 'Prior repair/native profile requires review');
    assert.ok(profile && chartRepairHash(profile) === audit.profile.sourceHash &&
      profile.memberId === scope.profileId && profile.studioId === '5330' &&
      !profile.studiomateMemberId && !profile.mergedInto && !profile.canonicalMemberId &&
      !profile.supersededByMemberId && profile.status !== 'merged' && profile.externalActionEligible !== false &&
      phoneHash(profile.phone) === proof.phoneSha256 && chartRepairHash(profile.name) === proof.nameSha256,
    'Profile source changed');
    assert.ok(chartRepairHash(lookup || null) === audit.lookup.sourceHash &&
      !['done', 'processing', 'running'].includes(lookup?.status) && !lookup?.studiomateMemberId,
    'Lookup work requires review');
    if (lookup) assert.ok(lookup.memberId === scope.profileId && lookup.studioId === '5330' &&
      lookup.memberPhone === profile.phone && lookup.memberName === profile.name, 'Lookup identity mismatch');
    const matches = await tx.get(db.collection('memberProfiles').where('phone', '==', profile.phone).limit(2));
    const owners = await tx.get(db.collection('memberProfiles').where('studiomateMemberId', '==', scope.nativeId).limit(2));
    const peers = await tx.get(db.collection('privateLessonChartRecords').where('memberId', '==', scope.profileId).limit(100));
    assert.ok(peers.size === notion.peerCount && peers.size < 100 && peers.docs.every(s =>
      notion.peers.some(p => p.id === s.id && p.sourceHash === chartRepairHash(s.data()))), 'Notion peer source changed');
    assert.ok(matches.size === 1 && matches.docs[0].id === scope.profileId && owners.size === 0, 'Ambiguous native ownership');
    for (const binding of notion.bindings) assert.equal(values.get(binding.path), undefined, 'New Notion binding requires review');
    const staff = values.get('staffs/' + audit.staff.staffId);
    assert.ok(staff?.active === true && staff.studioId === '5330' && staff.staffId === audit.staff.staffId &&
      staff.name === audit.staff.name && ['owner', 'manager', 'instructor'].includes(staff.role), 'Staff source changed');
    for (const id of scope.recordIds) {
      const evidence = audit.records.find(r => r.id === id);
      const record = values.get(`privateLessonChartRecords/${id}`), request = values.get(`privateLessonChartRequests/${id}`), booking = values.get(`bookings/${id.slice(4)}`);
      assert.ok(evidence && chartRepairHash(record) === evidence.recordHash && chartRepairHash(request) === evidence.requestHash &&
        chartRepairHash(booking) === evidence.bookingHash, 'Chart source changed');
      assert.ok(record.recordId === id && record.requestId === id && request.requestId === id &&
        record.bookingId === id.slice(4) && request.bookingId === record.bookingId &&
        [record, request, booking].every(r => r.memberId === scope.profileId && r.staffId === staff.staffId && r.memberPhone === profile.phone),
      'Chart/booking identity mismatch');
      assert.ok(!record.cancelledAt && !request.cancelledAt && request.status === 'pending' &&
        record.gptStatus === 'waiting_post' && !record.preSubmittedAt && !record.postSubmittedAt &&
        request.preStatus === 'pending' && request.postStatus === 'pending' && !evidence.hasAnswers &&
        !record.notionProjectionLease?.token && !record.notionSync?.creationTitle &&
        record.notionSync?.status === 'failed', 'Not an untouched failed preparation');
      const native = proof.bookings.filter(b => String(b.bookingId) === record.bookingId);
      assert.ok(native.length === 1 && native[0].lectureDate === record.lessonDate &&
        time(native[0].startAt) === time(record.lessonStartAt) && native[0].staffName === staff.name &&
        native[0].sourceStatus === 'booked' && booking.sourceStatus === 'booked' &&
        booking.appStatus === 'reserved', 'Native booking not currently reserved');
    }
    fresh();
    const resolvedAt = new Date(now()).toISOString();
    tx.update(profileRef, { studiomateMemberId: scope.nativeId, studiomateMemberIdResolvedAt: resolvedAt });
    const { bookings, ...identityProof } = proof;
    tx.set(lookupRef, { status: 'done', studiomateMemberId: scope.nativeId, resolvedAt, updatedAt: resolvedAt,
      lastError: null, verification: identityProof, source: 'operator_verified_chart_recovery' }, { merge: true });
    tx.create(auditRef, { taskId: scope.taskId, recordIds: scope.recordIds, memberId: scope.profileId,
      nativeMemberId: scope.nativeId, resolvedAt, proof, notionProof: notion, auditHash: chartRepairHash(audit),
      outcome: 'linked', scope: 'existing_profile_pointer_only', nativeProfileCreated: false,
      lookupBefore: lookup || null, originalNotionSync: audit.records.map(r => ({ id: r.id, notionSync: r.record.notionSync })) });
    return { outcome: 'linked', resolvedAt };
  });
}
