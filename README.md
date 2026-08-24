# JiliBDT Updates Automation

Phase 1 proves the critical path for safely preparing a selected Google Sheet update for administrator review. It reads values and effective formatting, validates the report structure, classifies caller submissions, renders an immutable HTML/PNG preview, and stores the run in one local SQLite file.

This phase does **not** send reminders or reports to Telegram.

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

The backend automatically applies SQLite migrations to `DATABASE_URL` during startup. Open `http://127.0.0.1:3000`, enter the configured administrator token, choose a slot, and select **Prepare**.

## Important commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm fixture:render
```

`pnpm db:migrate` remains available for explicit migration checks. The SQLite file, OAuth files, and generated artifacts are ignored by Git.

## Phase 1 safety behavior

- A numeric zero is a submitted value; a blank cell is not.
- Expected headers are located rather than blindly assumed to be on row 3.
- Material structural or unsupported-content findings produce `NEEDS_ATTENTION`.
- A generated preview has a source hash. Revalidation marks it `STALE` if values **or formatting** changed.
- Two rapid Prepare requests for the same date and slot reuse one active run.
- Artifacts are immutable revisions under `artifacts/<date>/run-<id>/...`.
- API logs redact authentication/token-shaped fields and never log OAuth contents.

See [Phase 1 architecture](docs/phase-1-architecture.md), [Google authentication](docs/google-auth.md), [format support](docs/sheet-format-support.md), and [testing](docs/phase-1-testing.md).
