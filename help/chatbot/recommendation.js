import {publishedTimetable} from './timetable.js';

export const bookingGuide='https://archivepilates.notion.site/studiomate';
const weekdays=['일','월','화','수','목','금','토'];
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const times={
  weekdayMorning:{label:'평일 오전',match:(weekend,hour)=>!weekend&&hour<12},
  weekdayAfternoon:{label:'평일 오후',match:(weekend,hour)=>!weekend&&hour>=12&&hour<18},
  weekdayEvening:{label:'평일 저녁',match:(weekend,hour)=>!weekend&&hour>=18},
  weekend:{label:'주말',match:weekend=>weekend},
  flexible:{label:'시간 무관',match:()=>true}
};
const goals={
  basics:'수업명이나 설명에서 기본 동작을 다루는지 살펴보세요.',
  strength:'수업명이나 설명에서 근력·코어 위주의 주제인지 살펴보세요.',
  routine:'정기적으로 비워 둘 수 있는 요일과 시간을 골라보세요.'
};
const intensities={
  gentle:'가볍게 시작하려면 기본 동작 위주인지 확인해 주세요.',
  moderate:'보통 강도를 원하면 동작 난이도를 먼저 확인해 주세요.',
  active:'활동적인 수업을 원하면 수업 설명의 주제와 난이도를 확인해 주세요.'
};
const has=(obj,key)=>typeof key==='string'&&Object.hasOwn(obj,key);
const dateLabel=date=>Number(date.slice(5,7))+'월 '+Number(date.slice(-2))+'일';

export function recommendClasses({time,goal,intensity,through,limit=2}={},now=new Date()){
  if(!has(times,time)||!has(goals,goal)||!has(intensities,intensity))return null;
  const today=kst.format(now), schedule=publishedTimetable('',now);
  const advice=[goals[goal],intensities[intensity]];
  if(!schedule)return {classes:[],basis:null,advice,bookingGuide};
  const end=through&&through<schedule.endDate?through:schedule.endDate;
  const latest=Date.parse(end+'T00:00:00Z');
  const start=new Date(today+'T00:00:00Z').getTime();
  const options=[];
  // Only start times still ahead in KST and inside the verified publication window.
  for(let day=start;day<=latest;day+=86400_000){
    const date=new Date(day).toISOString().slice(0,10), dow=new Date(day).getUTCDay();
    for(const [startAt,staff] of schedule.byDay[weekdays[dow]]??[]){
      if(!times[time].match(dow===0||dow===6,Number(startAt.slice(0,2))))continue;
      if(Date.parse(date+'T'+startAt+':00+09:00')<=now.getTime())continue;
      options.push({date,day:weekdays[dow],startAt,staff});
    }
  }
  const [first]=options;
  const alternate=first&&(
    (goal==='routine'&&options.find(o=>o.date!==first.date&&o.startAt===first.startAt))||
    options.find(o=>o.date!==first.date)||options[1]
  );
  const classes=[first,alternate].filter(Boolean).slice(0,limit).map((row,i)=>({
    ...row,label:dateLabel(row.date)+'('+row.day+') '+row.startAt,
    reason:i===0
      ?(time==='flexible'?'공개 시간표에서 가장 가까운 일정이에요.':'선택한 '+times[time].label+'에 가장 가까운 일정이에요.')
      :goal==='routine'&&row.startAt===first.startAt&&row.date!==first.date
        ?'첫 후보와 시작 시간이 같아서 다른 요일에도 비슷한 시간에 다닐 수 있어요.'
        :row.date!==first.date?'같은 조건으로 다른 날짜에 갈 수 있는 대안이에요.':'같은 날짜에 갈 수 있는 다른 시간이에요.'
  }));
  return {classes,basis:schedule.title,source:schedule.source,advice,bookingGuide};
}
