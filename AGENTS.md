# AGENTS.md

## Project

- Name: archive-in
- Primary rule: preserve existing user work and avoid production-impacting commands unless explicitly requested.

## Working Guidelines

- Read the current files before changing behavior.
- Keep edits scoped to the requested task.
- Prefer read-only checks before live automation or deploy actions.
- Do not run `git push`, deploy commands, or external service writes without explicit approval.
- Treat go-live language such as `배포`, `배포해줘`, `반영`, `publish`, or `release` as explicit approval for the full scoped sequence: validation, commit if needed, deploy, live verification, and GitHub push. Do not split deploy and push unless the user explicitly says deploy-only/local-only or a blocker applies.
- Put task notes under `docs/tasks/`, durable decisions under `docs/decisions/`, and generated outputs under `artifacts/`.

## ARCHIVE IN Work Coordination

- Use the main ARCHIVE IN project chat as the control surface for cross-cutting decisions about the web app, Firebase model, StudioMate sync, Google Contacts, Kakao Alimtalk, and deployment readiness.
- If a separate chat or agent is used for a narrow subtask, bring the decision/result back into the main ARCHIVE IN chat before treating it as project direction.
- When speed helps and the task can be split safely, use parallel agents, including the Spark model for quick read-only exploration or bounded implementation checks.
- For deployment, verification, and live-check workflows, treat parallel Spark/Subagent verification as the default. The main thread should run the production command and final judgment, while parallel workers handle UI smoke checks, API/function probes, Firestore/read-model spot checks, deploy-output review, GitHub Actions watch, and ARCHIVE CORE `운영규칙` consistency checks.
- Do not serialize all verification in the main thread unless the task is tiny, the required tool is unavailable, or a shared browser/session lock makes parallelism unsafe.
- Use worktrees when a change is non-trivial, experimental, or should be isolated from the current branch.
- Start live checks with read-only verification of the deployed ARCHIVE IN app, Firebase/Hosting configuration, and visible browser errors before proposing fixes.

## Brand Writing Rules

- Always write the app/product name as `ARCHIVE IN` in new chat responses, UI text, reports, documents, commit summaries, and operator-facing materials.
- Do not use `ArchiveIN`, `Archive In`, `archive in`, or other mixed/lowercase variants unless quoting an exact file path, URL, command, package name, branch name, or historical source text.

## Work Report Email Rules

- When sending project work reports by email from this project, use a concise mobile-readable subject and a no-fluff body structure.
- Subject format: `[업무][상태] 핵심결과 · 날짜`
- Keep the subject readable on a phone: put the most important result within the first 18 Korean characters after the brackets, avoid long file names, avoid stacked punctuation, and use one status only.
- Use the actual operation or project lane as `업무`, not a generic app name. Good examples: `[배포][성공] ARCHIVE IN 설문 반영 · 5/24`, `[알림톡][확인필요] 대상 3명 보류 · 5/24`, `[동기화][실패] 연락처 반영 중단 · 5/24`.
- Status values should be one of: `성공`, `실패`, `확인필요`, `긴급`, `진행중`.
- Body style should follow the Tesla-like principle: lead with the answer, remove ceremony, and write only decision-useful facts.
- Every work report email must identify the sender context near the top with both project name and chat/thread name so the report can be traced later.
- Body structure:
  1. `주체`: project name and chat/thread name. Example: `ARCHIVE IN / 메인 운영 채팅`.
  2. `결론`: one sentence with the outcome.
  3. `핵심`: 2-4 bullets with changed behavior, affected target, and current state.
  4. `검증`: exact checks run, live URL or surface checked, and result.
  5. `주의`: blockers, skipped checks, production risk, or `없음`.
  6. `다음`: the single next action needed from Codex or the operator, or `없음`.
- For flow-based Alimtalk failures where a message leads to a submission, staff handoff, report, or saved memo, include the root cause, current flow state, short submitted-answer summary when available, source identifiers, detail links, and the next operator action. This applies to private survey, group first-class survey, private lesson chart, private lesson report, InBody report, and StudioMate memo-write follow-up. Do not paste full sensitive survey answers into email when a secure ARCHIVE IN or Firestore detail link can be used; include only decision-useful summaries such as pain/goal/concern/referral.
- Design style should follow the ARCHIVE PILATES design system: quiet premium tone, strong hierarchy, generous spacing, restrained contrast, warm neutral background, black/charcoal primary text, muted secondary text, and one minimal accent color only when it improves scanning.
- HTML emails must be self-contained, responsive, and mobile-first. Use a single-column layout, max width around 640px, readable 15-16px body text, clear section labels, and no decorative clutter, gradients, emoji, external CSS, or external JavaScript.
- Plain-text emails should preserve the same structure with short headings and bullets.

## Playwright Test Rules

- When writing Playwright tests, use `storageState` for authenticated sessions instead of logging in through the UI inside each test.
- Create test data through an API or test fixture endpoint before the UI flow. Do not rely on manual pre-existing production data.
- Use only these locator families for new tests: `getByRole`, `getByLabel`, and `getByTestId`.
- Do not use `waitForTimeout`. Wait on user-visible state, network/API completion, URL changes, assertions, or deterministic test hooks instead.
- Configure failure debugging trace as `trace: 'on-first-retry'`.
- Keep tests deterministic and isolated: create the data they need, clean it up when the test environment supports cleanup, and avoid shared mutable fixtures across unrelated specs.
