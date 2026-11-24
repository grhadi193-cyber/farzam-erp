# PIP — Database Changes & Contract Alignment (Phase 4)

Date: 2026-11-24 · Mission: Farzam Financial Intelligence — autonomous product execution

## Schema changes in this mission: NONE

- No migration was needed, prepared, or applied. No table was created, altered,
  renamed, or dropped by this mission. No financial data was deleted or reset.
- The only schema-related code added is **read-only**: `verifySchema()` in
  `src/db.js` (B-05) compares all 13 tables against `EXPECTED_COLUMNS` via
  `PRAGMA table_info` at boot and logs a loud `console.warn` per missing
  column. It never alters a table. Auto-repair remains limited to the
  pre-existing `repairUsersTable()` (commit b46aa69c, before this mission).
- Because there is no schema change, the brief's WhatsApp schema-change
  notification does not apply. This file is the record.

## Schema inventory (verified from src/db.js, 13 tables)
users, events, expenses, income, payroll, ledger_items, customers, products,
bank_accounts, knowledge_entries, tasks, questions, audit_log.

## API / contract alignment (UI ↔ API ↔ DB)
- All mission changes to the API are **additive**: `analyticsSummary` gained
  `ledger_aging` and a `review` block (see docs/agent-api.md). No existing
  field was renamed, removed, or changed in meaning. No endpoint changed.
- Register create bodies, agent API auth, the Telegram webhook stub, and the
  reset endpoint's `{"confirm":"RESET"}` guard are untouched.
- UI consumes the new analytics fields only in the monitoring tab; all other
  tabs use pre-existing endpoints unchanged.

## B-07 — list limits (verified in code, 2026-11-24)
- Every list endpoint caps at **500 rows** (registers via
  `listRegisterRows(kind, limit = 500)`; events, ledger_items, customers,
  products, knowledge_entries, tasks, questions likewise; audit_log 200).
- Current production volumes (33 customers, 10 ledger items, 1 expense row)
  are far below the cap: **nothing is truncated today**. The cap becomes a
  silent-truncation risk only beyond 500 rows in one list.
- Deferred micro-item (recorded in PIP_NEXT_ACTIONS.md): "showing N of M"
  captions in list views. Not shipped in this mission; it matters only as
  volumes approach the cap.

## Data-state notes (production, verified 2026-11-24 22:28 + B-01 backfill)
- Opening 1405 state intact: 4 bank accounts / cash 4,660,690,186 Rial,
  33 customers, 4 products, 10 open ledger items (AR 10,507,021,057 /
  AP 19,643,038,027 Rial), 20 questions (11 answered / 9 open).
- B-01 backfill added exactly one row: server expenses id 1 (mirror of Sheets
  row EXP-1795539744164, flagged duplicate; confirmed spend remains 0).
- Persistence (A-04) remains *unconfirmed*: data has survived several
  redeploys, but no Turso env confirmation exists. Weekly backup cron is the
  mitigation; confirming TURSO_* in Vercel remains an owner-side check.
