import { REFERRAL_ORIGIN, validReferralCode } from './imweb-referral-links.mjs';

export function nativeProfileLink(document) {
  return document.querySelector('a[onclick^="SITE_MEMBER.editProfile("]');
}

export function nativeSignupField(document) {
  const matches = [...document.querySelectorAll('#join_form input#recommend_code[name="recommend_code"]')]
    .filter(field => field.type === 'text' && !field.disabled && !field.readOnly &&
      !field.form?.querySelector('._recommend_code_wrap'));
  return matches.length === 1 ? matches[0] : null;
}

export function nativeOwnCode(document) {
  const codes = [...document.querySelectorAll('._recommend_code_wrap')]
    .map(field => field.textContent.trim()).filter(validReferralCode);
  return codes.length === 1 ? codes[0] : null;
}

export function isReferralSite(location) {
  return location.origin === REFERRAL_ORIGIN && !/^\/(?:admin|logout\.cm)(?:\/|$)/.test(location.pathname);
}

export function waitForNative(window, read, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let timer;
    const observer = new window.MutationObserver(check);
    function finish(value, error) {
      observer.disconnect(); window.clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    function check() {
      try { const value = read(); if (value) finish(value); }
      catch (error) { finish(null, error); }
    }
    observer.observe(window.document.body, { childList: true, subtree: true, characterData: true });
    timer = window.setTimeout(() => finish(null, new Error('Native member dialog unavailable')), timeout);
    check();
  });
}
