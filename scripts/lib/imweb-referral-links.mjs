export const REFERRAL_ORIGIN = 'https://archivepilates.imweb.me';
export const REFERRAL_PARAM = 'ap_invite';
export const REFERRAL_STORAGE_KEY = 'archive.referral.v1';

export function validReferralCode(value) {
  return typeof value === 'string' && /^[A-Z0-9]{8}$/.test(value);
}

export function makeReferralLink(code) {
  if (!validReferralCode(code)) throw new Error('Invalid referral code');
  const url = new URL('/', REFERRAL_ORIGIN);
  url.searchParams.set(REFERRAL_PARAM, code);
  return url.href;
}

export function incomingReferral(url) {
  const parsed = new URL(url);
  const values = parsed.searchParams.getAll(REFERRAL_PARAM);
  return values.length === 1 && validReferralCode(values[0]) ? values[0] : null;
}

// Store only a public code for this browser tab. Never store member identifiers.
export function rememberReferral(storage, url, ownCode = null) {
  const incoming = incomingReferral(url);
  const previous = storage.getItem(REFERRAL_STORAGE_KEY);
  if (validReferralCode(previous)) return previous === ownCode ? null : previous;
  if (!incoming || incoming === ownCode) return null;
  storage.setItem(REFERRAL_STORAGE_KEY, incoming);
  return incoming;
}

export function applyReferralToField(field, code) {
  if (!field || field.disabled || !validReferralCode(code)) return false;
  if (field.value && field.value !== code) return false;
  if (field.value === code) return true;
  field.value = code;
  const EventType = field.ownerDocument.defaultView.Event;
  field.dispatchEvent(new EventType('input', { bubbles: true }));
  field.dispatchEvent(new EventType('change', { bubbles: true }));
  return true;
}
