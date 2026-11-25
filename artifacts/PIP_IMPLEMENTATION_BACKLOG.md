# PIP IMPLEMENTATION BACKLOG — Phase 2 (2026-11-24)

Priority order follows the mission: financial correctness → data integrity → productivity → operational value → security → reliability → performance → visual quality. Data column: R = real (test-phase) data, M = mock allowed, — = n/a.

## B-01 🔴 P1 — Mirror hourly registrations into the server ERP (fixes F-02 divergence)
- **Problem:** The hourly intake registers into Google Sheets only; the server ERP stays empty, so the two "ERPs" disagree (observed 2026-11-24: sheet row EXP-1795539744164 exists, server registers = 0).
- **Business impact:** Financial correctness. Anyone reading the server dashboard sees zeros while the register of record has rows; reports must constantly caveat which store they read.
- **Implementation area:** (a) the hourly intake automation (cron `company-expenses-hourly-register` instructions) — after writing a record to Sheets, also send it to the server via the agent API (`add` + `classify`, or register create) with the sheet's EXP id / record folder carried in notes for traceability; (b) one-time backfill of existing sheet rows (currently exactly 1) into the server with the same suspicious status preserved; (c) dedupe rule: a record folder is mirrored exactly once (the cron already tracks registered folders).
- **Dependencies:** agent API `add`/`classify` behavior (exists); cron edit access (exists).
- **Risk:** double-registration in the server if the cron re-runs a folder — mitigated by the existing folder-name dedupe list the cron maintains, plus the server's own duplicate detection on tracking numbers.
- **Acceptance criteria:** a new Drive record appears exactly once in Sheets AND once in the server within one hourly cycle; backfilled row 1 visible in the server with a suspicious/duplicate status and excluded from confirmed expense totals; weekly comparison shows no unexplained divergence.
- **Data:** R.

## B-02 🟠 P2 — Stop stale-UI after deploys (fixes F-03)
- **Problem:** Unversioned `/app.js` + `/styles.css`, no cache headers (server.js:29, public/index.html) → browsers serve the old UI after a deploy (owner hit this 2026-11-24).
- **Business impact:** Reliability/trust — the owner concluded "nothing was added" while the deploy was live.
- **Implementation area:** vercel.json (headers for static assets: `Cache-Control: no-cache, must-revalidate` for /app.js and /styles.css), server.js express.static setHeaders (same policy for the non-Vercel path), and a version query string in index.html asset URLs bumped per release.
- **Dependencies:** none. **Risk:** low; no-store on two small files is negligible at this scale.
- **Acceptance criteria:** after deploy, `curl -I /app.js` shows the no-cache header on the live site; a browser that visited before the deploy shows the new UI on a normal refresh.
- **Data:** —.

## B-03 🟠 P2 — Repeatable smoke test script (fixes F-04)
- **Problem:** No tests/lint/CI (package.json: only `start`); validation is ad-hoc.
- **Business impact:** Reliability — the F-01 login regression class is exactly what a smoke script catches in seconds.
- **Implementation area:** new `scripts/smoke.mjs` (boots the server on a throwaway DB in a temp dir with test ADMIN_* env, asserts: health 200, fake login 401, admin login 200 + token, /api/auth/me 200, agent analytics 200, bank-account create 201 + list contains it, questions seeded = 20, agent reset 200, admin login still 200 after reset) + `npm test` script entry. No production code changes.
- **Dependencies:** none. **Risk:** none to production (temp DB only).
- **Acceptance criteria:** `node scripts/smoke.mjs` exits 0 on current code; deliberately breaking the login route makes it exit non-zero.
- **Data:** M (throwaway local DB, labelled test).

## B-04 🟡 P3 — Search/filter in list views (fixes F-05)
- **Problem:** Customers/registers/ledgers/tasks tables in public/app.js have no search or status filter.
- **Business impact:** Productivity — finding one customer among 33 (later: hundreds) or one record among many is manual scrolling.
- **Implementation area:** public/app.js only — one reusable client-side filter input per list tab, filtering already-fetched rows (no API change).
- **Dependencies:** none. **Risk:** low (pure rendering).
- **Acceptance criteria:** typing in the customers filter narrows rows live; clearing restores all; Persian text matches (including Arabic ي/ك normalization).
- **Data:** R (renders existing data).

