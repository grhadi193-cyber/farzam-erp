# PIP — Implementation Report (Phase 8)

Date: 2026-11-24 · Repo: grhadi193-cyber/farzam-erp (local: ~/workspace/farzam-erp-server)

## Changes by backlog item

| Item | Files | Summary |
|---|---|---|
| B-01 | (automation + data, no repo code) | Backfill of Sheets row EXP-1795539744164 → server expenses id 1; hourly cron gained a SERVER MIRROR step (same-run, once per folder, failures reported). |
| B-02 | vercel.json, server.js, public/index.html | `Cache-Control: no-cache, must-revalidate` for /app.js + /styles.css (Vercel headers + express.static setHeaders); images max-age=86400; assets referenced as ?v=2. |
| B-03 | scripts/smoke.mjs (new), package.json | 15-check smoke suite on a throwaway DB; `npm test`. |
| B-04 | public/app.js, public/styles.css | `normFa()` + list filter wired into registers, ledgers, customers, products, tasks; client-side only. |
| B-05 | src/db.js | `EXPECTED_COLUMNS` for 13 tables + read-only `verifySchema()` at boot; warn-only, never alters. |
| B-08 | public/app.js | Bank-accounts card moved directly under the KPI grid in loadDashboard. |
| B-09 | src/db.js, public/app.js, docs/agent-api.md | Deterministic Jalali helpers + `ledger_aging` in analyticsSummary (open items, by kind); monitoring tab renders the aging card with basis note. |
| B-10 | src/db.js, public/app.js, docs/agent-api.md | Server-side `review` block: duplicate_expenses_rial, expenses_without_receipt, attention_count, **reused_tracking_numbers**, **zero_amount_with_receipt**; monitoring tab renders signals + alerts. |
| — | artifacts/*.md | Mission state, capability matrix, assumptions, changelog, audit, backlog, DB changes, validation, reports. |

## Not implemented (by design / scope)
- B-06 JWT_SECRET fail-closed change — owner env confirmation first.
- B-07 "showing N of M" captions — verified the 500-row caps instead;
  captions deferred (see PIP_DATABASE_CHANGES.md).
- B-10 optional concentration signal — deferred to PIP_NEXT_ACTIONS.md.

## Phase mapping
- Phase 3: B-01, B-02, B-03, B-04, B-05, B-08, B-09, B-10 (above).
- Phase 4: contract alignment verified additive-only; list limits verified;
  zero schema changes (PIP_DATABASE_CHANGES.md).
- Phase 5: intelligence = B-09 + B-10 in-product, plus the pre-existing
  scheduled reports (weekly collection, monthly obligations, monthly
  close) mapped as the CFO-insight cadence; all figures computed by
  deterministic code/SQL — the LLM only classifies, explains, recommends.
- Phase 6: B-04 + B-08 in-product; RTL/Jalali/Rial conventions unchanged
  and respected by all new UI text.
- Phase 7: PIP_VALIDATION_REPORT.md.
- Phase 8: this report set + PIP_STATE.md update.

## Deployment status
Implemented + validated locally; **push pending owner approval** (platform
card expired 2026-11-24 ~22:37). Paths prepared for the push: public/app.js,
public/styles.css, public/index.html, server.js, src/db.js, vercel.json,
package.json, docs/agent-api.md, scripts/smoke.mjs, artifacts/*.md (15
paths, 22 with the Phase 4–8 artifacts). Note: remote main advanced after
the last sync (owner's own web edits to README.md + a new main.yml at
21:40–21:53 Tehran) — no overlap with the push path set, so no
reconciliation is needed.
