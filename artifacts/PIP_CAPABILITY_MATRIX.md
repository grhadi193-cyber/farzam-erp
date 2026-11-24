# PIP CAPABILITY MATRIX — Phase 0 inventory (2026-11-24)

Status key: ✅ Verified working · 🔎 Present, unverified · 🟡 Partially working · ❌ Broken · ⛔ Missing · 🚧 Blocked · 🎭 Simulated

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Server ERP live deployment (Vercel) | ✅ | https://farzam-erp.vercel.app responds; deploys from GitHub main verified twice on 2026-11-24 |
| 2 | User auth (JWT login, roles admin/finance/employee/viewer) | ✅ | Login 500 outage found and fixed (commit b46aa69c); fake login → 401, real admin login → dashboard renders (browser-verified 2026-11-24 18:44) |
| 3 | Agent API `/api/agent/*` (Bearer key) | ✅ | Helper `~/workspace/custom-connectors/custom.farzam-erp/bin/farzam-erp` used all day: analytics, registers, ledgers, customers, products, knowledge, questions, bank-accounts — all 200/201 |
| 4 | Registers: expenses / income / payroll | ✅ | Endpoints + UI tabs exist and respond; currently 0 rows (clean 1405 start, by design) |
| 5 | Universal intake + classification (events) | ✅ | Built and exercised in the test era; 0 unprocessed events now |
| 6 | Ledgers: receivables / payables / cheques (Sayad) | 🟡 | 10 opening items loaded and shown; cheque flow exists in schema/UI but no cheque data yet; due dates empty on opening rows |
| 7 | Customers & products master data | ✅ | 33 customers / 4 products loaded with national IDs and codes; UI tabs render (browser-verified) |
| 8 | Bank accounts module + dashboard cash card | ✅ | Added commit 98f7a519; 4 accounts, dashboard total 4,660,690,186 Rial rendered |
| 9 | Management questions module | ✅ | 20 seeded from data/questions-seed.json; 11 answered via agent API; UI tab works |
| 10 | Knowledge / rules module | ✅ | 9 entries live (added via agent API; not code-seeded) |
| 11 | Tasks module | 🔎 | Code + UI tab exist (parity build); not exercised with real data |
| 12 | Audit log | ✅ | audit endpoint returns rows; reset recorded 93 audit rows in test era |
| 13 | Receipt photo upload (browser-compressed data URL) | 🔎 | Implemented end to end in parity build; not re-verified after latest deploys |
| 14 | Factory reset endpoint (agent, confirm-guarded, keeps users) | ✅ | Executed on production 2026-11-24; verified counts |
| 15 | Users-table self-healing at boot | ✅ | Commit b46aa69c; regression-tested locally (legacy-schema fixtures A/B + fresh-DB suite 10/10); live login healthy after deploy |
| 16 | Production data persistence | 🟡 | Data survived multiple redeploys on 2026-11-24 (evidence for a persistent remote libsql store), but the exact Turso configuration is not directly visible to the agent; weekly backup cron mitigates |
| 17 | Google Drive intake tree (Hazine/company-expenses) | ✅ | Read/written daily by hourly cron; IDs in `~/workspace/company-expenses/system-config.md` |
| 18 | Google Sheets registers (4 files) | ✅ | Read back 2026-11-24 21:06: expenses row 1 present with tracking no. and receipt date/time columns |
| 19 | Muse panel «پنل ERP فرزام» (12 tabs) | ✅ | getOverview verified 2026-11-24: opening state loaded; daily refresh cron enabled |
| 20 | GitHub snapshot push flow | ✅ | 10 sync-record entries; pushes 98f7a519 and b46aa69c landed and deployed |
| 21 | WhatsApp owner channel | ✅ | 1:1 WhatsApp chat connected; hourly/weekly reports deliver there; fallback outbox: artifacts/whatsapp-outbox.md |
| 22 | Telegram connector (custom.telegram) | ❌ | Platform fault: instant 404 on getMe (retested 2026-11-24 20:00); bot token itself valid via direct call. Mission forbids Telegram work — recorded as limitation L-01 |
| 23 | Telegram bot intake (Codex-built, writes to Drive) | ✅ | Records arrive in Drive incoming; outside this repo; not modified per mission rules |
| 24 | Automated tests / lint / CI in repo | ⛔ | No test suite, no lint config, package.json has only `start`. Validation is manual boot + smoke (see Phase 7 plan) |
| 25 | Static asset cache control (app.js/styles.css) | ❌ | express.static with no cache headers and unversioned asset URLs in public/index.html — owner saw a stale UI after a deploy on 2026-11-24 and needed Ctrl+F5. Phase 3 fix candidate |
| 26 | Receivables aging / intelligence analytics | 🟡 | analyticsSummary gives open totals + category split; no aging buckets, no overdue computation, no anomaly flags in code yet (weekly/monthly cron reports cover part of this outside the repo) |
| 27 | Mock/demo data | 🎭 | Demo rows exist only behind SEED_DEMO=true; production runs real (test-phase) data only, clearly separated |
| 28 | Docker deployment path | 🔎 | Dockerfile + docker-compose.yml present, YAML-validated; Docker is not installed on the agent VM, so the compose path is unverified at runtime |
