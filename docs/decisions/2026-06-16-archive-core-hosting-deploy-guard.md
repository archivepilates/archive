# ARCHIVE CORE Hosting Deploy Guard

Date: 2026-06-16

## Problem

ARCHIVE CORE live Hosting was redeployed from an older bundle. The home page lost the current pricing inquiry quick-send card and reverted to the earlier KPI section sizing.

## Decision

ARCHIVE CORE Hosting deployments must run the CORE deploy guard before release. The guard checks for the current home action dashboard, pricing inquiry quick-send/history UI, and the stable KPI sizing CSS.

## Implementation

- Validator: `scripts/validate-archive-core-hosting-deploy.mjs`
- Official deploy command: `npm run deploy:archive-core-live`
- Firebase Hosting predeploy guard: `validate:archive-core-hosting` on site `archive-pilates-core`
- Active operating rule surface: `core/rules/index.html`

## Operating Rule

Do not deploy `archive-pilates-core` from old ARCHIVE CORE worktrees or from branches that do not pass the guard. If a CORE deployment fails the guard, refresh from the current CORE source branch before deploying.
