const compact = value => value.normalize('NFC').replace(/[\p{White_Space}\uFEFF]+/gu, ' ').trim();
const empty = value => value == null || typeof value === 'string' && compact(value) === '';
const result = (status, value = '', reason) => ({ status, value, ...(reason ? { reason } : {}) });
const review = reason => result('review', '', reason);
const validClock = now => now instanceof Date && Number.isFinite(now.getTime());

function civilDate(year, month, day) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeSignupBirthDateV2(value, now = new Date()) {
  if (empty(value)) return result('not_provided');
  if (typeof value !== 'string') return review('birth_date_type');
  if (!validClock(now)) return review('invalid_clock');
  const raw = compact(value);
  if (/^\d{6}$/.test(raw)) return review('birth_date_century_unverified');
  const separated = raw.match(/^(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})$/);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    || (separated && [raw, separated[1], separated[3], separated[4]])
    || raw.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (!match) return review('birth_date_format');
  const date = civilDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  if (!date || date >= today) return review('birth_date_not_valid_past_date');
  return result('verified', date);
}

export const SIGNUP_SIX_DIGIT_BIRTH_POLICY = 'yy_kst_current_year_v1';

export function resolveSignupBirthDateV2({ expected, current = '', now = new Date() } = {}) {
  if (empty(expected) || typeof expected !== 'string' || !validClock(now)) return normalizeSignupBirthDateV2(expected, now);
  const raw = compact(expected);
  if (!/^\d{6}$/.test(raw)) return normalizeSignupBirthDateV2(expected, now);
  const existing = normalizeSignupBirthDateV2(current, now);
  const nativeMatch = existing.status === 'verified' && existing.value.replace(/-/g, '').slice(-6) === raw;
  const kstYear = new Date(now.getTime() + 9 * 3600000).getUTCFullYear();
  const year = Number(raw.slice(0, 2));
  const resolved = nativeMatch ? existing : normalizeSignupBirthDateV2(
    `${year <= kstYear % 100 ? 2000 + year : 1900 + year}${raw.slice(2)}`, now);
  if (resolved.status !== 'verified') return resolved;
  return { ...resolved, resolution: { policy: SIGNUP_SIX_DIGIT_BIRTH_POLICY,
    referenceAt: now.toISOString(), source: nativeMatch ? 'native_full_match' : 'current_year_rule' } };
}

const REGION = /^(?:대한민국\s+)?(?:서울(?:특별시|시)?|부산(?:광역시|시)?|대구(?:광역시|시)?|인천(?:광역시|시)?|광주(?:광역시|시)?|대전(?:광역시|시)?|울산(?:광역시|시)?|세종(?:특별자치시|시)?|경기(?:도)?|강원(?:특별자치도|도)?|충청북도|충청남도|충북|충남|전북(?:특별자치도)?|전라북도|전라남도|전남|경상북도|경상남도|경북|경남|제주(?:특별자치도|도)?)\s+/u;
const ADDRESS_PART = /[가-힣\d]+(?:대로|번길|길|로|동|리|가)\s+\d+(?:-\d+)?(?:\s|$|[,()])/u;
const PLACEHOLDER = /^(?:없음|미기재|미입력|미제공|미정|모름|비공개|해당없음|주소없음|주소미정|주소|상세주소|n\/?a|none|null|undefined|unknown|[-_.?,~…]+)$/i;

export function normalizeSignupAddressV2(value) {
  if (empty(value)) return result('not_provided');
  if (typeof value !== 'string') return review('address_type');
  const address = compact(value).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (address.length > 500 || /[\p{Cc}\p{Cf}]/u.test(address)) return review('address_unsafe_text');
  if (PLACEHOLDER.test(address) || /주소를?\s*입력|상세주소|미기재|미입력|미제공/.test(address)) return review('address_placeholder');
  // Recognize a supplied Korean administrative region and a road/lot number. Do not
  // complete, geocode or expand any missing region, postal code or unit information.
  if (!REGION.test(address) || !ADDRESS_PART.test(address)) return review('address_not_korean_or_incomplete');
  return result('verified', address);
}

export function decideSignupProfileFieldV2({ field, current, expected, now = new Date() } = {}) {
  const normalize = field === 'birthDate' ? value => normalizeSignupBirthDateV2(value, now)
    : field === 'address' ? normalizeSignupAddressV2 : null;
  if (!normalize) return 'review';
  if (empty(expected)) return 'not_provided';
  const wanted = field === 'birthDate' ? resolveSignupBirthDateV2({ expected, current, now }) : normalize(expected);
  if (wanted.status !== 'verified') return 'review';
  if (empty(current)) return 'write';
  const existing = normalize(current);
  if (existing.status !== 'verified') return 'review';
  return existing.value === wanted.value ? 'already_equal' : 'conflict';
}
