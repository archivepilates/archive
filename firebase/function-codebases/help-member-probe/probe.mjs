const probeValue='archive-help-disabled-probe';
const memberPath='/api/member-access/probe';

export function probe(req,res){
  res.set('Cache-Control','private, no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('X-Robots-Tag','noindex, nofollow');
  const path=req.originalUrl??req.url;
  if(path!==memberPath&&path!==('/helpMemberAccessProbe'+memberPath))return res.status(404).json({ok:false});
  if(req.method!=='GET')return res.status(405).json({ok:false});
  return res.status(200).json({ok:true,memberAccess:'disabled',transport:'firebase-https',
    sessionCookieForwarded:(req.get('cookie')??'').split(/;\s*/u).includes('__session='+probeValue),
    conversationHeaderForwarded:req.get('x-archive-conversation')===probeValue});
}
