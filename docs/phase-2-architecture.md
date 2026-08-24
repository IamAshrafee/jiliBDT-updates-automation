# Phase 2 Architecture

Phase 2 intentionally uses one backend process, one Next.js admin, and one SQLite file. There is no Redis, queue server, worker service, organization model, or distributed lock. The hard engineering is concentrated in Google Sheet correctness, workflow transitions, approval binding, Telegram delivery, and recovery.

## Modules

- `packages/domain`: snapshot/completion models, run state machine, template validation, and stable approval hashes.
- `packages/google-sheet`: OAuth and effective-value/format snapshot reading retained from Phase 1.
- `packages/renderer`: deterministic HTML and Playwright PNG artifacts retained from Phase 1.
- `packages/db`: migration-driven SQLite schema and transactional repository.
- `apps/server/src/workflow`: preparation, reminders, rechecks, final approval/revalidation, sending, overrides, and retries.
- `apps/server/src/telegram`: encrypted MTCute user session, fake transport, and grammY administrator bot.
- `apps/server/src/scheduler`: one short polling loop for daily schedules and due run actions.
- `apps/server/src/routes`: authenticated, typed internal HTTP API.
- `apps/admin`: functional one-administrator portal.

## Compact persistent model

Seven tables are used: `system_settings`, `members`, `telegram_destinations`, `update_runs`, `reminder_attempts`, `telegram_deliveries`, `schedules`, plus `run_events` for the detailed audit trail. Operational lists and prepared results use small JSON columns on the run. This avoids premature normalization while retaining foreign keys and unique delivery/run constraints.

SQLite enables WAL, foreign keys, a five-second busy timeout, and transactions around creation, transitions, schedule claims, and delivery idempotency. The application is designed for one process on one VPS.

## Run lifecycle

Manual, bot, scheduled, and API triggers all call the same workflow. A run fetches the Sheet, validates structure, classifies callers, and either creates a reminder draft, waits/rechecks, or renders a final preview. Telegram sends never occur from a schedule alone. Every reminder and final send requires administrator approval followed by source revalidation.

Artifacts remain immutable under `artifacts/<date>/run-<id>/<revision>/`. The authenticated API serves previews by run ID and verifies that the stored path remains inside the configured artifact root.
