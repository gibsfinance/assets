# Gib.Show — Project Instructions

## Quick Reference

```bash
# Server tests (vitest)
yarn workspace server run vitest run
yarn workspace server run vitest run --coverage

# UI tests (vitest + jsdom)
yarn workspace ui run test

# Coverage — CI gates on this, and a passing test run does NOT imply a passing
# coverage run. Run the coverage variant for any workspace you touched before
# calling the change done.
#   @gibs/sdk, @gibs/utils, @gibs/react — 100% on all four metrics. A single
#     untested line fails the build while every test still passes.
#   server — 99.7/99.3/99.7/99.8 (statements/branches/functions/lines) against
#     actuals of 99.77/99.39/99.73/99.85. Margin is as thin as 0.03%, so a
#     handful of new uncovered lines will break CI.
#   ui — 92.4/86.3/91.6/93.6 against actuals of 92.65/86.58/91.87/93.89.
#     Same ~0.2 margin as the others, and for a specific reason: this workspace
#     measures very slightly lower on the CI runner than locally, so floors set
#     to the local figures fail by hundredths.
yarn workspace @gibs/sdk run vitest run --coverage
yarn workspace @gibs/utils run vitest run --coverage
yarn workspace @gibs/react run vitest run --coverage
yarn workspace ui run vitest run --coverage

# Lint (server only — must run from packages/server/)
cd packages/server && yarn lint

# Typecheck (from root)
npx tsc --noEmit -p tsconfig.json

# Build
yarn run build

# Dev
cd packages/server && yarn dev     # server
cd packages/ui && yarn dev         # frontend
```

## Architecture

### ORM: Drizzle (migrated from Knex March 2026)
- Schema: `packages/server/src/db/schema.ts` — 18 tables with custom `bytea`/`citext` types
- Client: `packages/server/src/db/drizzle.ts` — uses `casing: 'snake_case'`
- Migrations: `packages/server/drizzle/` — 15 migrations (`0000`–`0014`), the baseline plus
  hand-written follow-ups, generally using `IF NOT EXISTS` guards
- ⚠️ Snapshot drift: `drizzle/meta/` snapshots stop at `0010` while migrations run to `0014`,
  because `0011`–`0014` were hand-written without regenerating a snapshot. `drizzle-kit`
  therefore models the database as of `0010`, and `db:migrate-generate` emits a replay of
  already-applied work — re-dropping the indexes `0013` dropped and re-adding the columns
  `0012`/`0014` added. Nothing automated runs `generate`, so this is developer-facing only:
  read any generated migration before committing it.
- Old Knex files: moved to `_backup/knex/` (gitignored)

### Image Serving Pipeline
- `?as=webp` — output format conversion (sharp resize pipeline)
- `?only=vector` — source type filter (filter by extension before selection)
- Path extension `.webp` on address — same as `?as=webp`
- Priority: `dense_rank() OVER (PARTITION BY token ORDER BY ranking/1000, version DESC, format, key)`
- `RANKING_SPACING = 1000` in `sync-order.ts` — groups sub-lists under providers

### Token List Ordering
- `applyOrder()` in `db/index.ts` — CTE with dense_rank window function
- `dedupe` flag: true = WHERE rank=1 (image endpoints), false = all rows (token lists)
- `sorted` flag: true = ORDER BY ranking (tokensByChain), false = no sort (merged)

### UI Utils Pattern
Pure functions extracted from components live in `packages/ui/src/lib/utils/`:
- `formatting.ts` — formatBytes, detectImageFormat, buildImageUrlWithSize, truncateAddress, generateRepoName
- `token-search.ts` — filterTokensBySearch, sortTokensMainnetFirst, getPopularChains, countResults, isCacheHit, parsePathParams
- `code-output.ts` — shadowToCSS, shapeToCSS, buildImageUrl, buildNetworkUrl
- `list-order.ts` — isDefaultOrder, reorderArray, DEFAULT_PROVIDERS
- `dedup-tokens.ts` — deduplicateTokens, mergeTokenIntoMap

Components import from these — do not re-inline logic that's been extracted.

## CI

Workflow: `.github/workflows/test.yml` — 8 job definitions (lint, typecheck, build, unit-test,
vitest, coverage, browser-test, integration-test). `vitest` and `coverage` are matrices over the
five workspaces and `typecheck` is a matrix over two configurations, so a run reports 17 jobs.
`coverage` fails independently of `vitest`: every test can pass while a threshold breach turns
the run red.

Only `packages/server` and `packages/ui` are type-checked. Nothing type-checks the other three
workspaces, and `yarn workspace ui run build` is a bare `vite build`, which strips types without
reading them — so the `typecheck` job is the only thing standing between a type error and
master.

- `docker-compose.ci.yml` overrides `shm_size: 16g` → `256m` for CI runners
- Integration test: docker compose up postgres + migrate + server, then `yarn run test`
- Lint runs from `packages/server/` via `yarn lint` (prettier + eslint)
- ESLint config: `packages/server/.eslintrc.mjs` — `argsIgnorePattern: '^_'`

## Conventions

- Server tests: `*.test.ts` alongside source in `packages/server/src/`
- UI tests: `*.test.ts(x)` alongside source; use vitest config from `packages/ui/vitest.config.ts` (jsdom env)
- Vitest runs — NOT mocha. The `node --test` runner in CI is for legacy sync-order/db-batch tests only.
- Never run UI tests from root without workspace — they need the jsdom environment from `packages/ui/vitest.config.ts`

## Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/db/index.ts` | All DB query functions (43+), `applyOrder` CTE |
| `packages/server/src/db/schema.ts` | Drizzle table definitions |
| `packages/server/src/db/sync-order.ts` | Provider ranking computation, startup sync |
| `packages/server/src/server/image/handlers.ts` | Image API routes, format validation |
| `packages/server/src/server/image/resize.ts` | Sharp resize pipeline, variant caching |
| `packages/server/src/server/list/handlers.ts` | Token list API routes |
| `packages/server/src/server/list/utils.ts` | normalizeTokens, tokenFilters |
| `packages/server/src/server/submissions.ts` | List submission CRUD + auto mode |
| `packages/server/src/collect/collectables.ts` | Provider registry, order = priority |
| `packages/ui/src/lib/components/StudioBrowser.tsx` | Token browser with virtualizer |
| `packages/ui/src/lib/contexts/StudioContext.tsx` | Studio state (appearance, badge, code) |
