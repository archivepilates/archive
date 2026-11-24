import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {recommendClasses,bookingGuide} from '../help/chatbot/recommendation.js';

const choices={time:'weekdayEvening',goal:'routine',intensity:'gentle'};
const t=value=>new Date(value+'+09:00');

test('known published hours select two future distinct dates with reasons and booking handoff',()=>{
  const r=recommendClasses(choices,t('2026-11-24T19:30:00'));
  assert.deepEqual(r.classes.map(row=>[row.label,row.staff]),[
    ['11월 24일(화) 20:30','유리'],['11월 26일(목) 20:30','유리']
  ]);
  assert.match(r.classes[0].reason,/평일 저녁/);
  assert.match(r.classes[1].reason,/시작 시간이 같아서/);
  assert.match(r.advice.join(' '),/정기적.*가볍게/);
  assert.equal(r.bookingGuide,bookingGuide);
});

test('weekends, afternoons and intensity choices are respected without assigning unverified difficulty',()=>{
  const now=t('2026-11-24T10:00:00');
  assert.deepEqual(recommendClasses({...choices,time:'weekend'},now).classes.map(row=>row.day),['토','일']);
  const r=recommendClasses({time:'weekdayAfternoon',goal:'strength',intensity:'active'},now);
  assert.ok(r.classes.every(row=>row.startAt>='12:00'&&row.startAt<'18:00'));
  assert.match(r.advice.join(' '),/근력·코어.*활동적인/);
  assert.ok(r.classes.every(row=>!Object.hasOwn(row,'intensity')));
});

test('KST rollover, passed slots and insufficient results never invent or duplicate a candidate',()=>{
  const one=recommendClasses(choices,t('2026-11-30T20:30:00'));
  assert.deepEqual(one.classes.map(row=>row.startAt),['21:00']);
  const zero=recommendClasses(choices,t('2026-11-30T21:00:00'));
  assert.equal(zero.classes.length,0);
  assert.equal(zero.basis,'11월 명지점 시간표');
  const expired=recommendClasses(choices,t('2026-12-01T00:00:00'));
  assert.equal(expired.classes.length,0);
  assert.equal(expired.basis,null);
  assert.equal(expired.source,undefined);
  assert.equal(expired.bookingGuide,bookingGuide);
});

test('the public form accepts only fixed options, no member or health fields',async()=>{
  assert.equal(recommendClasses({...choices,time:'constructor'}),null);
  assert.equal(recommendClasses({...choices,intensity:'invalid'}),null);
  const get=path=>readFile(new URL('../help/'+path,import.meta.url),'utf8');
  const page=await get('index.html'), module=await get('chatbot/recommendation-ui.js');
  const dialog=page.match(/<dialog id="class-recommendation"[\s\S]*?<\/dialog>/)[0];
  assert.deepEqual([...new Set([...dialog.matchAll(/name="([^"]+)"/g)].map(m=>m[1]))],['time','goal','intensity']);
  assert.doesNotMatch(module,/\bfetch\b|\blocalStorage\b|\bsessionStorage\b|\.cookie/);
  assert.equal(page,await get('chatbot/index.html'));
});
