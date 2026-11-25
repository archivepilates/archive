# ARCHIVE PILATES Help member access pilot

## Status

2026-11-25 preflight: the exact Help member verification template is APPROVED
and present in the official sendable channel list. The member pilot is
ported to the current Help composer in a separate worktree. The OTP start
budget is enforced before private reads and the provider transport observes
the send deadline without automatic retry. This is not a live member release.

The deployed Help member URL currently returns the static Help page, not an
endpoint. An authenticated outbound relay from the Mac mini and a restrictive
same-origin Help gateway are still required. The existing 30-second operator
queue is not a real-time member path; the Mac's active Tailscale client does
not establish a verified cloud peer or route. Bind the gateway only to the
member protocol; no operator MCP, browser credentials, student search,
administrative access, or payment data may cross the public boundary.
Before a real enrollment, wire approved signup/contact evidence, current
binding and revocation, owner-only storage, and exact activity/card mappings.
Run a one-member HTTPS passkey and self-only lookup pilot before broader
activation. Do not send a standalone code without this working path.

The durable passkey backend and separate Alimtalk-code enrollment are implemented and verified with synthetic records. The internal StudioMate adapter was also checked against a single operator-approved real test member for current passes and recent booking history. The actual member's passkey has not been enrolled or used to authenticate on the public site. No production endpoint, outbound notice, Firestore/Auth change, or Hosting rewrite has been created. The existing public Help site and its member-app handoff remain unchanged.

2026-11-24 follow-up: SOLAPI returned `INSPECTING` for the new Help security code template after submission. Do not send while it is pending. The scoped sender validates the approved template on each request, disables SMS fallback, rechecks the send window and stores only provider IDs with a matching acceptance receipt. Code expiry is separate from the dispatch claim, which survives until invitation expiry. These guards were tested without delivery. The authenticated Help-to-Mac-mini connection and canonical signup/contact authority still must be configured before a real-member pilot.

2026-11-24 operating decision: use the welcome Alimtalk `#member-invite=<opaque-token>` entry point, then deliver a separate verification code to the verified StudioMate number when the user requests it. First passkey enrollment requires both proofs; later login requires the passkey only. The server accepts a separately enabled transport and never selects a recipient from chat. Use the approved SOLAPI security template, no automatic SMS fallback, and enforce the existing 09:00–23:00 KST dispatch window. Codes expire within five minutes, with five guesses and no replay of a dispatch claim. A verified event does not imply provider delivery. Returning members without an invitation can sign in if already registered; unregistered existing members need an authorized new invitation.

## Required private adapters

- `verifyEnrollment(reference, options)`: trusted internal registration proof for the exact native `(studioId, memberId)`. The operator defines verified StudioMate signup completion as the in-person identity proof (`in_person_signup`). Use the current, exact native completion record, never a contract signature or welcome-send receipt alone. There is no public issue-invite endpoint.
- `confirmRegistrationEnrollment(options)`: reserve a short-lived receipt to the exact invitation, verified member and first browser step atomically, and recheck it at final registration. For in-person signup, authorized staff must attest that the step is on the present member's own device; no duplicate SMS verification is needed. The optional `registered_contact` method instead requires current-channel possession. Do not echo caller-supplied digests as proof. A forwarded link or member ID is insufficient for either method.
- `confirmBinding(options)`: check a fresh native/verified current enrollment binding, including active status and the authoritative revision. Contact changes, deactivation, merge, disputed ownership, or revoked credentials must invalidate the matching revision. Never allow an input value from the public browser to become an account or member selector.
- `loadExpectedIdentity(options)`: server-side exact lookup for the active binding's native ID, returning the positive studio, member ID, revision, name, and full phone proof only inside the reader.
- `nativeReader`: `createInternalStudioMatePilot` attaches an in-process, two-method adapter to the existing administrator session on the Mac mini. It preserves the shared browser lock and native readback. No new StudioMate role is required. The authenticated lookup supplies the target exclusively from the server-side session; browser input is never used for member selection, and the operator MCP, profile, search and credentials are not routed to Help. Strip payment and internal booking metadata before rendering personal results. Render exact remaining counts and dates without an AI call; any later recommendation receives only the minimum summary rather than raw records.
- `classifyTicket(ticket)`: exact separately reviewed native product/status mapping. Unknown product or status must not result in a displayed or recommendable pass.

Fresh proof is time-bounded and stamped only after the trusted observation. Account identity is an opaque identifier, and the private store holds the selected native member number and version; it does not hold names, phone numbers, health data, purchases, AI prompts or vendor tokens. Configure a real owner-only directory with mode `0700`. Only passkey public keys are retained. Keep backup and credential revocation part of binding-store operations.

## Display and launch gate

`cards` exposes category, remaining and bookable counts separately, and verified end date. Missing counts stay unknown. `history` shows at most five actual attended events in the verified prior 31-day range. The current native booking source distinguishes group from private-family, not individual from duet, and supplies no equipment. Do not feed it into personalized equipment recommendations until a verified class/equipment join exists.

Real owner tests require the trusted staff device-confirmation path or approved remote contact verification, verified product/status mapping, exact member readback, a member-controlled passkey on the pinned Help HTTPS origin, revocation/rotation, and browser-lock capacity. Do not automatically attach passkeys to all historical members. The missing deployment dependency is an authenticated path from Help Hosting to the private member service on the Mac mini, not a second StudioMate account. Never publish an administrator-capable service endpoint. A Firebase Hosting rewrite forwards only `__session`; the implementation scopes that host-only cookie to `/api/member-access/`. Independently verify forwarding, expiry and failure behavior on the actual edge. The welcome Alimtalk button is last and separately verified. Do not enable member accounts in the existing CORE Firebase Auth project or use snapshot data as a substitute for a failed live lookup.

## Local verification

Run `npm ci --ignore-scripts` and `npm test` from `services/archive-help-member-access`. `verify-browser.mjs` uses Playwright with `ARCHIVE_PLAYWRIGHT_PACKAGE`. It intercepts all network requests and uses the Help frontend, fixture data, a mock Alimtalk sender, the real WebAuthn verifier and a virtual authenticator. In that test, successful authentication returns to the pending member conversation without passing member records to the public-chat answer engine.
