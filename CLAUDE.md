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
#   Every workspace — 100% on all four metrics, and the floors are set there.
#     A single untested line fails the build while every test still passes.
#     Actuals: server 7513 statements / 3700 branches / 1398 functions / 6720
#     lines over 3311 tests; ui 2746/1633/714/2394 over 1845 tests; @gibs/sdk
#     92 tests, @gibs/utils 95, @gibs/react 41, docs 29 (79/41/16/67).
#   There is no margin under the interface floors any more. The old ones sat
#     ~0.2 below measured because this workspace used to report slightly lower
#     on the CI runner than locally. At 100 there is nothing left to absorb, so
#     a runner that measures lower is reporting a test that depends on its
#     environment — worth a red build.
#   A new gap has three honest answers: write a test that fails when the
#     behaviour breaks, delete the code if nothing can reach it, or report it
#     with evidence. Never lower a floor to make a run pass, and never fabricate
#     a state the application cannot produce just to execute a line.
#   Run one workspace's coverage at a time. Two runs in the same workspace share
#     its coverage/ directory and overwrite each other, and the loser reports
#     zeros for files that are fully covered — which reads as a regression.
yarn workspace @gibs/sdk run vitest run --coverage
yarn workspace @gibs/utils run vitest run --coverage
yarn workspace @gibs/react run vitest run --coverage
yarn workspace ui run vitest run --coverage

# Documentation site (Starlight) — see "Documentation Site" below
yarn workspace docs dev              # dev server with live reload
yarn workspace docs build            # static site into packages/docs/dist
yarn workspace docs run vitest run --coverage   # the build scripts, at 100%

# Lint — each workspace runs its own, from its own directory. CI runs both.
cd packages/server && yarn lint
cd packages/ui && yarn lint

# Typecheck (from root) — TypeScript 7, through the runner. A bare `tsc` is
# TypeScript 6; see "Two TypeScript versions" below.
node scripts/tsc7.mjs --noEmit -p tsconfig.json

# Build
yarn run build

# Dev
cd packages/server && yarn dev     # server
cd packages/ui && yarn dev         # frontend

