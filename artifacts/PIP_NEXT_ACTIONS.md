# PIP — Next Actions (Phase 8)

Date: 2026-11-24

## Owner actions (in order)
1. **Approve the GitHub push** — say «پوش کن»; a fresh approval card appears
   and one tap deploys the whole validated mission batch to Vercel.
   Afterwards Pip verifies live: cache headers, fake-login 401, analytics
   aging/review fields, dashboard order.
2. **Confirm JWT_SECRET in Vercel env** (B-06) — farzam-erp project →
   Settings → Environment Variables. If it exists, a fail-closed code
   change becomes safe to ship later; if it does not, set it first.
3. **Data asks (sent 2026-11-24 19:15, still open)** — due-date breakdowns
   for aggregate receivables 6,474,219,000 Rial, aggregate trade payables
   9,365,585,105 Rial, prepayments 3,129,836,610 Rial; sale price + cost
   for the 4 products. These unblock meaningful aging and the first
   collection report's action list (Sat 2026-11-28).

## Deferred engineering (small, safe, not shipped)
- B-07 captions: "showing N of M" in list views (matters near the 500-row
  caps; volumes are far below today).
- B-10 third signal: single-party concentration (top party's share of
  open receivables) in the review block + monitoring tab.
- Confirm production persistence (Turso env) — same Vercel settings visit
  as B-06; the weekly backup cron covers the gap meanwhile.

## Standing watch items
- Telegram connector still returns instant 404s (platform fault; feedback
  draft prepared earlier, awaiting the owner's send decision — separate
  from this mission).
- First weekly collection report: Sat 2026-11-28 ~09:00; first monthly
  close: 2026-12-10.
