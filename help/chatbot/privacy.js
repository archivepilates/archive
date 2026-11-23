const labeled = /(?:성함|이름|연락처|전화번호|휴대폰|회원번호|생년월일|비밀번호|인증번호|주민번호|계좌번호|주소)\s*[:：=]|(?:제|내)\s*(?:이름|성함|연락처|전화번호|회원번호|생년월일|주소)\s*(?:은|는|이|가|:)/u;
const contact = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}.-]+\.[\p{L}\p{N}]+|(?:\d[\s.()+-]*){9,}|(?:\+82|0)\s*(?:1[016789]|2|[3-6][1-5])(?:[\s.-]*\d){7,8}/iu;
const birthDate = /생년월일\s*(?:은|이)?\s*\d/u;

export function privateInput(value) {
  const text = value.normalize('NFKC');
  return labeled.test(text) || contact.test(text) || birthDate.test(text);
}

export const healthInput = /통증|아파|디스크|수술|임신|산후|질환|재활|부상|진단|아프/u;
