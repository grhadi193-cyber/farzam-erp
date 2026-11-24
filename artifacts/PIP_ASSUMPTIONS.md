# PIP ASSUMPTIONS — recorded decisions where the mission text and the live system differ

## A-01 — Currency default: Rial stays (mission text superseded by owner's standing rule)
The mission (§8) says "Toman as the default currency, Rial when explicitly configured." The owner personally ordered the opposite on 2026-11-24 («کلا ریال» — everything in Rial), converted both registers to Rial, and the production system stores Rial and defaults the display toggle to Rial (public/app.js: `localStorage 'farzam_unit' || 'rial'`). Changing the storage/default to Toman would break financial correctness against the owner's explicit instruction and the already-loaded opening balances.
**Decision:** keep Rial as storage + default; the existing UI toggle already provides Toman display on demand. No code change. If the owner wants the display default flipped to Toman later, it is a one-line change in app.js.

## A-02 — Artifacts location
Mission artifact paths (`artifacts/...`) are interpreted relative to the implementation target, i.e. inside the GitHub repo at `~/workspace/farzam-erp-server/artifacts/`, so they are versioned and pushed with the code.

## A-03 — WhatsApp notifications
"Existing WhatsApp capability" = the owner's connected 1:1 WhatsApp chat, which already receives the finance reports. Mission notifications (schema changes, milestones, blockers) go there and/or to the main chat, and are always mirrored in `artifacts/whatsapp-outbox.md` with timestamp, severity, status, related files and commit, per §5 fallback format.

## A-04 — Production database identity
The agent cannot read the Vercel project's env vars. Evidence (data and a legacy-schema users table surviving several redeploys on 2026-11-24) indicates a persistent remote libsql (Turso) store rather than the ephemeral /tmp fallback. Treated as: persistent, but flagged 🟡 in the capability matrix; weekly backup cron is the mitigation. No schema work depends on resolving this.

## A-05 — Environment is development/test
Per the owner's explicit statement (2026-11-24 21:32), all company data in this environment is test/fabricated and routine work — including GitHub pushes — is pre-authorized without per-action confirmation. Production-affecting caution is still applied to destructive operations (none are planned; the reset endpoint stays confirm-guarded in code).

## A-06 — Panel scope
Two front-ends exist: the Muse panel (a Space, not in this repo) and the server ERP UI (this repo). The mission's "existing panel/dashboard" implementation target is the repo UI; the Muse panel is maintained by its existing daily-refresh automation and is inventoried but not code-edited in this mission.

## Limitations register
- L-01: Pip's Telegram connector is broken at platform level (instant 404); intake flows through Drive instead. Mission forbids Telegram work, so this is documented, not fixed.
- L-02: No automated test suite exists in the repo; validation = local boot + scripted smoke checks (Phase 7 adds a repeatable smoke script as a repo artifact of Phase 3).
- L-03: Docker runtime is unavailable on the agent VM; the Docker path stays documented-but-unverified.