## B-05 🟡 P3 — Generalize boot-time schema verification (fixes F-06)
- **Problem:** Only `users` gets a boot schema check (src/db.js repairUsersTable); other tables rely on CREATE TABLE IF NOT EXISTS, the same silent-failure pattern as F-01.
- **Business impact:** Data integrity/reliability insurance for every future column addition.
- **Implementation area:** src/db.js — an expected-columns map for all 13 tables; at boot, PRAGMA-compare and log a loud, specific warning per missing column (auto-repair stays users-only; financial tables get warnings + a recorded follow-up, never silent ALTERs).
- **Dependencies:** none. **Risk:** low (read-only PRAGMA + logging).
- **Acceptance criteria:** booting against a fixture DB missing a column in `expenses` logs the exact table/column and still serves; healthy DB logs nothing; users repair behavior unchanged (existing fixtures pass).
- **Data:** M (fixtures).

## B-06 🔐 P4 — Confirm JWT_SECRET in production (owner action; from F-07)
- **Problem:** src/auth.js falls back to a dev JWT secret if the env var is missing; the agent cannot read Vercel env vars to confirm.
- **Business impact:** Security — if unset, session tokens are forgeable from the (private) source.
- **Implementation area:** owner checks Vercel project env (farzam-erp → Settings → Environment Variables) for JWT_SECRET; only after confirmation, an optional follow-up makes the app fail closed when VERCEL is set without JWT_SECRET.
- **Dependencies:** owner env access. **Risk:** do NOT ship the fail-closed change before confirmation — it would take production down if the var is absent.
- **Acceptance criteria:** owner confirms the variable exists (or sets it and redeploys); recorded in PIP_STATE.
- **Data:** —.

## B-07 🔎 P4 — Verify and caption list limits (from F-08)
- **Problem:** Register list queries apply a LIMIT; the UI shows no count caption, so truncation would be invisible.
- **Implementation area:** src/db.js listRegisterRows (read the current default), public/app.js list headers («نمایش N رکورد»).
- **Acceptance criteria:** the effective limit is documented in docs/agent-api.md; each list tab shows how many rows are displayed.
- **Data:** R.

## B-08 🟡 P3 — Cash card above the fold (fixes F-11)
- **Problem:** The bank-accounts/cash section renders at the bottom of the dashboard (public/app.js loadDashboard), below charts — against the product's #1 job, cash visibility.
- **Implementation area:** public/app.js loadDashboard template order only.
- **Acceptance criteria:** dashboard shows «حساب‌های بانکی» (with the cash total) immediately after the KPI grid, before «مقایسه جریان مالی».
- **Data:** R.

## B-09 🟠 P2 — Receivables/payables aging + due-date intelligence (Phase 5 core)
- **Problem:** analyticsSummary returns open totals only; no aging, no overdue flags. Opening ledger rows have no due dates yet (F-09), so the feature must degrade honestly.
- **Implementation area:** src/db.js analyticsSummary — add `ledger_aging`: for items with a parseable Jalali due_date_shamsi, bucket open items (current / 1–30 / 31–90 / 90+ days overdue) using a deterministic Jalali→day-number conversion in code (no LLM math); items without due dates counted separately as `no_due_date`. Surface the summary line on the monitoring tab.
- **Dependencies:** Jalali date conversion utility (small, testable). **Risk:** date-format variance in free-text due dates — unparseable dates fall into `no_due_date`, never guessed.
- **Acceptance criteria:** with a fixture ledger containing known due dates, buckets match hand-computed values; with production data (no due dates), the API reports all 10 items as no_due_date and the UI says so plainly.
- **Data:** R + M fixtures.

## B-10 🟠 P2 — Server-side anomaly signals in analytics (Phase 5)
- **Problem:** Duplicate/no-receipt/attention signals are computed client-side in the monitoring tab only; agent-API consumers (reports, the agent) re-derive them inconsistently.
- **Implementation area:** src/db.js analyticsSummary — extend the existing `review` block (it already computes duplicate_expenses_rial, expenses_without_receipt, attention_count) with: reused tracking numbers across registers, zero-amount rows with receipts, and single-party concentration of open receivables (top party share %). Deterministic SQL/JS only.
- **Acceptance criteria:** analytics response includes the new fields; the 20:32 test pattern (same tracking number reused) would surface as reused_tracking ≥ 1 when mirrored per B-01; monitoring tab renders the server values.
- **Data:** R.

## Phase 2 receipt
- Status: complete. 10 items: P1 ×1 (B-01), P2 ×4 (B-02, B-03, B-09, B-10), P3 ×3 (B-04, B-05, B-08), P4 ×2 (B-06 owner action, B-07).
- Execution order in Phase 3: B-02 + B-08 + B-04 (UI batch) → B-03 (smoke) → B-05 (schema check) → B-09 + B-10 (intelligence, doubles as Phase 5 core) → B-01 (automation mirror + backfill) → B-07 captions if trivially bundled.
