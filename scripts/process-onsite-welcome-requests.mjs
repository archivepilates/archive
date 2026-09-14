#!/usr/bin/env node
// Compatibility entrypoint: retired jobs must never reopen a browser or claim work.
console.log(JSON.stringify({
  ok: true,
  status: "retired",
  source: "onsite_welcome_playwright_runner",
  reason: "StudioMate direct registration replaced onsite welcome",
  processed: 0,
}));
