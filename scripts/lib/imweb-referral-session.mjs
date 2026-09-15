import { rememberReferral, applyReferralToField } from './imweb-referral-links.mjs';

// Native form elements must be supplied by the site adapter after live inspection.
// This layer never creates members, submits forms, or awards points.
export function connectReferralSession({ window, resolveSignupField, readOwnCode = () => null }) {
  let stopped = false;
  let scheduled = false;
  let frame;
  function sync() {
    scheduled = false;
    if (stopped) return;
    let code;
    try { code = rememberReferral(window.sessionStorage, window.location.href, readOwnCode()); }
    catch { return; }
    if (code) applyReferralToField(resolveSignupField(), code);
  }
  const observer = new window.MutationObserver(() => {
    if (!scheduled && !stopped) {
      scheduled = true;
      frame = window.requestAnimationFrame(sync);
    }
  });
  observer.observe(window.document.body, { childList: true, subtree: true });
  window.addEventListener('pageshow', sync);
  sync();
  return () => {
    stopped = true;
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    window.removeEventListener('pageshow', sync);
  };
}
