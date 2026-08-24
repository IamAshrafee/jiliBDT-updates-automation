# Phase 1 Architecture

## Scope

Phase 1 is a modular monolith. The backend owns correctness and orchestration; the Next.js page is deliberately small and only exposes Prepare, status, review, refresh, revalidation, and cancellation.

## Modules

- `apps/server`: Fastify API, local admin-token protection, orchestration, and safe error handling.
- `apps/admin`: minimal Next.js administrator review page.
- `packages/config`: Zod-validated environment configuration and log-redaction paths.
- `packages/domain`: slot, snapshot, warning, run, structure, completion, and hashing rules.
- `packages/db`: Drizzle schema, SQLite connection, migrations, run repository, events, and idempotency.
- `packages/google-sheet`: OAuth client, health check, A1 parsing, theme/RGB conversion, and format-aware Sheets reader.
- `packages/renderer`: normalized snapshot to HTML, embedded Lexend, Playwright PNG capture, and immutable artifact storage.

SQLite is intentionally used as a local file database. WAL mode, foreign keys, a busy timeout, a transaction, and a partial unique index provide adequate Phase 1 safety without a database service. The backend applies migrations at startup.

## Snapshot model

`SheetSnapshot` is the source boundary. It records the spreadsheet/sheet/range identity, fetch time, absolute range origin, rectangular cells, merges, row/column dimensions, and warnings. Each cell carries formatted/effective values, formula, note, hyperlink, effective visual format, borders, number format, and source coordinate.

The source hash excludes `fetchedAt` but includes source identity, values, formatting, dimensions, merges, and warnings. A formatting-only change therefore invalidates a preview.

## Structural validation

The validator scans the selected range for exactly one row containing all eight expected headers in order. Missing or duplicated matches are blocking. A shifted but otherwise valid header row is detected and reported rather than rejected solely because it moved.

## Completion detection

Classification is independent from visual formatting:

- `EXEMPT`: normalized Remarks matches a configured exemption, initially `DAY OFF`.
- `COMPLETE`: member status and active remark are recognized and all four required fields contain values. Numeric zero and boolean false count as values.
- `MISSING`: one or more required fields are blank; every missing field is named.
- `UNKNOWN`: status/remark state is unexpected and automatic classification would be unsafe.

Discovered Sheet callers are inserted into the small `members` table without hardcoded names.

## Rendering and artifacts

The HTML renderer copies normalized effective formatting generically. It synthesizes the correct source column letters and row numbers, reconstructs merges, applies dimensions, and displays a red corner only when a Sheet note exists. Lexend weights are embedded as local WOFF2 data, so screenshot generation does not depend on Google Fonts.

Each render writes a new revision directory containing `snapshot.json`, `report.html`, and `report.png`. The PNG has its own SHA-256 checksum. A blocking snapshot is persisted for diagnosis but is not rendered as a review-ready report.

## Run lifecycle

Phase 1 uses:

```text
CREATED → PREPARING → CHECKING_MEMBERS → READY_FOR_REVIEW
                                      ↘ NEEDS_ATTENTION
                                       ↘ FAILED

Any active run → CANCELLED
```

The database prevents more than one active run for the same report date and slot. A normal duplicate request returns the existing run. `forceNew` explicitly cancels the old run before creating another.

Run events capture creation, source fetch, readiness/attention, failure, refresh, revalidation/staleness, replacement, and cancellation.

## API

- `GET /health`
- `GET /api/sheet/health`
- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/refresh`
- `POST /api/runs/:id/revalidate`
- `POST /api/runs/:id/cancel`
- `GET /api/runs/:id/artifact`

All `/api/` routes require `x-admin-token` when `ADMIN_API_TOKEN` is configured. Production configuration requires a token; tokenless development is restricted to `127.0.0.1`.
