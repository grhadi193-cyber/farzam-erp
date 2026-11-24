# PIP — Validation Report (Phase 7, incl. Phase 5 & 6 checks)

Date: 2026-11-24 · Scope: mission changes B-01…B-05, B-08, B-09, B-10
Legend: ✅ Passed · 🟡 Partially verified · 🔎 Not tested · ⛔ Blocked

## Passed ✅
- **Smoke suite (`npm test`, scripts/smoke.mjs): 15/15** on a throwaway DB —
  health, fake login → 401, admin login → 200, /api/auth/me, agent analytics
  (questions_total = 20, aging + review blocks present), bank-account create
  201 + listed, aging fixtures (due 1405/01/01 → overdue bucket; no due date
  → no_due_date), agent reset → 200, login after reset → 200.
- **Fresh-DB boot**: zero schema warnings; analytics returns
  today_shamsi ۱۴۰۵/۰۹/۰۳ with zeroed buckets.
- **F-01 regression fixtures** (recreated in /tmp, cleaned up after):
  legacy users table → repaired, legacy rows preserved, fake login 401,
  admin login 200, unrelated data intact; a table missing a column → exactly
  one boot warning naming table + column, /health still 200.
- **Aging determinism spot-checks**: Persian-digit due date ۱۴۰۵/۰۱/۰۱ →
  overdue_90_plus; Latin 1405/12/01 → current. Invalid/unparseable dates are
  never guessed (→ no_due_date).
- **Cache policy (local Express)**: /app.js and /styles.css served with
  `Cache-Control: no-cache, must-revalidate`; images `max-age=86400`;
  index.html references `?v=2` assets.
- **B-01 data agreement**: after backfill, Sheets and server both hold
  exactly the one post-reset record, identically flagged; analytics
  duplicate_expenses_rial = 30,000,000 → confirmed spend 0 in both stores.
  Hourly cron now carries the mirror step (verified by reading the job back).
- **Additive-only contract**: no existing API field changed; docs/agent-api.md
  updated for the new analytics fields.

## Partially verified 🟡
- **Phase 5 — intelligence layer**: B-09 aging and B-10 anomaly signals are
  implemented server-side (deterministic SQL/arithmetic, never LLM-computed)
  and render in the monitoring tab with basis notes. Remaining intelligence
  from the brief (cash-flow summary, collection focus, monthly close,
  obligations) is delivered by the existing scheduled reports (weekly
  collection Sat ~09:00, monthly obligations day 1, monthly close day 10) —
  mapped, not duplicated. First live runs of those reports against real
  1405 data have not happened yet (first collection report: Sat 2026-11-28).
- **Phase 6 — UI/UX**: dashboard cash card moved above the charts (template
  order verified in code); search/filter wired into registers, ledgers,
  customers, products, tasks with Persian/Arabic normalization. Full
  click-through of the NEW build in a browser is pending deployment.

## Not tested 🔎
- Production deployment of the mission batch (new analytics fields live,
  Vercel-served cache headers, new UI) — pending the GitHub push.
- Docker path (no Docker runtime on this VM) — pre-existing limitation L-03.
- B-10's optional third signal (single-party concentration) — not built;
  recorded as a next action, not claimed.

## Blocked ⛔
- **GitHub push of the mission batch**: the platform approval card expired
  unanswered on 2026-11-24 ~22:37 (owner away, per their plan). The push was
  NOT performed and must not be retried until the owner asks. All code is
  complete and validated locally; deploy + live verification follow the push.
- **B-06 (JWT_SECRET)**: owner-only Vercel env check; no code shipped for it
  by design (a fail-closed change could take production down if unset).