# Smoke test a deployed instance — every documented endpoint, plus the inputs
# that should be refused. Exits non-zero on any failure, so it can gate a deploy.
# Defaults to staging; pass a target to check production.
yarn smoke                         # staging
yarn smoke:production              # gib.show
#   Each request carries a random query parameter on purpose. Image responses
#   cache at the edge for a day, so a plain request after a deploy can be
#   answered by a copy made before it — which looks like missing response
#   headers rather than a stale body. `link` and `x-license` are set
#   unconditionally by attributionHeaders, so if either is absent the response
#   did not come from that code at all: suspect the cache before the code.
```

## Running on Plain Node, and Runtime Settings

Production runs `node --import ./src/bin/register-hooks.ts ./src/bin/server.ts` (and `collect.ts`)
from `packages/server`, not `yarn run server`. Node strips the types itself; the preload
(`src/runtime/node-hooks.ts`) finds the file behind an extensionless import and compiles the one
`.tsx` file with esbuild. Measured at idle in a Linux container, the server tree went from about
410 MB (yarn, tsx launcher, server, esbuild service) to about 250 MB. `yarn start:server` and
`yarn start:collect` run the same thing; `yarn server` and `yarn collect` still use tsx.
- Source must stay strippable. `packages/server/tsconfig.json` sets `verbatimModuleSyntax` and
  `erasableSyntaxOnly`, so a type-only import needs `import type` / `type X`, and enums,
  namespaces and constructor parameter properties are errors. A JSON import needs
  `with { type: 'json' }`.
- The collector still loads esbuild because the terminal view is JSX. Making that import lazy in
  the server would save about 35 MB more.

Settings read once at start-up (`config.ts`). A value that is not a whole number of at least one
falls back to the default.

| Variable | Default | Effect |
|---|---|---|
| `COLLECT_PROVIDER_CONCURRENCY` | 4 | providers collected in parallel (`--concurrency` overrides) |
| `IMAGE_FETCH_CONCURRENCY` | 8 | logos downloaded at once while a list's tokens are stored |
| `IMAGE_PREWARM_CONCURRENCY` | 8 | logos downloaded at once while a list is prewarmed |
| `SHARP_CACHE_MEMORY_MB` | 16 | sharp pixel cache size (`applySharpLimits`, both processes) |
| `SHARP_CACHE_ITEMS` | 64 | most operations sharp keeps cached |
| `SHARP_CONCURRENCY` | 1 | threads libvips may use |
| `IMAGE_STORE` | `local` | which storage holds image bytes: `local`, `s3`, `gcs`, `azure`, `ipfs`, or JSON for `tiered` / `mirrored` / `fallback` (see "Image Store" below) |
| `IMAGE_STORE_DIR` | `<repository root>/image-store` | `local`: root of the content-addressed image store |
| `IMAGE_STORE_S3_PRESET` | `aws` | `s3`: `aws`, `r2`, `hetzner`, `b2`, `wasabi`, `spaces`, `minio` or `custom` |
| `IMAGE_STORE_S3_BUCKET` | required | `s3`: bucket name |
| `IMAGE_STORE_S3_REGION` | preset's (`aws` `us-east-1`, `r2` `auto`, `hetzner` `fsn1`, `wasabi` `us-east-1`, `spaces` `nyc3`; `b2` has none) | `s3`: region the requests are signed for |
| `IMAGE_STORE_S3_ENDPOINT` | preset's | `s3`: endpoint address; required for `minio` and `custom` |
| `IMAGE_STORE_S3_ACCOUNT_ID` | — | `s3` with `r2`: Cloudflare account id, part of the endpoint |
| `IMAGE_STORE_S3_ADDRESSING` | preset's | `s3`: `path` or `virtual` (bucket in the host name) |
| `IMAGE_STORE_S3_PREFIX` | none | `s3`: text before every key, to share a bucket |
| `IMAGE_STORE_S3_ACCESS_KEY_ID`, `IMAGE_STORE_S3_SECRET_ACCESS_KEY` | required (secret) | `s3`: keys; environment only |
| `IMAGE_STORE_S3_SESSION_TOKEN` | none (secret) | `s3`: for temporary credentials |
| `IMAGE_STORE_GCS_BUCKET` | required | `gcs`: bucket name |
| `IMAGE_STORE_GCS_CREDENTIALS_JSON` | (secret) | `gcs`: the service-account key file's text. One of this or the file setting is required unless an endpoint is set |
| `IMAGE_STORE_GCS_CREDENTIALS_FILE` | — | `gcs`: path to the service-account key file |
| `IMAGE_STORE_GCS_ENDPOINT` | `https://storage.googleapis.com` | `gcs`: set to aim at an emulator (then no credentials are needed) |
| `IMAGE_STORE_GCS_PREFIX` | none | `gcs`: text before every key |
| `IMAGE_STORE_AZURE_ACCOUNT`, `IMAGE_STORE_AZURE_CONTAINER` | required | `azure`: storage account and container |
| `IMAGE_STORE_AZURE_ACCOUNT_KEY` / `IMAGE_STORE_AZURE_SAS_TOKEN` | exactly one (secret) | `azure`: Shared Key, or a shared access signature with read, write, create, delete and list rights |
| `IMAGE_STORE_AZURE_ENDPOINT` | `https://<account>.blob.core.windows.net` | `azure`: set for an emulator (its address includes the account) |
| `IMAGE_STORE_AZURE_PREFIX` | none | `azure`: text before every key |
| `IMAGE_STORE_IPFS_PROVIDER` | required | `ipfs`: `kubo` (any Kubo RPC node), `filebase` or `pinata` |
| `IMAGE_STORE_IPFS_API_URL` | provider's (`filebase`, `pinata`); required for `kubo` | `ipfs`: pinning API address |
| `IMAGE_STORE_IPFS_GATEWAYS` | provider's; required for `kubo` | `ipfs`: comma-separated gateway addresses ending where the CID goes (`…/ipfs/`), tried in order |
| `IMAGE_STORE_IPFS_API_TOKEN` | required for `filebase`, `pinata` (secret) | `ipfs`: bearer token |
| `DOCS_HOSTNAMES` | empty (off) | comma-separated host names that get the documentation site instead of the application (see "Documentation Site") |

Every setting except a secret can instead be written in the `IMAGE_STORE` JSON; a secret is read from the environment
only and the JSON form refuses it. `docs/skills/self-hosting.md` has the full reference with examples.

