import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin = require('/Users/archivepilates/dev/archive-in-runtime/firebase/kangsain-functions/functions/node_modules/firebase-admin');
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json');
admin.initializeApp({projectId:'archive-pilates'});
const db = admin.firestore();
const iso = v => v?.toDate ? v.toDate().toISOString() : v ?? null;
const fields = (v, allowed) => Object.fromEntries(allowed.filter(k=>v?.[k]!==undefined).map(k=>[k,iso(v[k])]));
try {
  for (const id of ['plc_280084398','plc_281189166','plc_281189167']) {
    const snap = await db.collection('privateLessonChartRecords').doc(id).get(), d=snap.data()||{};
    const request=typeof d.requestId==='string'&&/^plc_[a-zA-Z0-9_.:-]+$/.test(d.requestId)
      ? await db.collection('privateLessonChartRequests').doc(d.requestId).get():null;
    console.log(JSON.stringify({ id, exists:snap.exists, observedAt:new Date().toISOString(), keys:Object.keys(d),
      metadata:fields(d,['recordId','requestId','bookingId','lessonDate','lessonStartAt','createdAt','updatedAt','preSubmittedAt','postSubmittedAt','gptStatus','source','sourceType']),
      notionSync:fields(d.notionSync,['status','pendingAt','failedAt','attemptedAt','updatedAt','syncedAt','errorCode','lastErrorCode','attempts','projectionVersion']),
      notionSyncKeys:Object.keys(d.notionSync||{}),
      notionErrorClass:['object_not_found','unauthorized','validation_error','rate_limited','차트 요청 없음','Notion 회원 페이지 연결','Notion 회원 폴더 자동 연결 확인 필요','lease lost','source changed','Could not find','not found','403','404','401'].filter(x=>String(d.notionSync?.error||'').includes(x)),
      projectionControl:fields(d.notionProjectionControl,['aliasOfRecordId','version','sourceRevision','blocked','reasonCode']),
      hasNotionPage:!!(d.notionPageId||d.notionPageUrl||d.notionSync?.pageId),
      hasInstructorPage:!!d.notionSync?.instructorPageId,hasCreationTitle:!!d.notionSync?.creationTitle,
      projectionLeaseActive:Number(d.notionProjectionLease?.untilMs||0)>Date.now(),
      request:request?{exists:request.exists,...fields(request.data(),['requestId','status','preStatus','postStatus'])}:null,
      hasPreAnswers:!!d.preAnswers,hasPostAnswers:!!d.postAnswers,
    }));
  }
} finally { await admin.app().delete(); }
