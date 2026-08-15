# Imweb My Classroom session refresh

## Goal

- Show a newly purchased video in My Classroom without requiring logout and login.
- Keep the existing member-group entitlement and hidden watch-page access model unchanged.

## Implementation

- My Classroom checks watch-page access immediately and automatically retries after 2 and 5 seconds.
- The page keeps already discovered cards visible while checking for newly granted access.
- The empty state offers `권한 다시 확인` before the separate-account login action.
- The loader watchdog allows the retry window to finish before invoking runtime recovery.

## Safety boundary

- No member, order, product, group, payment, or watch-page permission data is changed by this patch.
- Logged-out and non-buyer watch-page gates remain required release checks.

## Verification

- `npm run validate:archive-home-classroom`: passed.
- Delayed-entitlement browser test: opened My Classroom without AR4, granted AR4 after the first probe, and observed one AR4 card on the second probe without reload or relogin.
- The test member's original groups were restored and read back successfully.
- Pending scoped Hosting deploy, Imweb loader update, and live canary.
