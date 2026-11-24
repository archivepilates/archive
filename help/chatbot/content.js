export const sourcePrice='https://app.notion.com/p/3ebd49eae4bf8198ba47c4cb222d7c69';
export const regularNov=[
{name:'그룹 기간권 주 2회',price:398000,duration:'10주',frequency:2},
{name:'그룹 기간권 주 3회',price:570000,duration:'10주',frequency:3},
{name:'그룹 횟수권 8회',price:200000,duration:'2개월',frequency:8/(60/7)},
{name:'그룹 횟수권 20회',price:450000,duration:'5개월',frequency:20/(150/7)},
{name:'그룹 횟수권 50회',price:1000000,duration:'10개월',frequency:50/(300/7)}
];
export const promotionNov=[
  {kind:'group',name:'그룹레슨 50회',price:870000,duration:'6개월'},
  {kind:'duet',name:'듀엣레슨 20회 (강사)',price:600000,duration:'100일',perPerson:true},
  {kind:'duet',name:'듀엣레슨 20회 (부원장)',price:660000,duration:'100일',perPerson:true}
];
export const prompts={
 member:[['예약·변경·취소','예약 취소가 궁금해요'],['수강권·재등록','재등록이 궁금해요'],['홀딩·환불','홀딩이나 환불이 궁금해요'],['시간표·휴무','시간표가 궁금해요'],['내 잔여·출석','내 잔여 횟수나 출석을 알고 싶어요']],
 prospect:[['수강권 비교','수강권 추천해 주세요'],['처음 듣는 수업','수업을 추천해 주세요'],['이용 정책','예약과 이용 정책이 궁금해요']]
};
