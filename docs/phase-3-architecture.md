# Phase 3 Operational Hardening

Phase 3 preserves the Phase 2 architecture: one Fastify backend process owns workflow logic, SQLite, the scheduler, Telegram clients, maintenance, and recovery. The existing Next.js portal remains intentionally simple.

## Safety additions

- SQLite remains WAL-backed with foreign keys and a busy timeout.
- Online backup writes a temporary backup through SQLite, validates integrity, then atomically publishes it.
- Startup converts interrupted Telegram `SENDING` deliveries to `UNKNOWN` and blocks automatic resend.
- `automation_enabled` pauses scheduled creation/rechecks without deleting state.
- `telegram_sending_enabled` blocks all reminder/final external sends while preparation remains available.
- Disk health has warning and critical thresholds. Critical state blocks new artifacts and sends.
- Health aggregates database integrity, Google, Telegram account, bot, scheduler, disk, backup, server time, and kill switches without secrets.
- SIGINT/SIGTERM stop scheduler/maintenance and Telegram clients, drain workflow work, close HTTP, then close SQLite.

## Renderer support and browser fallback

Warnings are assessed as `SUPPORTED`, `SUPPORTED_WITH_WARNINGS`, `BROWSER_FALLBACK_RECOMMENDED`, or `BLOCKED`. Charts, slicers, and `IMAGE()` formulas recommend browser capture; structural/member problems remain blocked. Browser capture is administrator-triggered, uses a persistent Playwright profile, creates a new immutable artifact, and returns to `READY_FOR_REVIEW`. It never sends automatically or bypasses fresh Google revalidation.

Google does not expose every drawing/over-grid image reliably through the current Sheets grid response. When content cannot be confidently detected, the operator must use the visual checklist; this limitation is not hidden by automatic fallback.

## Daily maintenance

The in-process maintenance scheduler checks once per minute and performs one backup per configured Bangladesh-local day after `BACKUP_LOCAL_TIME`. It also removes expired backups and invokes the existing active-run-safe artifact retention service. Manual commands remain available for integrity checks, backup, restore drill, and artifact cleanup.
