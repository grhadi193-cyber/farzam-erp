# PIP STATE — Farzam Financial Intelligence

Compact mission state. Updated at the end of every phase. Last update: 2026-11-24 23:05 Asia/Tehran (Phases 0–7 complete locally; deployment blocked on push approval).

## Mission

Autonomous product execution on the EXISTING Farzam ERP (no rebuild, no new connectors, no new database, no Telegram work). Repo: `grhadi193-cyber/farzam-erp` (private), live: https://farzam-erp.vercel.app. Local source: `~/workspace/farzam-erp-server/`.

## Verified production state (read live 2026-11-24 22:28 via agent API)

- Cash: 4 bank accounts, total 4,660,690,186 Rial (1405 opening balances).
- Customers 33 (all with national IDs), products 4, ledger items 10 (receivables 10,507,021,057 / payables 19,643,038,027 Rial, all status «باز»).
- Registers: expenses 1 row (B-01 backfill of the Sheets record, flagged «مشکوک - رسید تکراری», excluded from confirmed spend — duplicate_expenses_rial 30,000,000, confirmed spend 0); income/payroll 0. Sheets and server now agree; the hourly cron mirrors every new registration to the server in the same run.
- Management questions: 20 total, 11 answered, 9 open.
- Knowledge: 9 entries (5 standing rules + category chart, fixed assets, suppliers, 1405 controls).
- Login: healthy (fixed 2026-11-24, commit b46aa69c — self-healing users-table repair at boot).
- GitHub main head: bc6a1b16 (owner's own web edits to README.md + new main.yml, 2026-11-24 21:40–21:53 Tehran; last Pip sync b46aa69c, no path overlap with the pending push). Sync record: `~/workspace/farzam-erp-server.muse-github-snapshot-sync.json` (10 entries).
- Mission batch: implemented + validated locally (smoke 15/15) and PUSHED 2026-11-24 23:26 in 4 commits (b4a23c19, 3fc52611, 61b0c865, 8cd751f9) after the owner's «پوش کن». Production deployment lagging abnormally: as of 23:59 the live site still serves the pre-push build (no ledger_aging in analytics, old app.js) — a follow-up push retriggers the Vercel deployment; verification continues.

## Surrounding system (outside the repo)

- Intake: Telegram bot @Frzmaccbot writes record folders to Google Drive `Hazine/company-expenses/incoming`; hourly cron classifies and registers into Google Sheets (4 registers) and mirrors to this ERP. Pip's own Telegram connector is broken (platform fault, instant 404) — Drive is the working path; per mission rules, no Telegram work.
- Muse panel «پنل ERP فرزام» mirrors the same data (daily refresh cron).
- Automations live: hourly intake, daily panel refresh, weekly collection report (Sat), monthly obligations (day 1), monthly close (day 10), weekly ERP backup (Fri).

## Phase tracker

| Phase | Status | Receipt |
|---|---|---|
| 0 Bootstrap & inventory | ✅ Done 2026-11-24 | artifacts/PIP_CAPABILITY_MATRIX.md, PIP_ASSUMPTIONS.md, PIP_CHANGELOG.md |
| 1 Existing product audit | ✅ Done 2026-11-24 | artifacts/PIP_EXISTING_SYSTEM_AUDIT.md (11 findings) |
| 2 Improvement backlog | ✅ Done 2026-11-24 | artifacts/PIP_IMPLEMENTATION_BACKLOG.md (B-01…B-10) |
| 3 Code implementation | ✅ Done locally 2026-11-24 · ⛔ push blocked | B-01, B-02, B-03, B-04, B-05, B-08, B-09, B-10 implemented; smoke 15/15; push awaits owner approval (card expired) |
| 4 DB & contract alignment | ✅ Done 2026-11-24 | artifacts/PIP_DATABASE_CHANGES.md — zero schema changes; additive-only API; list caps verified (500) |
| 5 Intelligence layer | ✅ Done 2026-11-24 | B-09 aging + B-10 anomaly signals in analytics/monitoring; scheduled CFO reports mapped, not duplicated |
| 6 UI/UX completion | ✅ Done 2026-11-24 | B-08 cash card first; B-04 list search/filter; browser click-through of the new build pending deploy |
| 7 Validation | ✅ Done 2026-11-24 | artifacts/PIP_VALIDATION_REPORT.md |
| 8 Delivery & operating report | 🟡 Reports written · final delivery held | PIP_EXECUTIVE_REPORT.md, PIP_IMPLEMENTATION_REPORT.md, PIP_NEXT_ACTIONS.md, PIP_WHATSAPP_NOTIFICATIONS.md, whatsapp-outbox.md — completion message goes out after push + live verification |

## Operating constraints (from mission + owner)

- Dev/test environment per owner (2026-11-24): data is test/fabricated; proceed without routine confirmation; pushes to the repo are pre-authorized by the owner.
- Currency: Rial is the storage and official unit (owner's standing rule «کلا ریال»); UI has a Rial/Toman display toggle. See PIP_ASSUMPTIONS.md A-01.
- Never delete financial history; never silently change schema; migrations reversible and logged.
- No secrets in code, commits, messages, or artifacts.
