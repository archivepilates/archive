import { REFERRAL_POLICY } from './lib/imweb-referral-policy.mjs';
import { readReferralMembers } from './lib/imweb-referral-source.mjs';

// Read-only by construction: no customer data is saved or printed.
const report = { policy: REFERRAL_POLICY, pages: 0, members: 0, ownReferralCode: 0,
  signupReferrerCode: 0, complete: false, payoutEnabled: false };
try {
  const scan = readReferralMembers();
  report.pages = scan.pages;
  report.members = scan.members.length;
  report.complete = scan.complete;
  report.ownReferralCode = scan.members.filter(member => member.recommendCode).length;
  report.signupReferrerCode = scan.members.filter(member => member.recommendTargetCode).length;
  console.log(JSON.stringify(report, null, 2));
  if (!report.complete) process.exitCode = 2;
} catch {
  console.error('Referral readiness audit incomplete. No points or member records were changed.');
  process.exitCode = 1;
}
