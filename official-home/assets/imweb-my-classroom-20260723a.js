(function(){
  var VERSION="2026-09-01a";
  var MAX_PROBES=6;
  var path=String(location.pathname||"").replace(/\/$/,"");
  if(path!=="/48"&&path!=="/my-classroom")return;

  document.documentElement.setAttribute("data-ap-classroom",VERSION);
  document.documentElement.setAttribute("data-ap-classroom-v2",VERSION);

  var K="ap_classroom_relogin";
  var L=[
    {"code":"AR1","path":"/archive-method-watch-ar1","title":"리포머 척추 정렬 & 코어 컨트롤 (AR1)"},
    {"code":"ACH7","path":"/archive-method-watch-ach7","title":"체어 흉추가동성 (ACH7)"},
    {"code":"ACA4","path":"/archive-method-watch-aca4","title":"캐딜락 흉추가동성 (ACA4)"},
    {"code":"AB7","path":"/archive-method-watch-ab7","title":"바렐 요추안정화 (AB7)"},
    {"code":"AR3","path":"/archive-method-watch-ar3","title":"리포머 요추안정화 (AR3)"},
    {"code":"AB6","path":"/archive-method-watch-ab6","title":"바렐 직장인 증후군 (AB6)"},
    {"code":"ACH6","path":"/archive-method-watch-ach6","title":"체어 직장인 증후군 (ACH6)"},
    {"code":"AR2-1","path":"/archive-method-watch-ar2-1","title":"리포머 챌린지 동작 빌드업 시퀀스 (AR2-1)"},
    {"code":"ACH5","path":"/archive-method-watch-ach5","title":"체어 고강도필라테스 (ACH5)"},
    {"code":"ACA2","path":"/archive-method-watch-aca2","title":"캐딜락 경추보호 코어강화 (ACA2)"},
    {"code":"ACA3","path":"/archive-method-watch-aca3","title":"캐딜락 고강도필라테스 (ACA3)"},
    {"code":"ACA1","path":"/archive-method-watch-aca1","title":"캐딜락 암스프링 단 하나로 보상패턴 바로잡기 (ACA1)"},
    {"code":"AB3","path":"/archive-method-watch-ab3","title":"바렐 척추 유연성 & 어깨 안정화 (AB3)"},
    {"code":"ACH2","path":"/archive-method-watch-ach2","title":"체어 림프 순환 & 척추 컨트롤 (ACH2)"},
    {"code":"AB2","path":"/archive-method-watch-ab2","title":"바렐 척추 신장 & 복부 컨트롤 (AB2)"},
    {"code":"ACH1","path":"/archive-method-watch-ach1","title":"체어 골반 & 체간 안정화 + 척추 유연성 (ACH1)"},
    {"code":"ACH4","path":"/archive-method-watch-ach4","title":"체어 골반 안정화 & 비대칭 교정 (ACH4)"},
    {"code":"ACH3","path":"/archive-method-watch-ach3","title":"체어 정렬 인지 & 체간 안정화 (ACH3)"},
    {"code":"AB5","path":"/archive-method-watch-ab5","title":"바렐 크로스패턴 (AB5)"},
    {"code":"AB1","path":"/archive-method-watch-ab1","title":"바렐 척추 신장 & 흉곽 안정화 (AB1)"},
    {"code":"AR4","path":"/archive-method-watch-ar4","title":"리포머 순환 (AR4)"},
    {"code":"AB4","path":"/archive-method-watch-ab4","title":"바렐 전신 근막 FLOW (AB4)"},
    {"code":"AB8","path":"/archive-method-watch-ab8","title":"바렐 순환 (AB8)"},
    {"code":"ACH8","path":"/archive-method-watch-ach8","title":"체어 호흡 (ACH8)"},
    {"code":"ACA5","path":"/archive-method-watch-aca5","title":"캐딜락 호흡 (ACA5)"},
    {"code":"AB9","path":"/archive-method-watch-ab9","title":"바렐 골반·고관절 (AB9)"},
    {"code":"AR5","path":"/archive-method-watch-ar5","title":"리포머 골반·고관절 (AR5)"},
    {"code":"B260725-BARREL","path":"/private-lesson-pelvis-hip-b-barrel-260725","title":"7/25 골반·고관절 B팀 · 바렐","group":"PRIVATE LESSON PELVIS HIP B 260725 40D","private":true},
    {"code":"B260725-REFORMER","path":"/private-lesson-pelvis-hip-b-reformer-260725","title":"7/25 골반·고관절 B팀 · 리포머","group":"PRIVATE LESSON PELVIS HIP B 260725 40D","private":true},
    {"code":"JEY260718","path":"/private-lesson-jey-260718","title":"정은영 프라이빗 강사레슨 260718","group":"PRIVATE LESSON JEY 260718 40D","private":true},
    {"code":"A260829","path":"/private-lesson-support-movement-a-260829","title":"8/29 지지와 움직임 A팀 · 수강생 공유","group":"PRIVATE LESSON SUPPORT MOVEMENT A 260829 40D","private":true},
    {"code":"B260829","path":"/private-lesson-support-movement-b-260829","title":"8/29 지지와 움직임 B팀 · 수강생 공유","group":"PRIVATE LESSON SUPPORT MOVEMENT B 260829 40D","private":true},
    {"code":"C260830","path":"/private-lesson-support-movement-c-260830","title":"8/30 지지와 움직임 C팀 · 수강생 공유","group":"PRIVATE LESSON SUPPORT MOVEMENT C 260830 40D","private":true},
    {"code":"D260830","path":"/private-lesson-support-movement-d-260830","title":"8/30 지지와 움직임 D팀 · 수강생 공유","group":"PRIVATE LESSON SUPPORT MOVEMENT D 260830 40D","private":true}
  ];
  var M={
    "d43dd28704f02dbdf0ff891b31450e359240d62d":"all",
    "eaa69fb684aed5e2aa35ec5150c015917178fa2d":"all",
    "358e71672be8b93098ce3c29b181c4f8b11c09fb":"owner"
  };

  function addStyle(){
    if(document.getElementById("ap-classroom-v2-style"))return;
    var s=document.createElement("style");
    s.id="ap-classroom-v2-style";
    s.textContent=[
      "html[data-ap-classroom-v2] body{margin:0!important;background:#fffdfa!important;color:#181614!important}",
      "html[data-ap-classroom-v2] #doz_header_wrap,html[data-ap-classroom-v2] #doz_header,html[data-ap-classroom-v2] #doz_footer_wrap,html[data-ap-classroom-v2] #doz_footer{display:none!important;height:0!important;min-height:0!important;margin:0!important;padding:0!important;overflow:hidden!important}",
      "html[data-ap-classroom-v2] #doz_content{display:block!important;min-height:100svh!important;margin:0!important;padding:0!important;background:#fffdfa!important}",
      ".apc{box-sizing:border-box;min-height:100svh;padding:96px 18px 80px;font-family:inherit;background:#fffdfa}",
      ".apc *{box-sizing:border-box}.apc-in{position:relative;max-width:1080px;margin:0 auto}.apc-ey{margin:0 0 18px;font-size:12px;letter-spacing:.12em;font-weight:900;color:#8c3425}",
      ".apc h1{margin:0 0 14px;font-size:38px;line-height:1.18;color:#181614;letter-spacing:0}.apc-lead{margin:0 0 32px;max-width:680px;color:#625850;line-height:1.75}",
      ".apc-loading{color:#756a62}.apc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}",
      ".apc-card{display:flex;min-width:0;min-height:150px;flex-direction:column;justify-content:space-between;padding:20px;border:1px solid #ded5cb;background:#fff;color:#181614!important;text-decoration:none!important;transition:transform .22s ease,border-color .22s ease}",
      ".apc-card:hover{transform:translateY(-3px);border-color:#1e1b18}.apc-code{font-size:12px;letter-spacing:.1em;font-weight:900;color:#8c3425}.apc-card strong{font-size:18px;line-height:1.4;letter-spacing:0}.apc-card span:last-child{color:#756a62;font-weight:800}",
      ".apc-empty{max-width:720px;padding:24px 26px;border:1px solid #e3d8ce;background:#fbf7f1;line-height:1.75;color:#1e1b18}.apc-empty strong{display:block;margin:0 0 8px;font-size:18px;line-height:1.45}.apc-empty-help{margin:0 0 4px;color:#675d55}.apc-account{margin:10px 0 0;font-size:13px;color:#7d7168;overflow-wrap:anywhere;word-break:break-word}",
      ".apc-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.apc-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 14px;border:1px solid #1e1b18;background:#1e1b18;color:#fff!important;text-decoration:none!important;font-weight:800}.apc-btn.sub{border-color:#d8cec3;background:#fff;color:#1e1b18!important}",
      "@media(max-width:760px){.apc{padding:84px 15px 60px}.apc h1{font-size:28px}.apc-grid{grid-template-columns:1fr}.apc-card{min-height:142px}.apc-empty{padding:20px 18px}.apc-btn{width:100%}}",
      "@media(prefers-reduced-motion:reduce){.apc-card{transition:none!important}}"
    ].join("");
    (document.head||document.documentElement).appendChild(s);
  }

  addStyle();

  function groupTitle(x){return x.group||("ARCHIVE METHOD "+x.code+" 40D")}
  function memberHash(){try{return String(window.MEMBER_HASH||"").trim()}catch(e){return""}}
  function profileText(){
    var out=[];
    ["#member_profile",".member_profile","#mobile_slide_menu_wrap .profile-area","#mobile_slide_menu_wrap .member-info",".profile-info",".dropdown-profile"].forEach(function(sel){
      Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(function(el){out.push(el.textContent||"")});
    });
    return out.join(" ").replace(/\s+/g," ");
  }
  function okDocument(doc){
    if(!doc)return false;
    doc.querySelectorAll("script,style").forEach(function(node){node.remove()});
    return !!doc.querySelector('.ap-watch,.ap-private-watch,.ap-private-watch__video,[data-archive-pilates-watch-code],iframe[src*="youtube.com/embed"],iframe[src*="youtube-nocookie.com/embed"]');
  }
  function normalizedPath(value){
    try{return new URL(value,location.href).pathname.replace(/\/$/,"")||"/"}catch(e){return""}
  }
  function responseMatches(response,x){
    return !!(response&&response.ok&&normalizedPath(response.url)===normalizedPath(x.path));
  }
  function probeOrder(){
    var privateItems=[];
    var standardItems=[];
    L.forEach(function(x,i){(x.private?privateItems:standardItems).push(i)});
    return privateItems.concat(standardItems);
  }
  function titleFor(x){
    if(x.private)return x.title;
    return "ARCHIVE METHOD "+x.title.replace(/\s*\([A-Z0-9-]+\)$/,"");
  }
  function makeCard(x){
    var a=document.createElement("a");
    a.className="apc-card";
    a.href=x.path;
    a.innerHTML='<span class="apc-code"></span><strong></strong><span>시청 페이지 열기</span>';
    a.querySelector(".apc-code").textContent=x.code;
    a.querySelector("strong").textContent=titleFor(x);
    return a;
  }
  function accountLabel(){
    var uid="";
    try{uid=String(window.MEMBER_UID||"").trim()}catch(e){}
    return uid?"현재 로그인 계정: "+uid:"현재 로그인 계정을 확인하지 못했습니다.";
  }
  function startRelogin(){try{sessionStorage.setItem(K,"1")}catch(e){}}

  function run(){
    if(document.documentElement.getAttribute("data-ap-classroom-v2-ready"))return;
    var host=document.getElementById("doz_content")||document.querySelector("main")||document.body;
    if(!host){setTimeout(run,60);return}
    document.documentElement.setAttribute("data-ap-classroom-v2-ready",VERSION);
    host.innerHTML='<section class="apc"><div class="apc-in"><p class="apc-ey">ARCHIVE PILATES · MY CLASSROOM</p><h1>내 강의실</h1><p class="apc-lead">구매했거나 수동으로 권한이 부여된 온라인 클래스만 표시됩니다.</p><div class="apc-loading">시청 가능한 수업을 확인하고 있습니다.</div><div class="apc-grid" hidden></div></div></section>';

    var sec=host.querySelector(".apc");
    var grid=sec.querySelector(".apc-grid");
    var loading=sec.querySelector(".apc-loading");
    var available=[];
    var finished=false;

    function add(x,i,source){
      if(available[i])return false;
      available[i]=x;
      document.documentElement.setAttribute("data-ap-classroom-last-source",source);
      return true;
    }
    function draw(){
      grid.innerHTML="";
      var count=0;
      L.forEach(function(x,i){
        if(!available[i])return;
        grid.appendChild(makeCard(x));
        count++;
      });
      if(count){
        grid.hidden=false;
        loading.textContent=finished?"":"추가 시청 권한을 확인하고 있습니다.";
        loading.hidden=finished;
      }
      document.documentElement.setAttribute("data-ap-classroom-card-count",String(count));
    }
    function markManual(){
      var mode=M[memberHash()];
      if(!mode)return;
      L.forEach(function(x,i){
        if(mode==="owner"||(mode==="all"&&!x.private)||(Array.isArray(mode)&&mode.indexOf(x.code)>-1))add(x,i,"manual");
      });
    }
    function markProfile(){
      var text=profileText();
      if(!text)return;
      L.forEach(function(x,i){if(text.indexOf(groupTitle(x))>-1)add(x,i,"profile")});
    }
    function showEmpty(){
      loading.remove();
      var e=document.createElement("div");
      e.className="apc-empty";
      e.innerHTML='<strong>현재 이 계정으로 볼 수 있는 온라인 클래스가 없습니다.</strong><p class="apc-empty-help">최근 구매했거나 권한을 수동으로 받은 경우, 로그인한 계정이 권한을 받은 계정과 같은지 확인해 주세요. 아래 계정이 예상과 다르면 로그아웃 후 권한을 받은 계정으로 로그인해야 합니다.</p><p class="apc-account"></p><div class="apc-actions"><a class="apc-btn" href="/logout.cm">다시 로그인</a><a class="apc-btn sub" href="/17">온라인 클래스 보기</a><a class="apc-btn sub" href="http://pf.kakao.com/_AHdvn/chat">권한 문의</a></div>';
      e.querySelector(".apc-account").textContent=accountLabel();
      e.querySelector('.apc-btn[href="/logout.cm"]').addEventListener("click",startRelogin);
      sec.querySelector(".apc-in").appendChild(e);
    }
    async function probe(x,i){
      if(available[i])return;
      var controller=new AbortController();
      var timer=setTimeout(function(){controller.abort()},7000);
      try{
        var response=await fetch(x.path+(x.path.indexOf("?")>-1?"&":"?")+"ap_classroom_fetch_probe=1",{
          credentials:"same-origin",
          redirect:"follow",
          cache:"no-store",
          signal:controller.signal
        });
        var html=await response.text();
        var doc=new DOMParser().parseFromString(html,"text/html");
        if(responseMatches(response,x)&&okDocument(doc)&&add(x,i,"fetch"))draw();
      }catch(e){}finally{clearTimeout(timer)}
    }

    function runProbes(){
      var order=probeOrder();
      var cursor=0;
      var workers=[];
      function worker(){
        if(cursor>=order.length)return Promise.resolve();
        var i=order[cursor++];
        return probe(L[i],i).then(worker);
      }
      for(var i=0;i<Math.min(MAX_PROBES,order.length);i++)workers.push(worker());
      return Promise.all(workers);
    }

    markManual();
    markProfile();
    draw();
    runProbes().then(function(){
      finished=true;
      markManual();
      markProfile();
      if(available.some(Boolean))draw();else showEmpty();
      document.documentElement.setAttribute("data-ap-classroom-v2-complete",VERSION);
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();
})();
