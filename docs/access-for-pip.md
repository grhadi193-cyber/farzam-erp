# How Pip gets access after deployment

The agent never uses the web UI and never needs the admin password or SSH root access. Access is a single scoped API key:

1. Whoever deploys the server sets a long random `PIP_AGENT_API_KEY` in the server's `.env` (see `.env.example`) and starts the app (`docker compose up -d`).
2. The key is handed to Muse through Muse's **secure connection flow** — never in chat, never in a committed file. The value lives only in the server `.env` and in Muse's secure credential storage.
3. Pip then calls the Agent API (see [agent-api.md](agent-api.md)) with the header `Authorization: Bearer <key>`:
   - reads new intake events (`GET /api/agent/events/incoming`),
   - classifies them and writes the matching register rows,
   - reads analytics for reports,
   - saves confirmed rules/answers into the knowledge base.
4. Every agent write is recorded in the `audit_log` table (actor `pip-agent`), visible via `GET /api/agent/audit`, so the company can see exactly what the agent changed.
5. To revoke access: change `PIP_AGENT_API_KEY` in `.env` and restart the app. No other credential is affected.

## What the key can and cannot do

- Can: intake classification, register/ledger/knowledge reads and writes, analytics reads — the finance workflows only.
- Cannot: manage users, change passwords, read password hashes, or access the server itself (no shell, no database file access).
- User accounts and roles (admin / finance / employee / viewer) are a separate system based on JWT logins; the agent key does not bypass them for human actions.
