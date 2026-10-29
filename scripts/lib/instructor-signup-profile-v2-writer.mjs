import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeInstructorLessonName as name,normalizeInstructorLessonPhone as phone } from './instructor-lesson-registration-contract.mjs';
import { normalizeSignupBirthDateV2,normalizeSignupAddressV2,decideSignupProfileFieldV2 } from './instructor-signup-profile-v2-policy.mjs';

// Operator approved only base road/lot lookup on 2026-10-30; unit details stay local.
export const SIGNUP_ADDRESS_LOOKUP_APPROVED = true;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
export const signupPostalAddressKey=value=>clean(value).replace(/^대한민국\s+/,'').replace(/\s*\([^)]*\)\s*$/,'')
  .replace(/^(서울|부산|대구|인천|광주|대전|울산)(?:특별시|광역시|시)\s/,'$1 ')
  .replace(/^경기도\s/,'경기 ').replace(/^세종특별자치시\s/,'세종 ')
  .replace(/^(강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)\s/,
    (_,region)=>({'강원특별자치도':'강원','강원도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','전라북도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주','제주도':'제주'}[region])+' ');
const postalKey=signupPostalAddressKey;
export function splitSignupPostalAddress(value) {
  const checked=normalizeSignupAddressV2(value);if(checked.status!=='verified')return null;
  const match=checked.value.match(/^(.+?(?:대로|번길|길|로|동|리|가)\s+\d+(?:-\d+)?)(?:\s*[,，]?\s*)(.*)$/u);
  if(!match)return null;
  if(/\d{6}|\d{4}[./-]\d{1,2}[./-]\d{1,2}|(?:\+?82[\s().-]*)?0?1[016789][\s().-]*\d{3,4}[\s().-]*\d{4}|생년|전화|연락|이름|회원|건강|상세|\d+\s*(?:동|호|층)(?:\s|$)/u.test(match[1]))return null;
  return {base:match[1],detail:match[2]};
}
async function choosePostalAddress(page,field,parts) {
  let popup,stage='popup';
  try{
    [popup]=await Promise.all([page.waitForEvent('popup',{timeout:15000}),field.click()]);
    const frame=popup.frameLocator('iframe');
    stage='search_input';
    await frame.getByRole('textbox').fill(parts.base);
    stage='search_button';
    await frame.getByRole('button',{name:'검색',exact:true}).click();
    stage='visible_results';
    const choices=frame.locator('button.link_post:not(.link_btn_map)');
    await choices.first().waitFor({state:'visible',timeout:20000});
    const lines=await choices.evaluateAll(nodes=>nodes.map(node=>[node.textContent,...[...node.querySelectorAll('*')].map(child=>child.textContent)]));
    const matches=lines.map((texts,index)=>({index,exact:texts.some(text=>postalKey(clean(text).replace(/^(?:도로명|지번)\s*/,''))===postalKey(parts.base))})).filter(x=>x.exact);
    stage='exact_result';
    assert(matches.length===1,'Postal address is not an exact unique match');
    stage='select_result';
    await choices.nth(matches[0].index).click();
    stage='native_callback';
    await field.page().waitForFunction(({expected})=>{
      const n=[...document.querySelectorAll('input[placeholder="주소를 입력해 주세요"]')].find(x=>x.getClientRects().length);
      return !!n?.value&&n.value.includes(expected);
    },{expected:parts.base.split(' ').slice(-2).join(' ')},{timeout:10000});
    const selected=await field.inputValue();assert(postalKey(selected)===postalKey(parts.base));return selected;
  }catch(error){error.postalStage=stage;throw error;
  }finally{if(popup&&!popup.isClosed())await popup.close();}
}
export async function applySignupProfileV2(page,job,memberId,baseUrl,{recordProgress=async()=>{},lookupApproved=SIGNUP_ADDRESS_LOOKUP_APPROVED}={}) {
  assert(job.source==='instructor_member_eformsign'&&job.profileUpdate?.version===2&&job.studioId==='5330'
    &&/^[1-9]\d*$/.test(memberId)&&memberId===String(job.studiomateMemberId)&&new URL(baseUrl).origin==='https://arcpilates.studiomate.kr');
  const detailUrl=new URL(`/users/detail?id=${memberId}`,baseUrl).href;
  const field=p=>page.getByRole('textbox').and(page.getByPlaceholder(p,{exact:true})).filter({visible:true});
  const openEditor=async(target=page)=>{
    const field=p=>target.getByRole('textbox').and(target.getByPlaceholder(p,{exact:true})).filter({visible:true});
    await target.goto(detailUrl,{waitUntil:'networkidle',timeout:60000});
    await target.getByRole('heading',{name:job.memberName,exact:true}).waitFor({state:'visible'});
    await target.getByRole('button',{name:'회원정보 수정',exact:true}).click();
    await target.waitForFunction(expected=>{
      const inputs=[...document.querySelectorAll('input')].filter(x=>x.getClientRects().length);
      const n=inputs.find(x=>x.getAttribute('placeholder')==='휴대폰 번호');
      return String(n?.value||'').replace(/\D/g,'')===expected&&inputs.some(x=>x.value==='강사회원');
    },phone(job.memberPhone),{timeout:20000});
    assert(new URL(target.url()).origin===new URL(baseUrl).origin&&new URL(target.url()).pathname==='/users/create'
      &&new URL(target.url()).searchParams.get('id')===memberId&&phone(await field('휴대폰 번호').inputValue())===phone(job.memberPhone)
      &&name(await field('이름을 입력해주세요').inputValue())===name(job.memberName));
    const protectedFields=await target.locator('input').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length
      &&['이름을 입력해주세요','휴대폰 번호','등록일을 입력해주세요','선택'].includes(n.getAttribute('placeholder')))
      .map(n=>({placeholder:n.getAttribute('placeholder'),value:n.value})));
    assert(protectedFields.some(x=>x.value==='강사회원'),'Native member is no longer an instructor member');
    return {birthDate:await field('생년월일 (YYYY-MM-DD)').inputValue(),address:await field('주소를 입력해 주세요').inputValue(),
      detail:await field('상세 주소를 입력해 주세요').inputValue(),protectedHash:sha(protectedFields)};
  };
  const before=await openEditor(),expected=job.profileUpdate;
  if(expected.mode==='completion_only'){
    assert(expected.fieldReviewReason==='signed_fields_unverified'&&!('birthDateRaw'in expected)&&!('addressRaw'in expected));
    const result={version:2,birthDate:{status:'review',reason:'signed_fields_unverified'},address:{status:'review',reason:'signed_fields_unverified'},
      checkedAt:new Date().toISOString(),beforeFieldHashes:{birthDate:sha(before.birthDate),address:sha(before.address),detail:sha(before.detail),protectedHash:before.protectedHash}};
    await recordProgress(result);return result;
  }
  const birthDate=normalizeSignupBirthDateV2(expected.birthDateRaw);
  const birthDecision=decideSignupProfileFieldV2({field:'birthDate',current:before.birthDate,expected:expected.birthDateRaw});
  const combined=clean([before.address,before.detail].filter(Boolean).join(' '));
  let addressDecision=decideSignupProfileFieldV2({field:'address',current:combined,expected:expected.addressRaw});
  const parts=splitSignupPostalAddress(expected.addressRaw);
  if(parts&&before.address&&postalKey(before.address)===postalKey(parts.base)&&clean(before.detail)===clean(parts.detail))addressDecision='already_equal';
  if(addressDecision==='write'&&(!parts||before.address||before.detail))addressDecision='review';
  if(addressDecision==='write'&&!lookupApproved)addressDecision='awaiting_address_lookup_approval';
  const result={version:2,birthDate:{status:birthDecision},address:{status:addressDecision},checkedAt:new Date().toISOString(),
    beforeFieldHashes:{birthDate:sha(before.birthDate),address:sha(before.address),detail:sha(before.detail),protectedHash:before.protectedHash}};
  await recordProgress(result);
  let selectedAddress;
  if(addressDecision==='write'){
    try{
      selectedAddress=await choosePostalAddress(page,field('주소를 입력해 주세요'),parts);
      await field('상세 주소를 입력해 주세요').fill(parts.detail);
    }catch(error){
      addressDecision='review';result.address={status:'review',reason:'postal_exact_match_unavailable',stage:error.postalStage || 'unknown'};
      assert(sha(await openEditor())===sha(before),'Native profile changed while address selection was pending');
    }
  }
  if(birthDecision==='write'){
    const n=field('생년월일 (YYYY-MM-DD)');await n.fill('');await n.pressSequentially(birthDate.value.replace(/-/g,''));await n.press('Tab');
    assert(await n.inputValue()===birthDate.value);
  }
  const writes=birthDecision==='write'||addressDecision==='write';
  if(writes){
    // Reopen the server profile separately immediately before saving a draft.
    const fresh=await page.context().newPage();
    try{assert(sha(await openEditor(fresh))===sha(before),'Native profile changed while this draft was open');}
    finally{await fresh.close();}
    await recordProgress({...result,saveIntentAt:new Date().toISOString(),beforeHash:sha(before),expectedHash:sha({birthDate:birthDate.value,address:selectedAddress,detail:parts?.detail})});
    try{await page.getByRole('button',{name:'회원 수정 완료',exact:true}).click();await page.waitForURL(detailUrl,{timeout:30000});}
    catch{result.saveResponse='unknown';}
    const after=await openEditor();assert(after.protectedHash===before.protectedHash,'Unrelated member fields changed during verification');
    if(birthDecision==='write')result.birthDate.status=after.birthDate===birthDate.value?'verified':'unknown';
    if(addressDecision==='write')result.address.status=after.address===selectedAddress&&after.detail===parts.detail?'verified':'unknown';
    if(birthDecision!=='write')assert(after.birthDate===before.birthDate,'Existing birth date changed unexpectedly');
    if(addressDecision!=='write')assert(after.address===before.address&&after.detail===before.detail,'Existing address changed unexpectedly');
    await recordProgress(result);assert(!Object.values(result).some(x=>x?.status==='unknown'),'Profile save outcome requires source review');
  }
  return result;
}
