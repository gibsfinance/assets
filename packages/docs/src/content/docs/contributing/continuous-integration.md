---
title: Continuous integration and TypeScript
description: What the continuous integration workflow checks, the OpenAPI coverage test, and why the project uses two TypeScript versions.
sidebar:
  order: 11
---

## The workflow

The workflow is `.github/workflows/test.yml`. It has 8 job definitions:

| Job | What it checks |
|-----|----------------|
| `lint` | `yarn lint` in `packages/server` and in `packages/ui`, as separate steps, so a failure names which one broke |
| `typecheck` | The TypeScript 7 typecheck, as a matrix over two configurations |
| `build` | `yarn run build` |
| `unit-test` | `node --test` for the older sync-order and database batch tests |
| `vitest` | `vitest run`, as a matrix over the five workspaces |
| `coverage` | `vitest run --coverage`, as a matrix over the five workspaces |
| `browser-test` | The interface browser tests |
| `integration-test` | Builds the Docker images, brings up PostgreSQL, the migration and the server, and then runs `yarn run test` |

The matrices expand the 8 definitions into 17 jobs per run.

`coverage` fails independently of `vitest`. Every test can pass while a threshold breach turns the run red. See the coverage rule in [Development setup](/contributing/development-setup/#coverage-100-percent-on-every-workspace).

`docker-compose.ci.yml` overrides the PostgreSQL `shm_size` from `16g` to `256m` for continuous integration runners.

Only `packages/server` and `packages/ui` are type-checked. Nothing type-checks the other three workspaces. `yarn workspace ui run build` is a bare `vite build`, which strips types without reading them. The `typecheck` job is therefore the only thing between a type error and the main branch.

The lint job once left out the interface. It drifted to 187 findings, and more than half were about `coverage/` and `dist/`, which are generated output that nobody had told the linter to skip.

## The OpenAPI coverage test

Adding a route means adding it to `openapi.ts` in the same change. `openapi-coverage.test.ts` scans every router module for its registrations. It fails on any path that the definition does not describe, and it names the route and the file it came from.

The test reads the source, not the Express router. Express 5 discards mount paths, and `image/index.ts` registers through `router.use`. A walk of the router stack would find no image endpoint and report success.

A new `router.use` in `routes.ts` also fails the test until you add it to that file's `MOUNTS`.

## Two TypeScript versions

`typescript` is 6.x. `@typescript/native` (root only) is TypeScript 7.

- The typescript-eslint package loads the classic JavaScript compiler API. TypeScript 7 does not ship it, and typescript-eslint's peer range stops below 6.1. So **lint and the editor run on 6**.
- **Every typecheck and build runs on 7**, through `scripts/tsc7.mjs`.
- Both packages name their binary `tsc`, and the bare `tsc` link belongs to 6. Callers therefore go through the runner.

The callers that use the runner are the workspace `build` scripts, the `typecheck` and `publish-sdk` steps, and both `Dockerfile` and `Dockerfile.worker`. Both Dockerfiles copy the runner in before building. **A new image that runs `yarn run build` must do the same.**

A type error that only 7 reports reaches the typecheck, not the editor.

The usual alias trick (`"typescript": "npm:@typescript/typescript6@…"`) fails under Yarn. Its built-in compatibility patch attaches to any dependency named `typescript`, and it breaks on that package's different file layout.

When typescript-eslint supports TypeScript 7, move `typescript` to 7, delete `@typescript/native` and the runner, and point callers back at `tsc`.

```bash
# The typecheck, from the repository root
node scripts/tsc7.mjs --noEmit -p tsconfig.json
```
