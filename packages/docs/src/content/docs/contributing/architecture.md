---
title: Architecture
description: How the server runs on plain Node.js, what the entry points do, and where the important files are.
sidebar:
  order: 3
---

## Running on plain Node

Production runs the server and the collector on plain Node.js, not through `yarn run` and not through `tsx`:

```bash
node --import ./src/bin/register-hooks.ts ./src/bin/server.ts
node --import ./src/bin/register-hooks.ts ./src/bin/collect.ts
```

Both commands run from `packages/server`. `yarn start:server` and `yarn start:collect` run the same thing. `yarn server` and `yarn collect` still use `tsx`.

Node.js strips the types itself. A preload (`src/runtime/node-hooks.ts`) finds the file behind an import that has no extension, and it compiles the one `.tsx` file with esbuild. The reason for all this is memory. Measured at idle in a Linux container, the server tree went from about 410 MB (the `yarn` launcher, the `tsx` launcher, the server and the esbuild service) to about 250 MB.

Because Node.js strips types rather than compiling them, source must stay strippable:

- `packages/server/tsconfig.json` sets `verbatimModuleSyntax` and `erasableSyntaxOnly`. A type-only import needs `import type` or `type X`. Enums, namespaces and constructor parameter properties are errors.
- A JSON import needs `with { type: 'json' }`.

The collector still loads esbuild, because the terminal view is written in `.tsx`. Making that import lazy in the server would save about 35 MB more.

### Settings read at start-up

The server reads its settings once, in `packages/server/config.ts`. A value that must be a whole number of at least one falls back to its default when it is anything else. See [Configuration](/self-hosting/configuration/#runtime-limits) for the limits that control collector concurrency, the `sharp` memory bounds and the image store.

## Start-up order

`src/bin/server.ts` does these things in order:

1. Starts memory reporting, applies the `sharp` limits and builds the image store. A missing or invalid `IMAGE_STORE` stops the process with one line that names the setting. It never names a secret's value.
2. Starts the HTTP server immediately, so a load balancer can probe `/health`. The answer is 503 until the server is ready.
3. Applies database migrations.
4. Purges expired cache rows. The old behaviour deleted every cached response on boot. Now cache keys carry a shape version, and a change that alters a response retires its keys on purpose.
5. Builds the provider ranking and starts a periodic refresh of it (every 60 seconds).
6. Starts a daily job that prunes image variants.
7. Warms the statistics, ranked-token, merged-list and provider-list caches in the background, one after another. Overlapping warm-ups would multiply the load on the database while the server is still proving itself ready. `/health` answers 200 when the warm-up ends, or after a deadline of 120 seconds, whichever comes first. A warm-up that is still running at the deadline continues in the background.
8. Rewarms those caches every 6 hours, which matches the collection schedule and the six-hour freshness window of the cached bodies.

## Where the code lives

| File | Purpose |
|------|---------|
| `packages/server/src/db/index.ts` | All database query functions, including the `applyOrder` query |
| `packages/server/src/db/schema.ts` | Drizzle table definitions |
| `packages/server/src/db/sync-order.ts` | Provider ranking computation and start-up sync |
| `packages/server/src/server/image/handlers.ts` | Image API routes and format validation |
| `packages/server/src/server/image/resize.ts` | The `sharp` resize pipeline and variant caching |
| `packages/server/src/server/list/handlers.ts` | Token list API routes |
| `packages/server/src/server/list/utils.ts` | `normalizeTokens` and `tokenFilters` |
| `packages/server/src/server/submissions.ts` | List submission handling and automatic image mode |
| `packages/server/src/collect/collectables.ts` | The provider registry. Its order is the priority. |
| `packages/ui/src/lib/components/StudioBrowser.tsx` | The token browser with a virtualised list |
| `packages/ui/src/lib/contexts/StudioContext.tsx` | Studio state: appearance, badge and code |

## API routes

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /image/{chainId}/{address}` | `getImage(false)` | Token image with no explicit order |
| `GET /image/{order}/{chainId}/{address}` | `getImage(true)` | Order-aware lookup |
| `GET /image/fallback/{order}/{chainId}/{address}` | `getImageAndFallback` | Ordered lookup with an unordered fallback |
| `GET /image/direct/{imageHash}` | `getImageByHash` | Hash-addressed direct access |
| `GET /image/{chainId}` | `bestGuessNetworkImage` | Network icon |
| `GET /image/?i=...` | `tryMultiple` | Batch lookup |
| `GET /list/merged/{order}` | | All tokens, priority-ordered |
| `GET /list/tokens/{chainId}` | | Tokens by chain with source annotations |
| `GET /list/{provider}/{key}` | | One provider list |
| `GET /list/` | | The list index |
| `GET /stats` | | Token counts by chain |
| `GET /networks` | | All networks |
| `GET /sprite/{provider}/{key}` and `/sheet` | | Sprite manifest and sprite sheet |
| `POST /api/lists/submit` | | Submit a token list address |
| `POST /api/images/submit` | | Upload a token image |

The public, parameter-level description of each route is the [endpoint reference](/reference/). `packages/server/src/server/openapi.ts` is its single source of truth.

## Adding an endpoint

Write the handler in `src/server/`. Register the route in the module's `index.ts` or in `routes.ts`. Describe it in `openapi.ts` in the same change. A test fails when a route is missing from the definition. See [Continuous integration](/contributing/continuous-integration/#the-openapi-coverage-test).

Every `x-example` in `openapi.ts` is a relative address that exercises the operation against live data. The documentation tooling and the smoke test use it. Keep those examples working.