## Image Store (`packages/server/src/image-store/`)
Content-addressed blob storage. `getImageStore()` returns a `BlobStore` (`put`, `get`, `stat`, `delete`, `list`);
`hashBytes()` is the sha256 of the stored bytes. Which store it is comes from `IMAGE_STORE`, parsed by
`store-config.ts`; `initializeImageStore()` builds it at start-up in the server and collector, so a missing or
invalid setting stops the process with one line that names the setting (and never a secret's value).
- **Adapters.** `local.ts` (files: `<root>/sha256/<first two hex>/<64 hex>`, no extension; a write goes to
  `<root>/tmp/`, is flushed, renamed into place, and its shard directory is flushed; building it sweeps temporary
  files older than an hour). `s3.ts` + `sigv4.ts` (one S3 implementation and a small Signature Version 4 signer, with
  provider presets as data in `S3_PRESETS`; chosen over the AWS software development kit, which adds about twenty
  megabytes for the same six requests). `gcs.ts` (native JSON API with service-account sign-in, no S3 interoperability
  keys). `azure.ts` (Shared Key or SAS). `ipfs.ts` + `cid-index.ts` (pinning through a Kubo RPC or Pinata, reads
  through gateways whose bytes are hashed; the `image_store_cid` table maps sha256 to CID and answers `stat` and `list`).
  The remote adapters share `object-blob-store.ts`: keys are `[prefix]sha256/<2 hex>/<64 hex>`, `put` of a stored blob
  renews its age with a server-side copy (or metadata change) and sends no bytes, `list` follows paging.
- **Composites** (`composite.ts`), built only from other stores so they nest: `tiered` (bounded local cache by recency,
  read-through and write-through), `mirrored` (writes to all, reads from the first that answers, `list` is the union),
  `fallback` (reads a second store it never writes, lists or deletes from, so `images gc` here cannot touch it).
- **Rules every adapter keeps** (`__testing__/blob-store-contract.ts` runs them against all of them): a malformed
  digest throws `TypeError` before storage is touched; `get` and `stat` answer null and `delete` false for a missing
  blob, and only a real "not found" answer counts as missing (a 403 is an error); `stat` and `list` give a
  `modifiedAtMs` that a repeated `put` moves forward.
- **Tests.** Unit tests inject `fetch`, the clock and the file system, so the coverage run needs no Docker. The
  emulator suites (`*.emulator.test.ts`) run the same contract against real servers in Docker: MinIO
  (`cgr.dev/chainguard/minio`), Azurite, fake-gcs-server and Kubo. Run them with
  `yarn workspace server run test:emulators` (sets `IMAGE_STORE_EMULATORS=1`); they are skipped otherwise. Known
  emulator limit: fake-gcs-server does not move `updated` on a metadata PATCH, so its renewal test is skipped
  there and covered against the unit fake.
- S3 `HEAD` gives whole seconds and a listing gives milliseconds; the adapter truncates the listing so both agree.

## Architecture

### ORM: Drizzle (migrated from Knex March 2026)
- Schema: `packages/server/src/db/schema.ts` — 18 tables with custom `bytea`/`citext` types
- Client: `packages/server/src/db/drizzle.ts` — uses `casing: 'snake_case'`
- Migrations: `packages/server/drizzle/` — 17 migrations (`0000`–`0016`), the baseline plus
  hand-written follow-ups, generally using `IF NOT EXISTS` guards
- Snapshots are aligned again: `0015_realign_snapshot_with_applied_migrations` closed the
  drift that had `drizzle/meta/` stopping at `0010` while migrations ran to `0014`.
  `db:migrate-generate` now reports "No schema changes, nothing to migrate" against a clean
  tree — treat any other answer as a signal that `schema.ts` and the migrations have parted
  company, and read what it emits before committing it.
- When a migration has to be hand-written (guards `drizzle-kit` will not emit — `0016` wraps
  a `CREATE EXTENSION` that a restricted database may refuse), still declare the change in
  `schema.ts`, run `generate`, then keep the generated snapshot under the hand-written
  migration's number and delete the generated `.sql`. That is what keeps the two aligned.
- Old Knex files: moved to `_backup/knex/` (gitignored)

### Primary Keys and the Plain Postgres Image
- The database runs on the plain `postgres:16` image (`docker-compose.yml`, with
  `PGDATA=/var/lib/postgresql/data/pgdata16`). There is no custom database image.
- Every primary key is `keccak256` of its natural key, built by a `BEFORE INSERT` trigger
  (`gcid_*` functions). The `keccak256(text)` they call is pure PL/pgSQL, defined in
  `0021_keccak256_in_plpgsql`. It used to be PL/Python with `safe-pysha3`, which is why the
  database once needed its own image; 0021 also drops the `plpython3u` extension.
- The output is fixed: Keccak-256 (not NIST SHA-3) of the UTF-8 text, lowercase hex, no `0x`,
  NULL hashed as the empty string. Stored rows reference each other by these ids, so never
  change it. `packages/server/test/keccak256.test.ts` pins it to values recorded from the
  PL/Python function and to viem's `keccak256`, which the application uses for the same ids.
- It costs about 1 millisecond per hash (PL/Python was about 0.03). Each insert into a table
  with one of these triggers pays it once, upserts that conflict included. Do not add a
  second hash per row without a reason.
- `0000` no longer creates the extension or the function; a fresh database gets the function
  from 0021 and no earlier migration inserts a row. Drizzle skips applied migrations by their
  timestamp in `_journal.json`, not by file hash, so editing 0000 did not disturb existing databases.

### First Paint and the Service Worker
Return visitors paint from cache; the build removes the two blocking requests.
- The built `index.html` carries its stylesheet inline (`src/prerender/inline-stylesheet.ts`, run by
  the `inline-stylesheet` plugin in `vite.config.ts`). Font urls are rewritten to `./assets/...`. The
  build fails if the stylesheet link is missing. The hashed `.css` file is still emitted, unused.
- `/sw.js` is the service worker (`src/sw/`). Decisions are pure functions in `worker-logic.ts`; the
  event wiring in `worker.ts` takes fakes in tests; `sw.ts` only attaches it to the scope. It answers
  navigations to `/` from cache and refreshes in the background, serves `/assets/*` cache first, and
  never touches the API, other origins, or non-GET requests. A returning visitor can see the previous
  version once after a deploy. Bump `CACHE_VERSION` in `worker-logic.ts` to discard every cache.
- The server sends `sw.js` with `no-cache` (`static-headers.ts`). Never hash its name or cache it.
- Registration happens after `load`, in production builds only (`src/sw/register.ts`, called by `main.tsx`).
- **Kill switch:** build with `VITE_SERVICE_WORKER=off` (set it as an environment variable in the
  deploy and redeploy). The build then ships a `/sw.js` that deletes every cache and unregisters
  itself, and the page stops registering a worker. Browsers pick it up on their next update check,
  which they make on each navigation and at least daily. Remove the variable to turn the worker back on.
- **Edge cache for the page:** a Cloudflare cache rule (zone `gib.show`, phase
  `http_request_cache_settings`, description "page: cache index.html at the edge for 60s") caches
  `/` and `/index.html` on `gib.show` and `staging.gib.show` for 60 seconds, edge only. Browsers still
  get the origin's `no-cache` (browser TTL: respect origin). A deploy reaches first-time visitors
  within a minute, with no purge. The page arrives in about 30-50 ms on a warm connection instead of
  about 120 ms. The other rule in that phase ("content") caches `/image`, `/list`, `/token`, `/stats`,
  `/networks`. It respects the origin's lifetimes, except that it keeps 404 answers for one hour:
  without that, Cloudflare kept them about 3 minutes despite the origin's `max-age=86400`, and one
  client polling a few imageless addresses sent about 3,000 requests a day to the server. Edit both
  rules through the Cloudflare API, not by hand, so this note stays true.
- The non-home route loader (`src/prerender/route-loader.ts`) is one module of markup and style, so
  swapping the artwork is a one-file change. A test holds its byte size under a budget.

### Vendored Artwork Repositories and the Images
Four collectors (`trustwallet`, `smoldapp`, `pls369`, `ethereum-lists`) read repositories from `submodules/` on disk.
- `src/submodule-refresh.ts` owns how they get there: depth 1, `--filter=blob:none`, and a sparse checkout of only
  the directories a collector walks (`sparsePaths`). If a collector starts reading another directory, add it there.
- The collector refreshes the repositories its providers read at the start of every run
  (`bin/collect.ts`), when `REFRESH_SUBMODULES=true`. The worker image sets it. A repository that cannot be
  fetched keeps the copy already on disk. Off by default, because on a development machine these directories are
  git submodules somebody may be working in. `SUBMODULES_DIRECTORY` moves the directory (`paths.ts`).
- `Dockerfile.worker` bakes a first copy with `scripts/refresh-submodules.mjs`, which runs the same module under
  Node's own type stripping. That is why `submodule-refresh.ts` has no run-time relative imports. Pass
  `--build-arg SUBMODULES_SNAPSHOT=<anything new>` to get a copy newer than the cached layer.
- Both images install with `yarn workspaces focus server --production`, in a stage that holds only the
  package manifests. Both run TypeScript from source, so the server image builds only `packages/ui`
  (the typecheck job gates the rest) and the worker image builds nothing.

### Image Serving Pipeline
- `?as=webp` — output format conversion (sharp resize pipeline)
- `?only=vector` — source type filter (filter by extension before selection)
- Path extension `.webp` on address — same as `?as=webp`
- Priority: `listEntryPreferenceSql()` in `db/index.ts` — image tier (stored usable image, then a usable image on a
  link-only host such as DeBank, then none; the host set is `LINK_ONLY_HOSTS`), ranking/1000, format, version DESC,
  default, key. One rule for the by-address image (`applyOrder`), the chain lists and search, so a
  `logoURI` names the image `/image/:chainId/:address` serves. `applyOrder` adds one term after
  usable image: a current list version beats a superseded one (the lists read current versions only).
- `RANKING_SPACING = 1000` in `sync-order.ts` — groups sub-lists under providers

### Image Bytes: the Store
Image bytes live in a content-addressed store (`packages/server/src/image-store/`, directory `IMAGE_STORE_DIR`,
layout `sha256/<2 hex>/<64 hex>`), not only in `image.content`. The server and the collector must share that
directory.
- `image_hash` is unchanged: it is the primary key and the public `/image/direct/<hash>` address, derived from the
  downloaded bytes, the source address and the extension. It is NOT a hash of the bytes served. `image.content_sha256`
  is (sanitized bytes, the file's name) and `image.byte_size` is their length. Link-only rows: length 0, no digest, no file.
- Write order: `insertImage` writes the file BEFORE the row, which may sit in a long transaction. A rollback leaves an
  orphan file (`images gc` removes it); a row never points to a missing file. `put` renews the age of a file it reuses.
- Read path: queries select `CASE WHEN content_sha256 IS NULL THEN content END` (`db/image-columns.ts`); routes call
  `withImageBytes` / `loadImageBytes` (`image-store/image-bytes.ts`), which take the bytes from the row when it has no
  digest and from the file otherwise. A missing file is logged and falls to the ordinary redirect / 404 branches. Never
  select `image.content` directly, and keep `res.contentType(ext).send(buffer)` so the ETag and 304s stay identical.
- `IMAGE_BYTES_IN_DATABASE` (default true) decides whether the database copy is still written. Turn it off only after
  `images export` and `images verify` have passed. A trigger from migration 0022 clears a digest that stops matching
  its bytes, which covers the previous release writing `content` during a rolling deploy.
- Operator command (`src/bin/images.ts`, `yarn workspace server run start:images <command>`): `export` (resumable, copies
  rows into the store), `verify [--rehash]` (exits 1 on any problem), `import` (rollback: bytes back into `content`),
  `gc` (dry run unless `--no-dry-run`; keeps files younger than `--grace-days`, default 7), `copy --from <spec>
  --to <spec> [--concurrency N]` (moves every blob between any two stores; resumable, since a blob the destination
  holds with the same length is skipped; each blob is hashed after reading and a mismatch is reported, never written;
  exits 1 on any problem). `<spec>` is a kind name or the `IMAGE_STORE` JSON. All of these go through the
  `BlobStore` interface, so they work on whatever `IMAGE_STORE` names; `gc` deletes only through `delete`.
- The `content` column is dropped in a later migration, after production has run with bytes off.

### Lists That Change Membership (jupiter)
- `list_token` rows are only ever added, so a token leaves a list only when the list moves to a new
  version. `collect/jupiter.ts` files a new version (patch + 1, `list-membership.ts`) when a feed's
  members differ from the published version, and none when they match. Superseded versions stay for
  the by-address image route.
- A list the run no longer produces (tag below `MIN_LIST_SIZE`, retired tag) gets one empty published
  version. `getLists` serves the newest published version even when empty, and never an unpublished
  one beside a published sibling.
- `pruneSupersededListVersions` (`db/list-versions.ts`) trims versions older than the newest three,
  but never a row that is the only imaged row for its token.
- A feed that fails or answers empty leaves its list alone.

### Top Tokens per Chain (coingecko-top-tokens)
Provider `coingecko-top-tokens`, one list per chain, `top-tokens-<chain id>` (for example
`/list/coingecko-top-tokens/top-tokens-56`). It is a provider of its own, not more lists under
`coingecko`: the full collector keeps its bare-chain-id lists, its unranked order and its ranking
slots, and a separate key lets this one fail, be ranked and be switched off alone. It sits directly
below `coingecko` in `collectable-order.ts`; both serve CoinGecko's own artwork, so it decides no
contested token.
- Sources: `/asset_platforms` (chain id to platform id, through `chain_identifier`), `/coins/list?include_platform=true`
  (address by platform), `/coins/markets?order=market_cap_desc&per_page=250` (rank, name, symbol, logo) and
  `/token_lists/{platform}/all.json` (decimals). A token is a coin with a valid contract address on the chain, in market
  capitalisation order. Native coins have no contract address and never appear. A token missing from the token list is
  stored with decimals 0, the value the full collector uses; an existing token row is never overwritten.
- Market pages are read until every chain has enough tokens, the pages end, or `COINGECKO_TOP_TOKENS_MARKET_PAGES`
  is reached. If a page fails, a chain that already has its full count is filed and every other chain keeps its list.
- Requests per run: 2, plus at most `COINGECKO_TOP_TOKENS_MARKET_PAGES` market pages, plus one token list per chain. With the
  defaults that is at most 39. `coingecko-client.ts` spaces them (12 s keyless, 700 ms Demo, 150 ms Pro, under 5 to 15,
  100 and plan-dependent calls a minute), waits `retry-after` (else 60 s) on a 429, and waits 5 s longer per retry on a
  5xx or dropped connection, up to 5 retries. Every attempt counts against CoinGecko's limit, so it takes its turn first.
- Membership versioning is Jupiter's (`versioned-lists.ts`, shared): same members reuse the version, a change files the next
  one, a chain that fails or answers nothing leaves its list alone, a chain dropped from `COINGECKO_TOP_TOKENS_CHAINS` is
  retired to one empty version, and images go through `fetchImageAndStoreForToken`.
- Settings: `COINGECKO_API_KEY`, `COINGECKO_API_PLAN` (`demo` or Pro, default Pro), `COINGECKO_TOP_TOKENS_COUNT`,
  `_CHAINS`, `_MARKET_PAGES`, `_INTERVAL_MS` (see `docs/skills/self-hosting.md`). The full `coingecko` collector still sends
  any key to the Pro host as a query parameter, which CoinGecko documents for Pro keys only; this collector follows the
  documented Demo and Pro forms.
- Plan: CoinGecko's pages do not state a plan requirement for these endpoints; the Demo documentation lists all four.

### Etherscan collector (API V2)
The old `etherscan` collector scraped explorer pages with a headless browser and was removed. The current
`collect/etherscan.ts` uses the documented Etherscan API V2 under the same provider key `etherscan`, so existing
rows and `/list/etherscan/top-tokens` stay valid (that list is frozen and empty).
- Etherscan has no endpoint that ranks tokens (docs.etherscan.io/endpoint-overview). The collector fetches
  `tokeninfo` for tokens that other providers' lists already rank (`getTopTokenAddresses`, `ETHERSCAN_SOURCE_LISTS`). The default reads the `coingecko-top-tokens` lists
  (`top-tokens-<chain id>`, above) first, then routescan's `top-tokens*` lists; a token both name keeps its earlier place.
  The provider key and list key prefix are constants in `coingecko-top-tokens-settings.ts`, which Etherscan imports.
- `tokeninfo` is API Pro (Standard plan and up), 2 calls per second on every plan; the free plan covers only some
  chains. Nothing assumes what the key may do: discovery runs a probe (`etherscan-capability.ts`), once per run, and
  the collector uses only chain and endpoint pairs that answered `ok`. Others get one log line each, are not
  failures, and are not retried. A free key therefore collects nothing and logs why.
- A refusal in the middle of a chain stops that chain and leaves its published list as it was. Lists are
  `top-tokens-<chainId>`, versioned by membership through `versioned-lists.ts` (shared with Jupiter and `coingecko-top-tokens`).
- `etherscan-response.ts` classifies answers from their text (status 0 with the reason in `message` or `result`);
  tests use the exact refusal strings in `__testing__/etherscan-fixtures.ts`. Add a new refusal there first.
- Operator command: `yarn workspace server run start:etherscan check` prints what the key can use (never the key)
  and exits 1 when no chain can be collected.
- Rank: just below `arbitrum`, below every curated list and aggregator. A precaution, not a measurement; revisit
  once a key that can call `tokeninfo` has produced data.
- The `image` field is the logo. Only an absolute address is kept; a relative one is dropped because its host is
  unknown per chain. This is unverified against live data (no key that can call `tokeninfo` has been available).

### Token List Ordering
- `applyOrder()` in `db/index.ts` — CTE with dense_rank window function
- `dedupe` flag: true = WHERE rank=1 (image endpoints), false = all rows (token lists)
- `sorted` flag: true = ORDER BY ranking (tokensByChain), false = no sort (merged)

### Token Search
`GET /list/search?q=` — `searchTokens()` in `db/index.ts`, handler in `list/handlers.ts`.
- Two stages. The first reads `token`, scores each match by relevance tier and by how many
  list entries carry it, and cuts to the candidate limit. The second resolves the winning
  list entry for the survivors only.
- Both scores must stay in the first stage. Anything applied after the cut is sorting
  whatever the cut kept, which is the bug that made "usdc" answer with a bridged token on
  an obscure chain while USD Coin was never a candidate.
- Final order: relevance tier, then popularity, then provider ranking. Ranking is last of
  the three because it orders providers, not tokens.
- Migration `0016` adds the pg_trgm indexes the substring predicate needs. Without them the
  query falls back to a full scan of `token` — correct, roughly seven times slower, and the
  handler neither tests for them nor changes behaviour.
- The route registers **before** `/:providerKey`, which would otherwise swallow it.

### Documentation Site (`packages/docs`)
A Starlight (Astro) site: guides, a generated endpoint reference, and contributor notes. Production is
`docs.gib.show`, staging is `docs-staging.gib.show`. Run it with `yarn workspace docs dev`.
- **Pages.** Content lives in `packages/docs/src/content/docs/`: `index.mdx` (splash), then one directory per
  sidebar group, in this order: `getting-started/`, `api-reference/`, `list-management/`, `self-hosting/`,
  `contributing/`. Groups fill themselves from their directory. Every page needs `title`, `description` and
  `sidebar: { order: N }` in its frontmatter. The sidebar then adds the generated endpoint reference.
- **Endpoint reference** (`/reference/`). `scripts/generate-openapi.ts` writes `generated/openapi.json` from
  `packages/server/src/server/openapi.ts` on every build and dev start, and `starlight-openapi` renders it. The file is
  not committed, so the reference cannot drift from the code. Adding a route to `openapi.ts` (which CI already
  demands) is all it takes to document it.
- **One source for the old markdown URLs.** `/skills/api-reference.md`, `/skills/list-management.md` and
  `/skills/self-hosting.md` (linked from `/llms.txt`) are not separate documents. After `astro build`,
  `scripts/generate-guides.ts` joins each content directory in sidebar order into one file under
  `packages/docs/dist/skills/`: frontmatter removed, the page title as a `##` heading, page headings one level
  lower, MDX-only syntax removed (see `scripts/guides.ts` for exactly what a page may contain). `docs.ts` serves
  the generated file when it exists and falls back to `docs/skills/*.md`. Edit the pages, never the output. Once the
  pages exist, delete `docs/skills/*.md` so the fallback has nothing left to serve. `docs/terms.md` and `/terms`
  are separate and unchanged.
- **Serving.** No separate container. `server/docs-site.ts` serves `packages/docs/dist` when the request's host
  name is in `DOCS_HOSTNAMES`. On those hosts it answers every request (the site, or the site's own 404 page), so
  the API does not answer there; on every other host it passes the request on, so the site does not answer on
  `gib.show`. `_astro/*` is cached for a year as immutable; HTML is `no-cache`. The setting is matched against the
  `Host` header, so a proxy in front must pass the original host name through. The `Dockerfile` builds the site in its
  own stage and copies only `dist` into the runtime image. Set `DOCS_SITE_URL` at build time for staging
  (`https://docs-staging.gib.show`); it feeds the sitemap, canonical links and the absolute links in the joined guides.
- **Checks.** `yarn workspace docs run check` (types for the scripts and content configuration), `yarn lint` from the
  package, and the `docs` CI job builds the whole site. The build scripts are the only testable code; they sit at
  100% like every other workspace. `packages/docs` is outside the root `tsconfig.json`.

### UI Utils Pattern
Pure functions extracted from components live in `packages/ui/src/lib/utils/`:
- `formatting.ts` — formatBytes, detectImageFormat, buildImageUrlWithSize, truncateAddress, generateRepoName
- `token-search.ts` — searchTokens, scoreTokenMatch, SEARCH_RELEVANCE, getPopularChains, countResults, isCacheHit, parsePathParams (the local filter over an already-loaded chain; the cross-chain search is `hooks/useTokenSearch.ts`)
- `code-output.ts` — shadowToCSS, shapeToCSS, buildImageUrl, buildNetworkUrl
- `list-order.ts` — isDefaultOrder, reorderArray, DEFAULT_PROVIDERS
- `dedup-tokens.ts` — deduplicateTokens, mergeTokenIntoMap

Components import from these — do not re-inline logic that's been extracted.

## CI

Workflow: `.github/workflows/test.yml` — 9 job definitions (lint, typecheck, build, docs, unit-test,
vitest, coverage, browser-test, integration-test). `vitest` and `coverage` are matrices over the
six workspaces and `typecheck` is a matrix over two configurations, so a run reports 20 jobs.
`coverage` fails independently of `vitest`: every test can pass while a threshold breach turns
the run red.

Adding a route means adding it to `openapi.ts` in the same change. `openapi-coverage.test.ts`
scans every router module for its registrations and fails on any path the definition does not
describe, naming the route and the file it came from. It reads the source rather than the
Express router because Express 5 discards mount paths and `image/index.ts` registers via
`router.use`, so a stack walk would find no image endpoint and report success. A new
`router.use` in `routes.ts` also fails it until it is added to that file's `MOUNTS`.

Only `packages/server` and `packages/ui` are type-checked by the `typecheck` job, and `packages/docs` by its own
`docs` job (`yarn workspace docs run check`). Nothing type-checks the other three
workspaces, and `yarn workspace ui run build` is a bare `vite build`, which strips types without
reading them — so the `typecheck` job is the only thing standing between a type error and
master.

### Two TypeScript versions
`typescript` is 6.x and `@typescript/native` (root only) is TypeScript 7. typescript-eslint
loads the classic JavaScript compiler API, which TypeScript 7 does not ship, and its peer range
stops below 6.1 — so lint and the editor run on 6 while every typecheck and build runs 7
through `scripts/tsc7.mjs`. Both packages name their binary `tsc`, and the bare `tsc` link
belongs to 6, so callers go through the runner: the workspace `build` scripts, the CI
`typecheck` and `publish-sdk` steps, and both `Dockerfile` and `Dockerfile.worker` copy the runner
in before building — a new image that runs `yarn run build` must do the same.
A type error that only 7 reports reaches the typecheck, not the editor.

The usual alias trick (`"typescript": "npm:@typescript/typescript6@…"`) fails under Yarn:
its built-in compatibility patch attaches to any dependency named `typescript` and breaks on
that package's different file layout. When typescript-eslint supports TypeScript 7, move
`typescript` to 7, delete `@typescript/native` and the runner, and point callers back at `tsc`.

- `docker-compose.ci.yml` overrides `shm_size: 16g` → `256m` for CI runners
- Integration test: docker compose up postgres + migrate + server, then `yarn run test`
- Lint runs per workspace via `yarn lint` (prettier + eslint), from that
  workspace's directory. The `lint` job runs `packages/server` and `packages/ui`
  as separate steps so a failure names which one broke. The interface was left
  out for a long time and drifted to 187 findings, more than half of them about
  `coverage/` and `dist/` — generated output nobody had told the linter to skip.
- ESLint config: `packages/server/eslint.config.js` (flat config; `packages/ui` has its own) —
  `argsIgnorePattern: '^_'`. Both packages migrated off `.eslintrc` some time ago. The project
  now runs eslint 10, moved up from eslint 9 in 2026-09. Eslint 10 needs Node version 20.19 or
  higher, Node version 22.13 or higher, or Node version 24 or higher; our Node version 24
  satisfies this. Three new rules joined `eslint:recommended` in this release. Two of them,
  `no-useless-assignment` and `preserve-caught-error`, found real issues in
  `packages/server/src/collect/` and `packages/server/src/server/list/handlers.ts` — dead
  variable initializers, and two thrown errors that dropped their original cause. Both are
  fixed in the source, not suppressed. The third new rule, `no-unassigned-vars`, found nothing.
  Changed JSX reference tracking did not surface new findings in `ui` for this codebase.
  `typescript-eslint` moved to a version whose peer range includes eslint 10.

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
