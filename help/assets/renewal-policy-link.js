const novemberPricing='https://app.notion.com/p/3ebd49eae4bf8198ba47c4cb222d7c69';
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});

// The old inquiry assets contain the same month-bound public URL via two paths.
// Leave schema/version and answers intact; gate only the displayed link.
export function currentPolicyHref(href,now=new Date()){
 if(href!==novemberPricing)return href;
 const date=kst.format(now);
 return date>='2026-11-01'&&date<='2026-11-30'?href:null;
}
