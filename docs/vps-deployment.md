# Ubuntu VPS Deployment

The project commands are validated locally. The systemd/Caddy files are deployment templates and were not executed on an Ubuntu VPS in this phase because no target host was supplied. Live VPS, DNS, certificate, Telegram, and reboot acceptance must be completed before production is declared ready.

## Layout and account

```text
/opt/jilibdt-updates/
  app/
  data/
  artifacts/
  backups/
  logs/
  secrets/app.env
```

Create a dedicated non-root `jilibdt` user. Directories containing data or secrets should be owned by `jilibdt:jilibdt`; use mode `700` for `data`, `backups`, and `secrets`, and `600` for `app.env`, OAuth files, tokens, and encrypted sessions.

## Packages and application

Install Git, Caddy, Node.js 24 LTS, and pnpm 11. Clone/copy the repository to `app`, then:

```bash
cd /opt/jilibdt-updates/app
pnpm install --frozen-lockfile
pnpm --filter @jilibdt/renderer exec playwright install --with-deps chromium
set -a
source /opt/jilibdt-updates/secrets/app.env
set +a
pnpm build
pnpm db:migrate
pnpm db:check
pnpm fixture:render
```

The renderer embeds Lexend font files and does not depend on Google Fonts at runtime.

## Production environment

Copy `.env.example` to `/opt/jilibdt-updates/secrets/app.env` and replace every placeholder. Use absolute paths under `/opt/jilibdt-updates`. Required production settings include:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4100
ADMIN_UI_ORIGIN=https://updates.example.com
NEXT_PUBLIC_API_URL=https://updates.example.com
DATABASE_URL=/opt/jilibdt-updates/data/app.db
ARTIFACTS_DIR=/opt/jilibdt-updates/artifacts
BACKUPS_DIR=/opt/jilibdt-updates/backups
GOOGLE_OAUTH_CREDENTIALS_PATH=/opt/jilibdt-updates/secrets/credentials.json
GOOGLE_OAUTH_TOKEN_PATH=/opt/jilibdt-updates/secrets/token.json
TELEGRAM_SESSION_PATH=/opt/jilibdt-updates/data/telegram.session.enc
BROWSER_CAPTURE_PROFILE_DIR=/opt/jilibdt-updates/data/browser-profile
```

Generate the password hash with `pnpm admin:password -- "a strong unique password"`. Generate long independent session and Telegram encryption secrets. Do not put secrets in `NEXT_PUBLIC_*` variables.

## Google and Telegram

Generate Google OAuth authorization on a trusted interactive machine with `pnpm google:auth`, then securely install the credential/token files. Connect Telegram first against a private test destination. Never use the production group for login or development tests.

## systemd

Copy the two units from `deploy/` to `/etc/systemd/system/`, confirm the pnpm path using `command -v pnpm`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jilibdt-updates jilibdt-admin
sudo systemctl status jilibdt-updates jilibdt-admin
sudo journalctl -u jilibdt-updates -f
```

The backend is still one process containing HTTP, workflow, scheduler, Telegram account, bot, backup, and recovery logic. The simple Next.js portal is its own presentation process.

## Caddy

Replace the domain in `deploy/Caddyfile.example`, install it as `/etc/caddy/Caddyfile`, validate, and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy terminates HTTPS and routes `/api/*` and `/health` to Fastify; all other traffic goes to the local admin portal. Firewall access may optionally be restricted, but mobile access requirements should be considered.

## Acceptance

Verify login, `/health`, all three real Sheet slots, SQLite/artifact/backup write access, Telegram reconnect, bot commands, and a safe text/photo destination. Generate a real report PNG on the VPS and compare dimensions, colors, merges, row/column sizing, and readability with local output.

Finally perform a controlled reboot. Confirm both systemd services return, Telegram reconnects, scheduler resumes, the same unfinished run remains, and no reminder/report is duplicated. Do not contact the production group until all safe-provider tests pass and the administrator explicitly confirms one controlled production test.
