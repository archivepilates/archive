# ARCHIVE PILATES Help public AI

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
