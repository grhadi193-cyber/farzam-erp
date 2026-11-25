# Pip Agent API — as implemented

Base URL: `<server>/api/agent`
Auth: `Authorization: Bearer <PIP_AGENT_API_KEY>` (static key from `.env`, separate from user JWT logins)
Identity: service actor `pip-agent` (not a human user)

Every agent **write** inserts a row into `audit_log` with actor `pip-agent`, the action, the entity table and the row id. Reads are not logged. The admin can revoke access at any time by changing `PIP_AGENT_API_KEY` and restarting the app.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/agent/events/incoming` | Unprocessed intake events (oldest first), payload parsed |
| POST | `/api/agent/events/:id/classify` | Body: `{ "event_type": "expense" \| "income" \| "payroll" \| "unclear", ...register fields }`. Creates the matching register row and marks the event `registered`; `unclear` marks it `needs_review` and creates no row |
| GET | `/api/agent/registers/expenses` | List expense rows |
| POST | `/api/agent/registers/expenses` | Create an expense row (audited) |
| GET | `/api/agent/registers/income` | List income rows |
| POST | `/api/agent/registers/income` | Create an income row (audited) |
| GET | `/api/agent/registers/payroll` | List payroll rows |
| POST | `/api/agent/registers/payroll` | Create a payroll row (audited) |
| GET | `/api/agent/ledgers` | List receivable / payable / cheque items |
| POST | `/api/agent/ledgers` | Create a ledger item (audited) |
| GET | `/api/agent/knowledge` | List knowledge entries |
| POST | `/api/agent/knowledge` | Create a knowledge entry (audited) |
| GET | `/api/agent/customers` | List customers (master data) |
| POST | `/api/agent/customers` | Create a customer (audited). Body: `{ "name", "code", "national_id", "phone", "notes" }`; `name` is required, returns 201 with the row |
| GET | `/api/agent/products` | List products (master data) |
| POST | `/api/agent/products` | Create a product (audited). Body: `{ "name", "code", "unit", "sale_price_rial", "notes" }`; `name` is required, `sale_price_rial` is integer Rial, returns 201 with the row |
| GET | `/api/agent/tasks` | List staff tasks |
| POST | `/api/agent/tasks` | Create a task (audited). Body: `{ "title", "assignee", "deadline", "details", "status" }`; `title` is required, `status` must be one of در انتظار انجام / در حال انجام / انجام شد / نیازمند بررسی |
| PATCH | `/api/agent/tasks/:id` | Update a task's `status` / `report` (or title/assignee/deadline/details), audited |
| GET | `/api/agent/bank-accounts` | List bank accounts (name, bank, branch, IBAN, account number, opening balance) |
| POST | `/api/agent/bank-accounts` | Create a bank account (audited). Body: `{ "name", "bank", "branch", "iban", "account_no", "balance_rial", "notes" }`; `name` is required, `balance_rial` is the integer Rial opening balance at creation, returns 201 with the row |
| GET | `/api/agent/questions` | List the management questions (group, question, answer, status) |
| POST | `/api/agent/questions/:id/answer` | Record management's answer (audited). Body: `{ "answer": "..." }`; sets the answer and marks the question «پاسخ داده شد», returns the updated row; 404 for an unknown id, 400 for an empty answer |
| GET | `/api/agent/analytics/summary` | Totals per register (Rial), net, counts (incl. customers without national ID, open/total questions), unclear count, expenses by category, open ledgers, `cash` (bank-account count and the sum of their opening balances), `review` anomaly signals, and `ledger_aging` due-date buckets (see below) |
| GET | `/api/agent/audit` | Latest audit-log rows |

## Analytics additions: `review` and `ledger_aging`

The summary response also carries two additive blocks (all pre-existing fields are unchanged):

`review` — server-side anomaly signals, computed with the same definitions the panel uses:

- `duplicate_expenses_rial` — sum of expense rows whose review status marks them as duplicates («تکراری»)
- `expenses_without_receipt` — count of expense rows with `receipt_status` = ندارد
- `attention_count` — register rows across all three registers whose `review_status` is not «تأیید شده»
- `reused_tracking_numbers` — count of distinct non-empty `tracking_no` values that appear on more than one row across the three registers (the reused-receipt signature)
- `zero_amount_with_receipt` — count of rows with `amount_rial` = 0 and `receipt_status` = دارد across the three registers

`ledger_aging` — open ledger items (status «باز») bucketed by their Jalali `due_date_shamsi` against today in Asia/Tehran:

- `today_shamsi` — today's Jalali date (Persian digits), the basis of the calculation
- `buckets` — `{ no_due_date, current, overdue_1_30, overdue_31_90, overdue_90_plus }`, each `{ count, total_rial }`. `current` = due today or later; the overdue buckets are 1–30, 31–90, and 90+ days past due
- `by_kind` — the same five buckets split by `receivable` / `payable` / `cheque`

Due dates are parsed deterministically in code (Latin, Persian, or Arabic digits; `/` or `-` separators). A missing or unparseable due date is counted in `no_due_date` — it is never guessed into a dated bucket.

## Register row fields

Common: `date_shamsi`, `time_ir`, `person`, `telegram_ref`, `description`, `amount_rial` (integer, Rial), `payment_method`, `tracking_no`, `receipt_date_time`, `receipt_status` (دارد/ندارد), `review_status`, `record_folder`, `notes`, `receipt_image`.
Expenses add `category`; income adds `account_dest`; payroll adds `basis`.

## Ledger item fields

`kind` (required, one of `receivable` = دریافتنی, `payable` = پرداختنی, `cheque` = چک), `party`, `description`, `amount_rial` (integer, Rial), `due_date_shamsi`, `status` (defaults to «باز»), `cheque_sayad_no` (Sayad number, for cheques).

## Bank account fields

`name` (required), `bank`, `branch`, `iban`, `account_no`, `balance_rial` (integer, Rial — the opening balance recorded when the account is created; it is a maintained snapshot, not a live bank feed), `notes`.

`receipt_image` is the receipt photo stored with the record as a data URL. When present it must be a string starting with `data:image/` and at most 2,000,000 characters, otherwise the write is rejected with HTTP 400. A row created with a `receipt_image` defaults `receipt_status` to دارد when the caller does not set it. Intake events carry the same field (top level or inside `payload`); classifying such an event copies the image into the created register row, and the event keeps its own copy.

## Example

```bash
curl -H "Authorization: Bearer $PIP_AGENT_API_KEY" \
  https://erp.example.com/api/agent/events/incoming

curl -X POST -H "Authorization: Bearer $PIP_AGENT_API_KEY" -H "Content-Type: application/json" \
  -d '{"event_type":"expense","amount_rial":2500000,"description":"خرید اقلام اداری","category":"خرید"}' \
  https://erp.example.com/api/agent/events/12/classify
```

## Notes

- Amounts are integer Rial. Non-numeric or negative amounts are rejected with HTTP 400.
- Classifying an already-registered event returns HTTP 409.
- If `PIP_AGENT_API_KEY` is not set on the server, all agent endpoints return HTTP 503.
