---
title: Development setup and tests
description: How to run the project, its tests, coverage, lint, typecheck and smoke test, and the 100 percent coverage rule.
sidebar:
  order: 2
---

## Set up

You need Node.js 24 (the version continuous integration uses), Docker for PostgreSQL, and Yarn 4 through `corepack`.

```bash
git clone --recursive git@github.com:gibsfinance/assets.git
cd assets
corepack enable
yarn install
```

The `--recursive` flag fetches the artwork repositories under `submodules/`.

Start a database and the server:

```bash
yarn db:up              # PostgreSQL in Docker
yarn server:dev         # the server, with file watching
cd packages/ui && yarn dev   # the interface
```

`yarn workspace server run setup` does a full first-time setup in one command: it builds the images, starts the database, runs the migrations, seeds the database, runs a first collection and builds the provider orders.

To collect data into your database, see [Collectors](/contributing/collectors/) and [Self-hosting: Collection](/self-hosting/collection/).

## Run the tests

Tests use Vitest. The `node --test` runner is used only for a few older tests of provider sync order and database batching.

```bash
# Server
yarn workspace server run vitest run

# Interface (needs the jsdom environment from packages/ui/vitest.config.ts)
yarn workspace ui run test
```

Run the interface tests through the workspace. Never run them from the repository root, because they need the jsdom environment that `packages/ui/vitest.config.ts` sets up.

Keep a test file next to the source it tests:

- Server tests: `*.test.ts` next to the source in `packages/server/src/`.
- Interface tests: `*.test.ts` or `*.test.tsx` next to the source.

## Coverage: 100 percent on every workspace

Continuous integration gates on coverage. A passing test run does **not** imply a passing coverage run. Run the coverage variant for every workspace you touched before you call a change done.

```bash
yarn workspace server run vitest run --coverage
yarn workspace ui run vitest run --coverage
yarn workspace @gibs/sdk run vitest run --coverage
yarn workspace @gibs/utils run vitest run --coverage
yarn workspace @gibs/react run vitest run --coverage
```

Every workspace must reach 100 percent on all four metrics: statements, branches, functions and lines. The thresholds are set there. One untested line fails the build while every test still passes. At the time of writing, the server has 7469 statements, 3686 branches, 1385 functions and 6679 lines over 3281 tests. The interface has 2746, 1633, 714 and 2394 over 1845 tests. `@gibs/sdk` has 92 tests, `@gibs/utils` 95 and `@gibs/react` 41.

There is no margin under the floors. The old floors sat about 0.2 below the measured value, because this workspace once reported slightly lower on the continuous integration runner than on a laptop. At 100 there is nothing left to absorb that gap. A runner that measures lower is reporting a test that depends on its environment, and that is worth a red build.

When you find a new gap, you have three honest answers:

1. Write a test that fails when the behaviour breaks.
2. Delete the code, if nothing can reach it.
3. Report the gap, with evidence.

Never lower a floor to make a run pass. Never invent a state that the application cannot produce just to execute a line.

:::caution
Run the coverage of one workspace at a time. Two runs in the same workspace share its `coverage/` directory and overwrite each other. The run that loses reports zeros for files that are fully covered, which looks like a regression.
:::

## Lint

Each workspace runs its own lint from its own directory. Continuous integration runs both.

```bash
cd packages/server && yarn lint
cd packages/ui && yarn lint
```

Lint is Prettier plus ESLint. The project uses ESLint 10. It needs Node.js 20.19 or later, 22.13 or later, or 24. The configuration is `packages/server/eslint.config.js` (flat config), and `packages/ui` has its own. Unused arguments must start with an underscore (`argsIgnorePattern: '^_'`).

ESLint 10 added three rules to `eslint:recommended`. `no-useless-assignment` and `preserve-caught-error` found real issues in `packages/server/src/collect/` and `packages/server/src/server/list/handlers.ts`: dead variable initialisers, and two thrown errors that dropped their original cause. Both are fixed in the source, not suppressed. `no-unassigned-vars` found nothing.

## Typecheck and build

From the repository root:

```bash
# TypeScript 7, through the runner. A bare tsc is TypeScript 6.
node scripts/tsc7.mjs --noEmit -p tsconfig.json

# Build everything
yarn run build
```

See [Continuous integration and TypeScript](/contributing/continuous-integration/#two-typescript-versions) for why there are two versions.

`yarn workspace ui run build` is a bare `vite build`. It strips types without reading them, so a type error will not fail it. The typecheck job is the only thing between a type error and the main branch.

## Smoke test a running instance

```bash
yarn smoke                # staging
yarn smoke:production     # gib.show
```

The smoke test calls every documented endpoint and also sends the inputs that should be refused. It exits with a non-zero status on any failure, so it can gate a deploy. It uses staging unless you pass a target.

Each request carries a random query parameter on purpose. Image responses are cached at the edge for a day, so a plain request after a deploy can be answered by a copy made before it. That looks like missing response headers rather than a stale body. The `link` and `x-license` headers are set unconditionally, so if either is absent, the response did not come from that code at all. Suspect the cache before the code.

## Code conventions

- Server source must stay strippable by Node.js. See [Architecture](/contributing/architecture/#running-on-plain-node).
- Every isolated unit needs tests, and the coverage rule above applies.
- Add a route and its `openapi.ts` entry in the same change. See [Continuous integration](/contributing/continuous-integration/#the-openapi-coverage-test).
- Pure logic that you extract from a component goes in `packages/ui/src/lib/utils/`. See [Front end](/contributing/front-end/#interface-utilities).
