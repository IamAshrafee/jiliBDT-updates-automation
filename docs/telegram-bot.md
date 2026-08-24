# Administrator Telegram Bot

The optional grammY bot is a secondary control surface, not a second dashboard. Configure `TELEGRAM_BOT_TOKEN` and the comma-separated numeric `TELEGRAM_ADMIN_IDS` allow-list.

The bot supports `/status`, `/prepare1`, `/prepare2`, `/prepare3`, and inline Prepare, Recheck, Approve Reminder, Approve & Send Final, Cancel, and dashboard buttons. Every message and callback is rejected unless the sender ID is explicitly allowed. Approval callback payloads contain the run ID plus a short prefix of the approved message or snapshot hash; old buttons are rejected after state changes.

Long polling runs inside the one backend process. Errors are caught and safely logged without the token. The bot may preview reminder text or the protected report image to the administrator, but actual work-group delivery still uses the Telegram user account and the same workflow/idempotency rules as the web portal.
