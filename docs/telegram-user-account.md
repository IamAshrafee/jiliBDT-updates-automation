# Telegram User Account

The team-leader account uses MTCute in the backend process. Configure `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and a unique `TELEGRAM_SESSION_ENCRYPTION_KEY` of at least 32 characters. The UI supports phone number, login code, and Telegram 2FA password steps.

The login code and 2FA password exist only in the request and in-memory authentication call; they are never persisted. After login, the exported session is encrypted with AES-256-GCM and written to `TELEGRAM_SESSION_PATH` (normally `data/telegram.session.enc`). The path and all session material are ignored by Git. Disconnect removes the local session and logs out the client.

Health distinguishes connected, authentication required, expired/disconnected, FloodWait, permission, and general errors without exposing credentials. Dialog discovery returns IDs/titles/types for administrator destination setup. One account is supported by design.

Telegram message sends use configured group/channel IDs and optional forum topic IDs. Network ambiguity is stored as `UNKNOWN` and is not automatically resent. Definite failed or rate-limited deliveries remain reviewable.
