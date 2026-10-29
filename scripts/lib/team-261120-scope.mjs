import assert from 'node:assert/strict';

export const TEAM_IDS = Object.freeze(['ilr_6685071b1f94a42a4a2b9cc2','ilr_11220626f43287e672165c95',
  'ilr_0882918f3696516a12e99baa','ilr_5645aa92361ec38ac3341284','ilr_1a419dab0dc80e8c175f0096','ilr_a48e0e3d5c7e4b8c5c65cb13']);
export const TEAM_DIRECTORY = '/Users/archivepilates/ArchiveIN/operations/team-instructor-fulfillment-20261029';
export const TEAM_APPROVAL = Object.freeze({source:'human_current_chat',date:'2026-10-29',
  scope:'six_existing_20261120_team_registrations_member_ticket_signup_confirmation',
  paymentMethod:'wiretransfer',amountPerPerson:80000,totalAmount:480000});

export function assertTeamRegistration(id, r) {
  assert(TEAM_IDS.includes(id) && r && r.studioId === '5330' && r.courseKind === 'team'
    && r.ticketName === 'Team 강사레슨' && r.lessonDate === '2026-11-20' && r.lessonTime === '14:00'
    && r.lessonTopic === 'ARCHIVE METHOD #1 직장인 증후군' && r.paymentAmount === 80000
    && r.paymentMethod === 'wiretransfer' && !r.cancellation && !r.externalOrderReviewRequired
    && !['cancelled','canceled','rejected','cancellation_pending','cancellation_review'].includes(r.status));
  assert(/^[가-힣A-Za-z][가-힣A-Za-z ]{1,39}$/.test(r.memberName) && /^010\d{8}$/.test(r.memberPhone));
  return r;
}

export function assertTeamLectures(result) {
  assert(Array.isArray(result?.data) && result.meta?.last_page === 1 && result.data.length === result.meta.total);
  const expected = [
    ['98900618','14:00:00','14:50:00','1983525','체어'],
    ['98900887','15:00:00','15:50:00','2222464','바렐'],
  ];
  return expected.map(([id,start,end,staff,room]) => {
    const rows = result.data.filter(r => String(r.id) === id);
    assert.equal(rows.length,1);
    const r=rows[0];
    assert(r.start_on === '2026-11-20 '+start && r.end_on === '2026-11-20 '+end
      && String(r.staff?.id) === staff && r.room?.name === room && r.max_trainee === 6
      && r.course?.active === true && r.course.studio_id === 5330 && !r.course.deleted_at
      && String(r.course.instructor_id) === staff && r.course.type === 'G'
      && /강사레슨\s*\(team\)/i.test(r.title));
    return {id,start:r.start_on,end:r.end_on,staffId:staff,room,capacity:r.max_trainee,source:'studiomate_native_get'};
  });
}

export function selectTeamTicket(result, memberId) {
  assert(result?.status === 'verified' && result.reason === 'complete_native_ticket_list' && Array.isArray(result.tickets));
  const matches=result.tickets.filter(t=>t.title==='Team 강사레슨'
    && t.availabilityStartAt <= '2026-11-20' && t.expireAt >= '2026-11-20');
  assert(matches.length <= 1,'Ambiguous same-day Team tickets; do not issue');
  if(!matches.length)return null;
  const t=matches[0],p=t.payment;
  assert(t.memberId===memberId && t.studioId==='5330' && t.productId==='468880'
    && t.availabilityStartAt==='2026-11-20' && t.expireAt==='2026-11-20'
    && t.verified===true && t.complete===true && t.active===true && t.usable===true
    && t.cancelled===false && t.refunded===false && t.isShared===false && t.maxCoupon===2
    && t.type==='T' && t.availableClassType==='G');
  assert(p?.verified===true && p.complete===true && p.status==='paid' && p.totalAmount===80000
    && p.paidAmount===80000 && p.outstandingAmount===0 && p.refundedAmount===0
    && p.transactions.length>0 && p.transactions.every(x=>x.status==='paid' && x.method==='bank_transfer')
    && p.transactions.reduce((s,x)=>s+x.amount,0)===80000);
  return t;
}
