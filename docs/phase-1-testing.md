# Phase 1 Testing

## Automated quality gate

Run from the repository root:

```powershell
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm fixture:render` runs the full normalized-model → HTML → Playwright → PNG path with a fixture containing merges, explicit zeros, a DAY OFF row, a note, and an arbitrary `#12AB34` background.

## SQLite smoke test

```powershell
$env:DATABASE_URL = '.\data\phase1-smoke.db'
pnpm db:migrate
pnpm db:smoke
```

Expected result: migrations succeed, double Prepare reuses the same active run, and explicit force-new replaces it. The smoke script removes its temporary run records.

## Real Google Sheet acceptance

Use a safe copy/test range or obtain explicit agreement about a harmless production cell before changing formatting.

1. Configure the real spreadsheet ID, exact worksheet title, and bounded ranges for all three slots.
2. Run `pnpm google:auth` and confirm `/api/sheet/health` is healthy.
3. Prepare Update 1, 2, and 3 separately.
4. For each available slot record:
   - correct tab and range;
   - caller count;
   - complete/missing/exempt/unknown counts and reasons;
   - DAY OFF behavior;
   - totals display;
   - title/header and WFH HEAD TL merges;
   - preview dimensions and visual fit.
5. In the safe test copy/cell, apply an unusual background not represented in application code. Prepare again and compare the source color with `snapshot.json`, `report.html`, and `report.png`.
6. Revalidate without changes; expect `CURRENT`.
7. Change a harmless value or format, revalidate the old preview, and expect `STALE`. Refresh to create a new immutable revision.
8. Search server logs for token/client-secret field names and verify no values appear.
9. Remove/revert the harmless test formatting when finished.

Never commit live snapshot JSON or screenshots unless they have been intentionally sanitized and approved for repository use.
