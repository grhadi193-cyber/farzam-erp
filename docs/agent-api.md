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
| GET | `/api/agent/analytics/summary` | Totals per register (Rial), net, counts, unclear count, expenses by category, open ledgers |
| GET | `/api/agent/audit` | Latest audit-log rows |

## Register row fields

Common: `date_shamsi`, `time_ir`, `person`, `telegram_ref`, `description`, `amount_rial` (integer, Rial), `payment_method`, `tracking_no`, `receipt_date_time`, `receipt_status` (دارد/ندارد), `review_status`, `record_folder`, `notes`.
Expenses add `category`; income adds `account_dest`; payroll adds `basis`.

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
