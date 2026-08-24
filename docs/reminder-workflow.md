# Reminder Workflow

Only `MISSING` callers are reminder targets. `COMPLETE` and `EXEMPT` callers are excluded, and `UNKNOWN` blocks automation. Every missing caller must have an enabled Telegram username or numeric user ID mapping; otherwise the run becomes `NEEDS_ATTENTION` rather than generating malformed mentions.

Two fixed stages exist: `INITIAL` and `ESCALATION`. The message is rendered from the configurable template and can be edited before approval. Approval stores both the exact target hash and message hash. Immediately before sending, the backend fetches the same Sheet range again and recalculates missing callers. A change invalidates approval and creates a new review state.

After a successful send, SQLite stores a due `RECHECK_MEMBERS` action. A fresh check either creates the final preview, prepares the escalation, or continues waiting after the second stage. Skipping a reminder and forcing a preview require a human-entered reason and create audit events.

Each destination has its own delivery record. If one destination fails, already successful destinations are not resent. A failed reminder retry is reset to a fresh review/approval step; uncertain sends are not retried automatically.
