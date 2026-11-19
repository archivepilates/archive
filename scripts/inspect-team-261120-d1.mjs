import assert from 'node:assert/strict';
import {readFile, mkdir, open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {TEAM_IDS, assertTeamRegistration} from './lib/team-261120-scope.mjs';
import {archiveAutomationRoot} from './lib/archive-automation-paths.mjs';

export async function inspectTeamD1() {
  assert.deepEqual(process.argv.slice(2), ['--read-only']);
  const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
  const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
  const root = archiveAutomationRoot(process.env.HOME);
  const app = admin.initializeApp({credential: admin.credential.cert(JSON.parse(await readFile(
    root + '/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates'});
  try {
    const db = app.firestore();
    const regs = await db.getAll(...TEAM_IDS.map(id => db.doc('instructorLessonRegistrations/' + id)));
    regs.forEach(r => assertTeamRegistration(r.id, r.data()));
    const read = async (collection, field, value) => {
      const rows = await db.collection(collection).where(field, '==', value).limit(501).get();
      assert(rows.size <= 500, 'Bounded read exceeded');
      return rows.docs.filter(r => r.data().studioId === '5330').map(r => ({id:r.id, ...r.data()}));
    };
    const bookings = await read('bookings', 'lectureDate', '2026-11-20');
    const lectures = await read('lectures', 'date', '2026-11-20');
    const candidates = await read('alimtalkCandidates', 'sourceDate', '2026-11-19');
    const approvals = await read('instructorLessonAlimtalkApprovals', 'sourceDate', '2026-11-19');
    const targetBookings = bookings.filter(b => ['98900618','98900887'].includes(String(b.lectureId)));
    const profiles = await db.getAll(...[...new Set(targetBookings.map(b => b.memberId))]
      .map(id => db.doc('memberProfiles/' + id)));
    const sends = [];
    for (const c of candidates.filter(c => c.type === 'instructor_lesson_material')) {
      const s = await db.doc('alimtalkSends/' + c.id).get();
      if (s.exists) sends.push({id:s.id, ...s.data()});
    }
    const snapshot = (await db.doc('opsState/studiomateReservationExcelEmergency').get()).data();
    const result = {readOnly:true, checkedAt:new Date().toISOString(), registrations:regs.map(r=>({id:r.id,...r.data()})),
      bookings:targetBookings, lectures:lectures.filter(l=>['98900618','98900887'].includes(String(l.lectureId))),
      profiles:profiles.map(p=>({id:p.id,...p.data()})), snapshot,
      candidates:candidates.filter(c=>c.type==='instructor_lesson_material'), approvals, sends};
    const directory = root + '/operations/2026-11-19-team-261120-d1';
    await mkdir(directory, {recursive:true,mode:0o700});
    const output = directory + '/source-' + Date.now() + '.json';
    const file = await open(output, 'wx', 0o600);
    try {await file.writeFile(JSON.stringify(result,null,2)); await file.sync();} finally {await file.close();}
    console.log(JSON.stringify({readOnly:true,output,registrationCount:regs.length,
      bookings:targetBookings.map(b=>({id:b.bookingId,memberId:b.memberId,lectureId:b.lectureId,status:b.appStatus,
        ticketName:b.ticketName,updatedAt:b.updatedAt,source:b.source,canonicalBookingKey:b.canonicalBookingKey})),
      lectures:result.lectures.map(l=>({id:l.lectureId,title:l.title,date:l.date,startTime:l.startTime,endTime:l.endTime})),
      candidateCount:result.candidates.length,approvalStates:approvals.map(a=>({id:a.id,status:a.status,management:a.managementNumber})),sendCount:sends.length,
      snapshotKeys:Object.keys(snapshot||{}),snapshotStatus:snapshot?.status}));
    return result;
  } finally {await app.delete();}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) inspectTeamD1().catch(error=>{
  console.error(JSON.stringify({ok:false,readOnly:true,error:error.code || error.name})); process.exitCode=1;
});
