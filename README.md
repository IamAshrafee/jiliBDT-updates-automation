# JiliBDT Updates Automation

Phase 3 keeps the deliberately simple Phase 2 architecture and hardens it for operations. Its backend reads and validates the Google Sheet, detects missing callers, prepares administrator-approved Telegram reminders, rechecks persistently, renders a final immutable report, invalidates stale approvals, and sends only after fresh Sheet revalidation. State and audit history live in one local SQLite file, with online backup, integrity checking, disk safety, kill switches, graceful shutdown, and ambiguous-send recovery.

## Requirements

- Node.js 24 LTS
- pnpm 11
- Google OAuth desktop credentials with access to the target Sheet

Docker and an external database are not required.

## Windows double-click start

Double-click **`Start JiliBDT.cmd`** in the project folder. On the first run it creates and opens `.env` for configuration. After configuration, the same launcher installs anything missing, starts the backend and administrator interface, waits until both are ready, and opens `http://127.0.0.1:3000`.

Keep the **JiliBDT Backend** and **JiliBDT Admin** windows open while using the application. Close those two windows to stop it.

## Quick start

1. Install dependencies:

   ```powershell
   pnpm install
   pnpm playwright:install
   ```

2. Copy `.env.example` to `.env` and configure the Sheet ID, worksheet title, bounded slot ranges, local paths, and a long administrator token.

3. Put the downloaded OAuth client file at the configured `GOOGLE_OAUTH_CREDENTIALS_PATH`. Never commit it.

4. Generate the local refresh token:

   ```powershell
   pnpm google:auth
   ```

5. Start the backend and admin in separate terminals:

   ```powershell
   pnpm dev:server
   pnpm dev:admin
   ```

The backend automatically applies SQLite migrations to `DATABASE_URL` during startup. Open `http://127.0.0.1:3000`, sign in with `ADMIN_USERNAME` and the password represented by `ADMIN_PASSWORD_HASH` (the legacy token remains a local fallback), then choose a slot and select **Prepare**.

Telegram is optional at startup. Configure one user account with `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_SESSION_ENCRYPTION_KEY`, then complete the phone/code/2FA flow in Settings. Configure the administrator bot separately with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_IDS`.

## Important commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm fixture:render
pnpm artifacts:cleanup
pnpm db:check
pnpm db:backup
pnpm db:restore-drill
```

`pnpm db:migrate` remains available for explicit migration checks. The SQLite file, OAuth files, and generated artifacts are ignored by Git.

## Core safety behavior

- A numeric zero is a submitted value; a blank cell is not.
- Expected headers are located rather than blindly assumed to be on row 3.
- Material structural or unsupported-content findings produce `NEEDS_ATTENTION`.
- A generated preview has a source hash. Revalidation marks it `STALE` if values **or formatting** changed.
- Two rapid Prepare requests for the same date and slot reuse one active run.
- Artifacts are immutable revisions under `artifacts/<date>/run-<id>/...`.
- API logs redact authentication/token-shaped fields and never log OAuth contents.
- Reminder approval binds the exact caller targets and edited message; a fresh fetch invalidates it when targets changed.
- Final approval binds the source snapshot, PNG, caption, and destinations; it always re-fetches before sending.
- SQLite-backed delivery keys prevent duplicate sends, including partial multi-destination retries.
- Scheduled and delayed actions are persisted and leased from SQLite, so restart recovery does not depend on timers.
- Interrupted Telegram sends become `UNKNOWN` on restart and are never blindly resent.
- Automation and Telegram sending have independent persistent emergency switches.
- Daily SQLite backups use the online backup API and are verified before publication.
- Critical disk state blocks new artifacts and external sends.

See [Phase 3 hardening](docs/phase-3-architecture.md), [Phase 3 acceptance](docs/phase-3-testing.md), [VPS deployment](docs/vps-deployment.md), [recovery](docs/recovery.md), [operator checklist](docs/operator-checklist.md), [run states](docs/run-state-machine.md), and [approval safety](docs/approval-and-idempotency.md).
