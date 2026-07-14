# Residual dependency advisories — triage

_Last updated: 2026-06-16, after upgrading the server to eslint 9._

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
| After Tier 3 (commit `3ba6dc0b`) | 0 | 15 | 29 | 6 | 50 |
| After removing unused hardhat | 0 | 9 | 23 | 2 | 34 |
| **After server eslint 9 upgrade** | **0** | **9** | **17** | **2** | **28** |

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

## What removing hardhat fixed

The earlier triage assumed `hardhat` was a live contract-tooling dependency and
that clearing its advisories required a hardhat 2 → 3 migration. Inspection of
the codebase showed it was simply unused: no `hardhat.config.*`, no Solidity
files anywhere, no `import`/`require` of `hardhat` or `@nomicfoundation/*`, and
no script that invokes it. It was moved from development to production
dependencies in April 2025 (commit `0343c6e4`) at the same time `hardhat compile`
was dropped from the build, and has been dead weight since.

Removing the single dependency line from `packages/server/package.json` pruned
140 transitive packages (the entire `@ethereumjs/*` and `@ethersproject/*`
trees, hardhat's bundled `solc`, `mocha`, and `@sentry/node`) and cleared the
advisory count from 50 to 34. Each of the following was sourced *only* through
hardhat's transitive tree and is no longer present:

- `undici` — 2 high + 3 moderate (hardhat's HTTP client).
- `uuid` — 1 moderate.
- `cookie` — 1 low, via hardhat's bundled `@sentry/node` telemetry.
- `bn.js` — 1 moderate, and `elliptic` — 1 low, via the bundled ethers crypto
  and signing stack.
- `tmp` — 1 high + 1 low, via the bundled `solc` compiler.
- `diff` — 1 low, via the bundled `mocha` test runner.

Verified after removal: typecheck clean, server lint clean, full build clean,
server suite 427/427, user-interface suite 889/889.

## What upgrading the server to eslint 9 fixed

The earlier triage assumed this was a migration from legacy `.eslintrc` to flat
config. It was not: `packages/server` was already on flat config (an
`.eslintrc.mjs` driven by `tseslint.config()`, forced on with the
`ESLINT_USE_FLAT_CONFIG=true` environment variable), and `packages/ui` was
already on eslint 9 with typescript-eslint 8. The actual work was bringing the
server in line:

- bumped `eslint` 8.57 → 9, `typescript-eslint` 7 → 8, `@eslint/js` and
  `globals` to match `packages/ui`;
- renamed the config to `eslint.config.js` so eslint 9 auto-discovers it, and
  dropped the `ESLINT_USE_FLAT_CONFIG` environment-variable workaround;
- removed `eslint-plugin-mocha` entirely — the repository uses vitest, not
  mocha, and the config only registered the plugin to turn its rules back off;
- fixed the fallout from eslint 9's stricter defaults (its
  `reportUnusedDisableDirectives` is on by default, and typescript-eslint 8's
  `no-unused-vars` now checks caught errors): removed three dead
  `eslint-disable` directives, switched one unused `catch (error)` to an
  optional catch binding, and derived `TableNames` directly from `tableNames`
  instead of a throwaway runtime array.

This cleared the advisory count from 34 to 28 — specifically the six
eslint-8-only deprecation notices that left the tree with eslint 8:
`@humanwhocodes/config-array`, `@humanwhocodes/object-schema`, the `eslint`
end-of-life notice, `glob`, `inflight`, and `rimraf`.

It did **not** clear `minimatch`, `ajv`, or `js-yaml`, contrary to the earlier
prediction — eslint was only one of several consumers of each, and the others
(vitest, drizzle-kit, and their chains) keep them in the tree.

Verified after the upgrade: typecheck clean, server lint clean, full build
clean, server suite 427/427, user-interface suite 889/889.

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

- **minimatch — high (×6):** regular-expression denial of service via several
  build and test tools (`vitest`, `drizzle-kit`, and others). Versions span
  multiple majors; a single pin cannot satisfy all consumers. The eslint 9
  upgrade did *not* clear these — eslint was only one of many consumers.
- **picomatch — high / moderate:** regular-expression denial of service via
  `anymatch` (file watching, needs picomatch 2.x) and `vitest` (4.x).
- **brace-expansion — moderate (×4):** denial of service via `minimatch`,
  same multi-major constraint.
- **ajv, js-yaml — moderate:** regular-expression denial of service and
  prototype pollution. The eslint 9 upgrade did not clear these; they remain via
  other tooling consumers (vitest, drizzle-kit, and their transitive chains).
- **ip-address — moderate:** cross-site scripting in HTML-emitting helpers via
  `socks` (the proxy-agent chain under puppeteer); we never call those helpers.
- **mdast-util-to-hast — moderate:** unsanitized class attribute via
  `hast-util-to-html` (build-time documentation rendering).
- **@babel/core — low:** arbitrary file read via a source-map comment, at
  build time only (`@vitejs/plugin-react`).

### 3. Cleared by removing the unused hardhat dependency (resolved)

The `undici` (high ×2 / moderate ×3), `uuid` (moderate), `cookie` (low),
`bn.js` (moderate), `elliptic` (low), `tmp` (high / low), and `diff` (low)
advisories all entered the tree solely through hardhat and are gone. See the
"What removing hardhat fixed" section above.

### 4. Deprecation notices — not vulnerabilities

Yarn surfaces npm deprecation messages through the same audit channel. These are
"this version is no longer maintained" notices, not exploitable defects. They
clear only when the parent tool is upgraded (a newer drizzle-kit / tsx, and so
on). The remaining ones after the eslint 9 upgrade:

`@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`,
`@ungap/structured-clone`, `node-domexception`.

## Suggested next steps (optional, lower priority)

1. ~~**hardhat 3 upgrade**~~ — done, and it turned out to be a removal rather
   than a migration: hardhat was unused. See "What removing hardhat fixed".
2. ~~**eslint 9 upgrade in `packages/server`**~~ — done. See "What upgrading the
   server to eslint 9 fixed". It cleared the eslint-8-only deprecation notices
   but, contrary to the original prediction, not `minimatch`/`ajv`/`js-yaml`
   (those have other consumers).
3. The remaining 28 are all development, test, lint, and build tooling — none on
   a request path. The largest clusters (`minimatch` ×6, `picomatch` ×5,
   `brace-expansion` ×4) are multi-major regular-expression denial-of-service
   advisories in vitest/drizzle-kit chains; clearing them would need those
   parents to ship fixed transitive pins. Document-and-accept until then.
