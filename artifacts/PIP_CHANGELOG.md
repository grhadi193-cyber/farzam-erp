# PIP CHANGELOG — Farzam ERP (repo: grhadi193-cyber/farzam-erp)

## Baseline (before this mission, 2026-11-24)
- `1053c0b2` Initial server build (Node + Express + libsql, JWT roles, agent API, Persian RTL UI).
- `95748841` Vercel adaptation (api/index.js entry, rewrites).
- `ce257305` Ephemeral-storage fallback fix.
- `42026d66` Panel-matching UI + agent customers/products endpoints.
- `2cc2b600` Receipt-photo upload parity.
- `ed8a7ea9` Dashboard-math parity with the Muse panel.
- `56bdb977` Full structural parity: 12 tabs, 12 KPI cards, tasks + questions modules, 20-question seed.
- `1d8869d3` Agent-only factory reset endpoint (confirm-guarded, keeps users).
- `98f7a519` Bank accounts module (user + agent API, dashboard cash card, analytics cash total).
- `b46aa69c` Self-healing users-table repair at boot — fixes production login 500 (legacy users schema). Verified live: fake login → 401, real login → dashboard.
- Data (not code): full 1405 opening state loaded via agent API and verified (4 bank accounts / 4,660,690,186 Rial, 33 customers, 4 products, 10 ledger items, 9 knowledge entries, 11 question answers).

## Mission run — 2026-11-24 (autonomous execution, phases 0–8)
- Phase 0: created artifacts/PIP_STATE.md, PIP_CAPABILITY_MATRIX.md, PIP_ASSUMPTIONS.md, PIP_CHANGELOG.md. No product code changed.
- Phase 1: artifacts/PIP_EXISTING_SYSTEM_AUDIT.md — 11 findings (F-01 login 500 already fixed; F-02 Sheets↔server divergence HIGH; F-03 stale static assets; F-04 no tests; F-05 no list filters; F-06 schema check users-only; F-07 JWT fallback; F-08 list limits unverified; F-09 opening-data gaps; F-10 Docker unverified; F-11 cash card placement).
- Phase 2: artifacts/PIP_IMPLEMENTATION_BACKLOG.md — 10 items B-01…B-10 with acceptance criteria.
- Phase 3 / B-01 DONE (automation + data, no repo code): backfilled the one divergent Sheets row (EXP-1795539744164) into the server ERP expenses register (server row id 1, record_folder 1405-09-03_2032_mhmdfrzm_8993717144, review_status «مشکوک - رسید تکراری» preserved). Verified via analytics: expenses 1 row / gross 30,000,000 / duplicate_expenses_rial 30,000,000 → confirmed spend still 0; the two stores now agree. The hourly cron (company-expenses-hourly-register) gained a SERVER MIRROR step: every future Sheets registration is mirrored once into the server via the agent API in the same run; mirror failures surface in the run report instead of diverging silently.
- Phase 3 / code batches DONE (validated locally): B-08 cash card moved under the KPI grid (public/app.js); B-04 list search/filter with fa/ar normalization (app.js + styles.css); B-02 no-cache headers + ?v=2 assets (vercel.json, server.js, index.html); B-05 read-only verifySchema() for all 13 tables (src/db.js); B-09 ledger_aging + B-10 review signals incl. reused_tracking_numbers and zero_amount_with_receipt (src/db.js, app.js monitoring tab, docs/agent-api.md); B-03 scripts/smoke.mjs + npm test — 15/15 PASS; F-01 legacy fixtures re-verified green.
- Phase 4 DONE: PIP_DATABASE_CHANGES.md — no schema changes; additive-only contract; B-07 verified (all list endpoints cap at 500, audit 200; nothing truncated at current volumes; captions deferred).
- Phase 5 DONE: intelligence = B-09/B-10 in-product (deterministic code/SQL) + existing scheduled reports mapped as the CFO cadence.
- Phase 6 DONE: B-04/B-08 (browser click-through of the new build pending deploy).
- Phase 7 DONE: PIP_VALIDATION_REPORT.md (Passed / Partially verified / Not tested / Blocked).
- Phase 8: reports written (executive, implementation, next actions, WhatsApp log, outbox). Final delivery held for deployment.
- ⛔ PUSH BLOCKED: the GitHub push of the 15-path mission batch hit the platform approval card, which expired unanswered at ~22:37 (owner away). Push NOT performed; sync record unchanged. Remote main is at bc6a1b16 (owner's README/main.yml web edits — no overlap). Unblocks with the owner's «پوش کن», then: push → deploy → live verification (cache headers, fake-login 401, analytics aging/review, dashboard order) → completion message.
