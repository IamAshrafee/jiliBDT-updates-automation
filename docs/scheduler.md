# Scheduler and Restart Recovery

One in-process interval wakes every `SCHEDULER_TICK_SECONDS` (15 seconds by default). It checks the three SQLite schedule records using each schedule's timezone and starts at most one run per date/slot. Scheduled preparation does not approve or send anything.

Delayed workflow work is stored directly on the run as `next_action_type` and `next_action_at`. The scheduler atomically leases one due action using `action_claim_token` and `action_claimed_until`. Success clears it; failure releases it with a short retry time and audit event. Expired leases can be reclaimed after process restart.

The system therefore does not depend on long `setTimeout` calls. On startup, the same loop sees overdue actions in SQLite and resumes them. A cancelled or terminal run cannot be claimed. No external queue or distributed lock is used because the supported topology is one application process.
