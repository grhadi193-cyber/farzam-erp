# PIP EXISTING SYSTEM AUDIT — Phase 1 (2026-11-24)

Scope: repo `grhadi193-cyber/farzam-erp` (server.js, src/db.js, src/auth.js, public/*), live deployment https://farzam-erp.vercel.app, and its place in the wider system (Drive/Sheets intake, Muse panel). Every finding references a file, route, schema object, or observed behavior.

## What is solid (verified)

- **Architecture** — single Express app (server.js, 25 app-level routes + registers router + `/api/agent` router), libsql storage (src/db.js), JWT auth with 4 roles (src/auth.js), static Persian RTL SPA (public/index.html: `lang="fa" dir="rtl"`, viewport meta present). Clean, small, coherent.
- **Schema** — 13 tables in src/db.js: users, events, expenses, income, payroll, ledger_items, customers, products, bank_accounts, knowledge_entries, tasks, questions, audit_log. Register tables share one column contract (incl. tracking_no, receipt_date_time, receipt_image, review_status).
- **Dashboard** — 12 KPI cards with panel-identical definitions (public/app.js loadDashboard), ledger-open table, bank-accounts card with per-account opening balances and a cash total; header data-status line honestly reports what was read and which modules are empty (renderBadges).
- **Monitoring tab** — computes data-quality signals client-side (duplicate-pending totals, expenses without receipt, attention count, receipt quality %) from real API data (public/app.js loadMonitoring).
- **Error handling** — global handler (server.js:486) returns a generic Persian 500 and logs the real error server-side; the login outage was diagnosable from exactly this behavior.
- **Empty states** — dashboard and lists render explicit empty text (e.g. «دفتر بازی وجود ندارد») rather than blanks; registers at 0 are presented honestly.

## Findings

### F-01 ✅ FIXED — Login 500 for every user (critical, found & fixed 2026-11-24 before this audit)
Production `users` table carried a legacy schema (no `email` column); `CREATE TABLE IF NOT EXISTS` never upgrades, so the login SELECT (server.js:41) threw before any credential check. Fixed by `repairUsersTable()` in src/db.js (commit b46aa69c), regression-tested on legacy-schema fixtures. Lesson recorded: boot-time schema verification now exists for users only — see F-06.

### F-02 🔴 HIGH — Two register stores can diverge (Sheets vs server ERP)
Observed 2026-11-24 21:06: the Sheets expense register contains row 1 (EXP-1795539744164, 30,000,000 Rial, «مشکوک - رسید تکراری») while the server ERP registers and events are empty. Cause: the hourly intake writes Drive→Sheets; the server DB is only written through its own intake/agent API, and the Muse panel is refreshed from the Sheets side. There is no automated Sheets→server sync, so "the ERP" can show zeros while the register of record has rows. Weekly/monthly automations compare the two and flag mismatches, but nothing reconciles automatically. → Backlog B-01.

### F-03 🟠 MEDIUM — Static assets can go stale in the browser
public/index.html loads `/styles.css` and `/app.js` unversioned; server.js:29 uses `express.static` with no cache headers. Observed 2026-11-24: after the bank-module deploy, the owner saw the old UI and had to Ctrl+F5. On Vercel the static files are served by the filesystem layer, so the fix must cover both paths (cache headers in vercel.json + versioned asset URLs). → Backlog B-02.

### F-04 🟠 MEDIUM — No automated tests, lint, or CI
package.json defines only `start`. All validation so far is ad-hoc boot + manual smoke (effective — it caught F-01's fix regressions — but not repeatable). → Backlog B-03 (repeatable smoke script), Phase 7 uses it.

### F-05 🟡 LOW — No search/filter in list views
public/app.js renders customers (33 rows), registers, ledgers, tasks as plain tables with no client-side search or status filter (grep: no search input exists). At current scale this is a productivity annoyance, not a defect; it grows with data. → Backlog B-04.

### F-06 🟡 LOW — Boot-time schema verification covers only `users`
repairUsersTable() (src/db.js:203+) protects the one table that broke. Other tables rely on `CREATE TABLE IF NOT EXISTS`; a future column addition to an existing table would fail the same silent way F-01 did. A general PRAGMA-based check for all tables is cheap insurance. → Backlog B-05.

### F-07 🟡 LOW — JWT secret fallback is a dev default
src/auth.js uses a built-in default when JWT_SECRET is unset (with a console warning). The agent cannot read the Vercel env to confirm it is set in production. If unset, tokens are forgeable by anyone who reads this (private) repo's code. → Backlog B-06 (owner action: confirm JWT_SECRET is set in Vercel; no code change needed, optionally fail-closed at boot when VERCEL is set).

### F-08 🔎 UNVERIFIED — List endpoints' pagination behavior in the UI
listRegisterRows applies a LIMIT; the UI's loadRegister does not expose paging controls. With 0–10 rows today this is invisible; behavior at hundreds of rows is unverified. → Backlog B-07 (verify + document the limit; add "showing N" caption).

### F-09 🔎 DATA GAP (not code) — Opening data completeness
All 33 customers have empty code/phone (source data never had them); all 10 opening ledger items have empty due_date_shamsi and cheque_sayad_no; product prices are 0 = unrecorded. The UI shows these as empty cells — honest, but aging/due-date intelligence (Phase 5) is limited until management supplies the breakdowns (already requested; 9 open management questions).

### F-10 🔎 UNVERIFIED — Docker path
Dockerfile + docker-compose.yml exist and are YAML-valid; Docker is not installed on the agent VM, so the container path has never been run. Vercel is the exercised deployment.

### F-11 🟡 LOW — Dashboard cash card placement
The «حساب‌های بانکی» card renders below the charts and «دفاتر باز» section (public/app.js loadDashboard appends it last). For a product whose #1 job is cash visibility, the cash total deserves to sit with the KPI grid. → Backlog B-08 (move the section above the charts; small, safe template reorder).

## Phase 1 receipt
- Status: complete. 11 findings (1 fixed-critical, 1 high, 2 medium, 4 low, 3 unverified/data).
- Files changed: this artifact only.
- Next: Phase 2 backlog with acceptance criteria per finding.
