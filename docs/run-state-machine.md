# Run State Machine

`packages/domain/src/workflow.ts` is the source of truth for legal transitions. Repository transitions are transactional and reject illegal or concurrent state changes.

The main path is:

```text
CREATED -> PREPARING -> CHECKING_MEMBERS
  -> WAITING_FOR_REMINDER_APPROVAL -> REMINDER_SENDING -> WAITING_FOR_MEMBERS
  -> WAITING_FOR_ESCALATION_APPROVAL -> ESCALATION_SENDING -> WAITING_FOR_MEMBERS
  -> GENERATING_PREVIEW -> READY_FOR_REVIEW -> FINAL_APPROVED
  -> REVALIDATING -> SENDING -> SENT
```

`NEEDS_ATTENTION` is the safe operational stop for changed structure, missing mappings, unavailable Telegram, stale or unsafe state, and delivery failure. An administrator can recheck, cancel, or use a narrowly defined retry/override. `CANCELLED`, `SENT`, `FAILED`, and `EXPIRED` are terminal. Cancellation clears due actions and leases.

`run_events` records all material actions, including creation, Sheet fetches, classifications, reminder preparation/edit/approval/send, invalidation, preview generation, approval, delivery, retry, errors, overrides, cancellation, and retention cleanup.
