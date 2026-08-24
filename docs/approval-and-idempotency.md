# Approval and Idempotency

## Reminder invariant

Reminder approval binds `{targetHash, messageHash, stage}`. The backend re-fetches the Sheet after approval. If the current missing-caller hash differs, the attempt becomes invalidated and no Telegram send occurs.

## Final invariant

Final approval binds the run ID, source snapshot hash, PNG hash, caption text, and sorted destination IDs. Before delivery, the backend re-fetches the Sheet and compares the full normalized source hash, including values and formatting. It also revalidates structural health, completion, and destination configuration. Any difference clears approval and returns to review or attention. Formatting-only source changes therefore block an outdated screenshot.

## Duplicate prevention

- A partial unique SQLite index allows one active run per date/slot.
- Schedule creation transactionally records the last run date and reuses an existing date/slot run.
- Reminder approval can change a draft only once.
- Telegram delivery has a unique `(run, destination, kind, payload_hash)` key.
- `SENT` destinations are skipped during a partial retry.
- `SENDING` and `UNKNOWN` outcomes are never blindly resent.
- Bot callbacks bind a current hash prefix and workflow state transitions reject duplicate clicks.

Retries require administrator review and always repeat the relevant Sheet revalidation.
