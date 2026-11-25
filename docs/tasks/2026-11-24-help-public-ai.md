# ARCHIVE PILATES Help public AI

## Official-only recovery (2026-11-25)

- Validate model-selected reference IDs against the public catalog, the KST
  publication period, and the requested day before checking the model's prose.
  If the prose is rejected, return only verified reference rows or the verified
  timetable with a fixed lead. An invalid selection or no usable facts still
  falls back to Basic guidance.
- Structured function diagnostics distinguish provider timeout, HTTP errors,
  invalid responses, invalid reference selections and rejected prose. They
  omit prompts, output, member information and credentials. Model deadline
  8 seconds, browser deadline 9.7 seconds, function deadline unchanged at
  12 seconds. No retry or policy/privacy guard relaxation.

## Inline GPT send and usage controls (2026-11-25)

- The first-question modal is replaced by a visible OpenAI notice next to
  the composer, a GPT send action and a separate Basic send action. Enter
  uses the primary action. Basic sends and preset shortcuts stay local and
  clear GPT history; private input stays blocked regardless of send action.
- The site-wide daily and per-minute caps were removed. The old Firestore
  counter is retained as historical data; the live endpoint no longer
  depends on it. Use the OpenAI usage dashboard to track model usage.
  Per-request budget, runtime concurrency and provider billing settings
  are unchanged. If GPT is unavailable the UI still shows Basic guidance.

## Previous GPT-first public consultation

- Replaces the previous routing and guided reply in the public UI and endpoint.
  After an explicit per-chat choice, GPT receives the current public wording
  and up to two preceding public exchanges. Basic guidance needs no API call.
  The usual identifiable text signs are blocked on both sides; visitors
  are reminded not to submit personal or health information. The guard is not
  anonymization. The API has no member or action tool, and personal queries
  stay on the local member-app path.
- The conversational reply selects official rule, rate and timetable records.
  The server renders the selected facts rather than trusting an AI-composed
  price or time; weekday and month conflicts fail closed, and promotions are
  not availability checks. Existing global limits and billing settings are
  unchanged. `HELP_PUBLIC_NATURAL_CHAT_ENABLED=false` restores basic-only mode.
- Member authentication is separate. No test dispatch until the exact SOLAPI
  template is APPROVED and the KST dispatch window and self-only flow checks
  pass. Preserve the current member-app handoff while pending.

## Previous releases

## Public answer and contact update

- Typed public turns and follow-ups submit an allowlisted versioned packet
  with the current/previous public topic and relevant day, time, frequency
  and beginner flags. Conversation text stays in the tab; no member lookup,
  external tool, model-side thread or raw text transmission is used.
- GPT writes Korean response prose using checked-in public evidence. The
  backend inserts official times, prices and policy text itself rather than
  accepting model-generated values. Timetable and rates fail closed outside
  the verified KST month. Missing or rejected responses use local guidance.
- GPT may choose one applicable follow-up from a server allowlist when a
  visit preference or policy category is still unknown. The site renders the
  approved question and accepts either a short reply or an option button.
  Existing rate limits, data minimization, and member-app handoff are unchanged.
- Mobile chat continuity preview: keep the composer in the visible viewport
  while typing and keep shortcuts on one scrollable row. Treat daily exercise
  as distinct from daily studio attendance, resolve short date follow-ups
  against the public KST timetable, and preserve the previous topic on an
  unclear turn. The model still receives only public structured context, not
  the user's sentences or conversation history; unrecognized wording gets a
  clarification, not an unrestricted AI answer.

- Staff and refund CTA links open the official Kakao channel. The Help form
  is retired; old public form URLs redirect to the channel and Help no longer
  rewrites to the intake function. Existing CORE records, retention, staff
  workflow and backend permissions are unchanged. Kakao messages do not
  automatically create CORE inquiries or execute bookings.
- Keep the existing Pro-only payment posture and per-day/per-minute limits.
  Tests use synthetic questions only; no Kakao message or inquiry is sent.

## Direct conversation preview

The independent v3 preview lets GPT read the current public question and up
to two recent public exchanges. It uses the named ARCHIVE PILATES identity,
the official home and Team Archive profiles, and date-checked public rule,
schedule and pricing facts. This is an updateable prompt and source set, not
fine-tuning. No model tools, stored provider conversation, or member lookup
are used. Unverified history and private staff records are excluded.

The browser and server block recognizable identifiers and personal topics.
This is not a guarantee of anonymization for arbitrary free text. The
live deployment deliberately leaves the explicit v3 enable flag unset:
privacy review found sensitive free text can pass a denylist and the model
can attach a real lesson time to the wrong day. The scoped release is
mobile layout, contextual v2 answers, and published brand/team facts.
The private v3 preview requires a per-chat choice, but consent is not a
replacement for privacy filtering or place/date-specific source validation.
The shared production usage counter and member-app handoff are unchanged.

## Published promotion and pass comparison

The November public Notion price page (3ebd49ea-e4bf-8198-ba47-c4cb222d7c69)
was re-read before adding the three published promotion rows. They are
separate from normal rates and never prove that the limited promotion is
still available. Both close at the end of November KST. The recommendation
flow keeps visit-frequency ranges and explicit after-hours preferences,
checks them against the published timetable, and renders the verified
product rows without an AI call. Live bookings and inventory are not read.

## Initial classification release

Use the OpenAI Responses API only as a routing aid for typed public questions the existing
conversation logic could not classify. The browser sends fixed vocabulary
tags and bounded values for previous public preferences, never the original
question, chat transcript, or a member record. No tools or links are derived
from the model. The response must be a single accepted intent grounded in the
incoming tags or topic; the existing dated public timetable, pricing and rules
produce the displayed answer. The current question or draft is never sent as
model input. Personal questions and known policy responses keep their existing
path. This is not unrestricted generated advice.

## Limits and launch

- Only the ARCHIVE PILATES Help origin may use the browser route.
- The function only runs for the `archive-pilates` project and can be
  turned off with `HELP_PUBLIC_AI_ENABLED=false`. Use a dedicated OpenAI project and
  `HELP_PUBLIC_OPENAI_API_KEY` only after model access and the incremental-cost
  boundary are confirmed. ChatGPT login is not a runtime credential. If using
  the subscription API credit benefit, verify an active grant in the intended
  API organization and that calls cannot draw on purchased credits or paid
  billing. Do not change billing settings automatically or reuse a different
  workload's key. Requests use `store: false` and no tools or provider history.
- Global allowance: 20 model calls per UTC day, 4 per minute. Fail closed
  before calling the model if the counter cannot be reserved; do not retry
  the model call. The singleton counter contains bounds and counts only.
- Verify with synthetic prompts on the real model before public enablement.
  Confirm one positive public route, one expired source, one private bypass,
  one mismatched intent rejection and one timeout/fallback. Hosted privacy,
  member records, inquiries, payments and outbound messaging stay unchanged.
- Publish only the Help function and Help Hosting after validation of the
  credential, billing tier and real response. A simulated response or a
  disabled function is not an AI release.

## Current status

The Personal API organization received the Pro promotional grant, with no
added API payment method or auto-recharge. The dedicated Responses key is
in Secret Manager and expires on 2026-12-24; rotate it before expiry or
the site falls back to its existing answers. A synthetic pricing signal
returned `price` from GPT-6 Luna before rollout. No member lookup or inquiry
submission was used for validation.
