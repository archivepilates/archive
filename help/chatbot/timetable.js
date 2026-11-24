const days=['일','월','화','수','목','금','토'];
const source='https://archivepilates.notion.site/#409d49eae4bf800a9bdbdfcc29f1c3cc';
const calendar=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const morning=[
  ['08:00','은영'],['08:30','민진'],['09:00','은영'],['09:30','민진'],['10:00','은영'],['11:00','은영']
];
const tueThu=[
  ['09:00','은영'],['10:00','은영'],['17:30','은영'],['18:30','유리'],['19:00','은영'],['19:30','유리'],['20:30','유리']
];

export const novemberTimetable={
  title:'11월 명지점 시간표',
  period:'2026.11.01~11.30',
  endDate:'2026-11-30',
  image:{src:'/assets/myeongji-timetable-2026-11.jpg',width:1414,height:2000},
  source,
  byDay:{
    월:[...morning,['17:30','유리'],['18:30','은영'],['19:00','민진'],['19:30','은영'],['20:00','민진 · 유리'],['20:30','은영'],['21:00','유리']],
    화:tueThu,
    수:[...morning,['15:00','유리'],['17:30','민진'],['19:00','은영 · 유리'],['20:00','은영 · 유리'],['21:00','유리']],
    목:tueThu,
    금:[...morning,['17:30','유리'],['19:00','은영 · 유리'],['20:00','유리']],
    토:[['09:00','유리'],['10:00','유리'],['11:00','유리']],
    일:[['09:00','민진'],['10:00','민진'],['11:00','민진']]
  }
};

export function publishedTimetable(question,now){
  const today=calendar.format(now);
  if(!today.startsWith('2026-11-')||/다음\s*달|지난\s*달|십이월|내년|작년/u.test(question))return null;
  const month=question.match(/(?:^|[^\d])(\d{1,2})\s*월(?!요일)/u)?.[1];
  const year=question.match(/(20\d{2})\s*년/u)?.[1];
  if((month&&Number(month)!==11)||(year&&year!=='2026'))return null;

  const relative=/모레/u.test(question)?2:/내일/u.test(question)?1:/어제/u.test(question)?-1:0;
  const explicitDay=question.match(/(?:^|[^\d])(\d{1,2})\s*일(?!요일)/u)?.[1];
  const localDay=new Date(today+'T12:00:00Z');
  const useDate=explicitDay!==undefined||relative!==0||/오늘/u.test(question);
  if(explicitDay!==undefined){
    localDay.setUTCDate(Number(explicitDay));
    if(localDay.getUTCDate()!==Number(explicitDay))return null;
  }else if(relative)localDay.setUTCDate(localDay.getUTCDate()+relative);
  if(localDay.getUTCMonth()!==10)return null;
  const dateDay=days[localDay.getUTCDay()];
  const namedDay=question.match(/([월화수목금토일])\s*요일/u)?.[1]??(/주말/u.test(question)?'토':null);
  if(useDate&&namedDay&&namedDay!==dateDay)return null;
  return {...novemberTimetable,selectedDay:namedDay??dateDay};
}
