# Residual dependency advisories — triage

_Last updated: 2026-06-16, after the Tier 3 dependency sweep._

## How to reproduce the audit

```bash
# The default `yarn npm audit` only scans the ROOT workspace. Use --all to
# include every package under packages/*, or you will undercount drastically.
yarn npm audit --all --recursive --environment all
```

## Where we are

| Milestone | critical | high | moderate | low | total rows |
|-----------|---------:|-----:|---------:|----:|-----------:|
| Before Tier 1+2 (historical) | 3 | 35 | 37 | 7 | 82 |
| After Tier 1+2 (commit `2b7c45c1`) | 3 | 35 | 37 | 7 | 82 |
| **After Tier 3 (this sweep)** | **0** | **15** | **29** | **6** | **50** |

The full inbound request path of the server (everything that processes an
untrusted HTTP request) is clean. Every advisory listed below sits in
build / test / lint / contract-compilation tooling, or is not exploitable in
the way this project uses the package.

## What Tier 3 fixed

Applied as root `resolutions` (floor-pinned — Yarn Berry resolves a `>=` range
to the *minimum* satisfying version, so the floor must itself be the patched
version):

- `form-data >=4.0.6` — clears the form-data injection advisory on the
  collector's outbound axios. (Also satisfies open item #4.)
- `ws >=8.21.0` — clears all three websocket advisories (the viem production
  path, the test runner, and hardhat's older copy).
- `postcss >=8.5.15`, `shell-quote >=1.8.4`, `tar >=7.5.16`,
  `tar-fs >=3.1.2`, `serialize-javascript >=7.0.5`, `immutable >=4.3.8`.
- `basic-ftp` floor raised `>=5.2.2` → `>=6.0.1` (the old floor still resolved
  to a vulnerable build).
- `vitest/vite` floor raised `>=8.0.5` → `>=8.0.16`.

Applied as direct dependency bumps in `packages/ui`:

- `react-router-dom ^7.13.1 → ^7.18.0` — in-major bump that clears seven
  advisories (cross-site scripting, remote code execution, denial of service,
  open redirect, cross-site request forgery) in the client single-page
  application shipped to browsers. Highest real-user value of the sweep.
- `vitest`, `@vitest/browser`, `@vitest/browser-playwright`,
  `@vitest/coverage-v8` `^4.1.4 → ^4.1.9` — clears both criticals in the
  browser-mode test runner.
- `vite ^6.4.2 → ^6.4.3` — in-major patch (the `previous` distribution tag)
  that clears the remaining vite advisories.

Verified after the sweep: typecheck clean, server lint clean, full build clean,
server suite 427/427, user-interface suite 889/889.

## Residual — and why each is left in place

### 1. Not exploitable as this project uses it (no action)

- **esbuild — high (advisory 1120679):** the remote-code-execution path is in
  esbuild's **Deno** install module via `NPM_CONFIG_REGISTRY`. This project runs
  on Node, not Deno, so the vulnerable code never executes. Force-pinning
  esbuild to `>=0.28.1` would break `tsx` (which runs the server) and
  `drizzle-kit`, both of which deliberately track an older esbuild. Net negative.
- **esbuild — moderate / low (1102341, 1120680):** the development-server
  request-forgery and Windows file-read issues only trigger when something runs
  `esbuild serve`. Our consumers (`tsx`, `drizzle-kit`, `@esbuild-kit/*`) never
  start the esbuild dev server.

### 2. Build / test / lint tooling — regular-expression or memory denial of service, multi-major to fix (accepted, not shipped)

These packages are only present in development, continuous integration, and
contract-compilation tooling. None reaches a production request path. Each fix
would require a breaking major upgrade of a transitive parent (or would fork the
dependency tree across incompatible majors), so they are accepted as residual.

- **minimatch — high (×9):** regular-expression denial of service via
  `eslint`, `mocha`, and `@typescript-eslint/typescript-estree`. Versions span
  majors 3 / 5 / 9; a single pin cannot satisfy all three.
- **picomatch — high / moderate:** regular-expression denial of service via
  `anymatch` (file watching, needs picomatch 2.x) and `vitest` (4.x).
- **brace-expansion — moderate (×4):** denial of service via `minimatch`,
  same multi-major constraint.
- **tmp — high / low:** path traversal via `solc`'s temporary files. The
  traversal requires an attacker-controlled `prefix`/`postfix`, which `solc`
  never exposes; `solc` also pins `tmp@0.0.33` and would break under a forced
  bump. Contract-compilation tooling only.
- **ajv, js-yaml — moderate:** regular-expression denial of service and
  prototype pollution via `eslint`; resolved by migrating to eslint 9.
- **bn.js — moderate:** infinite loop via the ethers crypto stack
  (contract tooling).
- **ip-address — moderate:** cross-site scripting in HTML-emitting helpers via
  `socks` (the proxy-agent chain under puppeteer); we never call those helpers.
- **mdast-util-to-hast — moderate:** unsanitized class attribute via
  `hast-util-to-html` (build-time documentation rendering).
- **@babel/core — low:** arbitrary file read via a source-map comment, at
  build time only (`@vitejs/plugin-react`).
- **diff — low:** denial of service via `mocha` (legacy test runner).
- **elliptic — low:** risky cryptographic primitive via the ethers signing
  stack (contract tooling).
- **cookie — low:** out-of-bounds characters via `@sentry/node`, which is
  pulled in by hardhat's telemetry — not the server's own cookie handling.

### 3. Requires a parent major upgrade (tracked for a future branch)

- **undici — high (×2) / moderate (×3) via hardhat:** the fix needs undici 6,
  but hardhat 2.x pins undici 5.x. Although `hardhat` is declared a production
  dependency, the server uses viem's HTTP transport for chain reads and never
  exercises hardhat's HTTP or websocket client at runtime. Clearing this
  requires upgrading to hardhat 3, which is its own migration.
- **uuid — moderate via hardhat:** needs uuid 11; hardhat pins uuid 8. Same
  hardhat-3 migration.

### 4. Deprecation notices — not vulnerabilities

Yarn surfaces npm deprecation messages through the same audit channel. These are
"this version is no longer maintained" notices, not exploitable defects. They
clear only when the parent tool is upgraded (eslint 9, a newer drizzle-kit, and
so on):

`@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`,
`@humanwhocodes/config-array`, `@humanwhocodes/object-schema`,
`@ungap/structured-clone`, `eslint` (version 8 end-of-life), `glob`,
`inflight`, `node-domexception`, `rimraf`, `whatwg-encoding`.

## Suggested next steps (optional, lower priority)

1. **hardhat 3 upgrade** on its own branch — clears the undici, uuid, and cookie
   residuals in one move. Largest single reduction left, but a real migration.
2. **eslint 9 migration** — clears minimatch, ajv, js-yaml, and several
   deprecation notices. Requires moving `packages/server/.eslintrc.mjs` to the
   flat-config format.
3. Leave everything in category 1 alone permanently — document-and-accept.
