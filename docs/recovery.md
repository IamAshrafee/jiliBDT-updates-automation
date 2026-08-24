# Recovery Guide

Use the dashboard emergency controls first when behavior is uncertain: **Pause Automation** and **Disable Telegram Sending**. These controls preserve runs, history, previews, and manual inspection.

## Backend will not start

1. `sudo systemctl status jilibdt-updates`
2. `sudo journalctl -u jilibdt-updates -n 200 --no-pager`
3. Confirm `/opt/jilibdt-updates/secrets/app.env` exists and is readable only by `jilibdt`.
4. From `/opt/jilibdt-updates/app`, run `sudo -u jilibdt pnpm db:check`.
5. Do not repeatedly restart if database integrity fails.

## Google OAuth expired

Pause automation. On a trusted machine with the OAuth desktop credential, run `pnpm google:auth`, copy the resulting token to the configured protected VPS path, set ownership to `jilibdt:jilibdt` and mode `600`, restart the backend, then check `/health` and `pnpm sheet:smoke`.

## Telegram logged out

Disable Telegram sending. Reconnect from the administrator Telegram screen. The code and optional 2FA password are used only for the live login request; the password is not stored. Confirm the encrypted session reconnects after `sudo systemctl restart jilibdt-updates` before enabling sends.

## Telegram FloodWait

Do not retry early or bypass the restriction. Leave sending disabled if needed, inspect the run delivery state, and wait until Telegram's recorded retry time. An uncertain send stays `UNKNOWN` and requires reconciliation.

## SQLite database problem

Stop both services. Run `pnpm db:check`. Never delete WAL files or run automatic repair. Preserve the database and logs, then restore the latest verified backup to a separate path first.

## Restore database backup

1. `sudo systemctl stop jilibdt-admin jilibdt-updates`
2. Copy the current database, WAL, and SHM files to a protected incident directory.
3. Run `pnpm db:restore-drill` to verify the backup mechanism.
4. Copy the chosen backup to a new file, set `DATABASE_URL` to that file, then run `pnpm db:check` and `pnpm db:smoke`.
5. Start the backend, inspect history and unfinished runs, then start the admin portal.

Do not overwrite the only live database copy during diagnosis.

## Disk full

Pause automation and disable Telegram sending. Use `df -h`, then run `pnpm artifacts:cleanup`. Remove only eligible generated artifacts or expired backups. Never delete active run artifacts, the database, OAuth files, or Telegram session.

## Screenshot generation failing

Run `pnpm fixture:render`. Confirm Playwright dependencies and Chromium are installed. The normal HTML renderer remains preferred. Browser fallback is explicit, requires a logged-in persistent Google profile, and never bypasses preview approval.

## Wrong Sheet structure

Do not auto-fix the Sheet. Compare configured title/ranges and expected headers, restore the source structure, then Recheck. A renamed caller is discovered as a new unmapped member and must be reconciled manually.

## Wrong Telegram destination

Disable Telegram sending immediately. Disable the destination record, inspect delivery message IDs, correct the stable chat/topic IDs using a safe test group, then require a fresh preview and approval.

## Disable automation immediately

Use **Settings → Pause Automation** and **Disable Telegram Sending**. If the portal is unavailable, stop the backend with `sudo systemctl stop jilibdt-updates`; SQLite retains workflow state.
