# Phase 2 Testing

## Automated gates

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
pnpm fixture:render
```

The test suite covers legal/illegal states, target and final approval hashes, templates, SQLite hardening and idempotency, mapping, schedule/action leases, cancellation, encrypted sessions, administrator sessions/origin checks, bot authorization/stale callbacks, artifact retention, and mock end-to-end scenarios A through F.

## Safe live Google test

1. Back up `data/jilibdt.db`; confirm OAuth health and configured Sheet/tab/ranges.
2. Run `pnpm sheet:smoke` and prepare all populated slots from the portal.
3. Record caller counts, `DAY OFF`, totals, merges, exact dimensions, notes, and screenshot fit.
4. For formatting mutation, use only a disposable copied sheet or an administrator-approved harmless test cell. Apply an unusual color, prepare, and verify the color in snapshot JSON/HTML/PNG. Restore the copy. Never mutate production business data for acceptance.
5. Generate a preview, change only safe formatting in the copy, then approve. Confirm the send is blocked and a new preview is required.

## Safe live Telegram test

Use a dedicated test group/topic and test account. Verify login, restart/session recovery, dialog discovery, bot allow-list rejection, initial reminder, escalation, final photo/caption, multi-destination behavior, and one controlled failed destination. Confirm delivery IDs/events and no duplicate message. Do not use the production team group for repeated acceptance messages.

If test credentials or a safe copied Sheet/group are unavailable, record the corresponding live result as `NOT TESTED`; mock passing tests do not count as real-provider proof.
