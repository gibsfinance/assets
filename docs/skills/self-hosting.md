# Self-Hosting Gib.Show

Run your own Gib.Show instance for private token metadata and image serving.

## Requirements

- Node.js 22+ (24 recommended — matches the Docker image)
- PostgreSQL 14+
- Yarn 4 (via corepack)
- ~2GB RAM minimum (sharp image processing)

## Quick Start

```bash
# Clone
git clone https://github.com/gibsfinance/assets.git
cd assets

# Install
corepack enable
yarn install

# Configure
cp .env.example .env
# Edit .env with your database URL and optional API keys

# Run migrations + start server
yarn server:dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: `3000`) |
| `COINGECKO_API_KEY` | No | CoinGecko API key for token list collection. Without it the public host is used, slowly (one request every 12 seconds) |
| `COINGECKO_API_PLAN` | No | `demo` if the key is a free Demo key (sent to the public host in the `x-cg-demo-api-key` header). Any other value, or none, means a Pro key (Pro host, `x-cg-pro-api-key` header). Read by the top-tokens collector only; the full CoinGecko collector sends any key as a Pro key |
| `COINGECKO_TOP_TOKENS_COUNT` | No | Tokens per chain in the `coingecko-top-tokens` lists (default `100`) |
| `COINGECKO_TOP_TOKENS_CHAINS` | No | Comma-separated chain ids that get a `top-tokens-<chain id>` list (default: 1, 10, 25, 56, 100, 137, 250, 288, 369, 1101, 1284, 1285, 2222, 5000, 8453, 42161, 42220, 43114, 59144, 81457, 534352). A chain left out has its list retired on the next run |
| `COINGECKO_TOP_TOKENS_MARKET_PAGES` | No | Most pages of 250 coins, ranked by market capitalisation, a run reads (default `16`) |
| `COINGECKO_TOP_TOKENS_INTERVAL_MS` | No | Gap between CoinGecko requests in milliseconds. Defaults by plan: 12000 without a key, 700 Demo, 150 Pro |
| `GITHUB_OAUTH_CLIENT_ID` | No | GitHub OAuth app client ID (for list publishing) |
| `GITHUB_OAUTH_CLIENT_SECRET` | No | GitHub OAuth app client secret |
| `PUBLIC_BASE_URL` | No | API base URL for the UI (empty = same origin) |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Cloudflare                  │
│              (edge caching)                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Express Server                  │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ /image  │  │  /list   │  │ /networks  │ │
│  │ routes  │  │  routes  │  │   routes   │ │
│  └────┬────┘  └──────────┘  └────────────┘ │
│       │                                      │
│  ┌────▼────┐  ┌──────────┐                  │
│  │  sharp  │  │ Resize   │                  │
│  │ resize  │──│ variant  │                  │
│  └─────────┘  │  cache   │                  │
│               └──────────┘                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              PostgreSQL                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │  image  │  │  token   │  │   list     │ │
│  │ (blobs) │  │          │  │            │ │
│  ├─────────┤  ├──────────┤  ├────────────┤ │
│  │ image_  │  │ list_    │  │  provider  │ │
│  │ variant │  │ token    │  │            │ │
│  └─────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────┘
```

## Collection

The server collects token metadata and images from 30+ providers:

```bash
# Run collection (fetches from all providers)
yarn collect

# Collection runs on a schedule in production
# It discovers token lists, fetches images, and syncs priority ordering
```

### Provider Priority

Image priority is determined by provider order in `packages/server/src/collect/collectables.ts`. SVGs are always preferred over rasters. Higher-ranked providers include:
- `gibs` — custom curated
- `trustwallet` — full-size PNGs
- `smoldapp` — SVGs
- `piteas`, `pls369` — PulseChain-specific

CoinGecko ranks lower but covers the most tokens. The system stores both `/thumb/` (25x25) and `/large/` (250x250) variants.

## Image Resizing

The server supports on-the-fly image resizing via query params:

```
GET /image/{chainId}/{address}?w=72&h=72&as=webp
```

- **sharp** processes the resize
- Results cached in `image_variant` table (survives restarts)
- Rate-limited: 5 new variants/image/min, 100 globally
- Daily prune job removes variants with <3 accesses in 24h
- SVGs pass through when `viewBox` is present

## Image Storage Backends

Image bytes live in a content-addressed store: each blob is named by the sha256 of its bytes. You choose where it
is kept with one setting, `IMAGE_STORE`, and change it without changing code. The server and the collector read
the setting at start-up and stop with a message that names the setting if it is missing or wrong. Both processes
must use the same store.

`IMAGE_STORE` is a kind name, or JSON. The default is `local`.

| Kind | Where blobs live |
|------|------------------|
| `local` | files in a directory |
| `s3` | any S3-compatible bucket: AWS S3, Cloudflare R2, Hetzner Object Storage, Backblaze B2, Wasabi, DigitalOcean Spaces, MinIO, or any endpoint |
| `gcs` | a Google Cloud Storage bucket |
| `azure` | an Azure Blob Storage container |
| `ipfs` | IPFS, written through a pinning service and read through gateways |
| `tiered` | a bounded local cache in front of another store |
| `mirrored` | several stores that each hold every blob |
| `fallback` | one store you write, and one you only read |

### Settings and secrets

A setting that is not a secret can be set in the environment or written in the JSON. The environment name is the
setting's name in capitals with the prefix `IMAGE_STORE_<KIND>_` (for `local`, just `IMAGE_STORE_`). A value in the
JSON wins. A secret (a key, a token, a key file's text) is read from the environment only; the JSON form refuses it.
To use two stores of one kind, give the second a prefix of its own with `"envPrefix"`.

### `local`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_DIR` (`dir`) | `<repository root>/image-store` | directory that holds the store |

### `s3`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_S3_PRESET` (`preset`) | `aws` | `aws`, `r2`, `hetzner`, `b2`, `wasabi`, `spaces`, `minio`, `custom` |
| `IMAGE_STORE_S3_BUCKET` (`bucket`) | required | bucket name |
| `IMAGE_STORE_S3_REGION` (`region`) | per preset | the region requests are signed for |
| `IMAGE_STORE_S3_ENDPOINT` (`endpoint`) | per preset | overrides the preset's endpoint; required for `minio` and `custom` |
| `IMAGE_STORE_S3_ACCOUNT_ID` (`accountId`) | none | `r2` only: your Cloudflare account id |
| `IMAGE_STORE_S3_ADDRESSING` (`addressing`) | per preset | `path` or `virtual` |
| `IMAGE_STORE_S3_PREFIX` (`prefix`) | none | text before every key, for a bucket that holds other things |
| `IMAGE_STORE_S3_ACCESS_KEY_ID` | required, secret | access key id |
| `IMAGE_STORE_S3_SECRET_ACCESS_KEY` | required, secret | secret access key |
| `IMAGE_STORE_S3_SESSION_TOKEN` | none, secret | for temporary credentials |

Presets differ only in endpoint, default region and addressing: `aws` `https://s3.<region>.amazonaws.com`
(virtual); `r2` `https://<account id>.r2.cloudflarestorage.com`, region `auto`; `hetzner`
`https://<region>.your-objectstorage.com`, region `fsn1`; `b2` `https://s3.<region>.backblazeb2.com`, region required
(for example `us-west-004`); `wasabi` `https://s3.<region>.wasabisys.com`; `spaces`
`https://<region>.digitaloceanspaces.com` (virtual), region `nyc3`. Create the bucket first. The credentials need
read, write, delete and list. A 403 answer is treated as an error, not as a missing blob.

### `gcs`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_GCS_BUCKET` (`bucket`) | required | bucket name |
| `IMAGE_STORE_GCS_CREDENTIALS_JSON` | secret | the text of a service-account key file |
| `IMAGE_STORE_GCS_CREDENTIALS_FILE` (`credentialsFile`) | none | path to a service-account key file; use this or the JSON, not both |
| `IMAGE_STORE_GCS_ENDPOINT` (`endpoint`) | Google's | aim at an emulator; with it, no credentials are needed |
| `IMAGE_STORE_GCS_PREFIX` (`prefix`) | none | text before every key |

The service account needs the Storage Object Admin role on the bucket (or the equivalent object rights).

### `azure`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_AZURE_ACCOUNT` (`account`) | required | storage account name |
| `IMAGE_STORE_AZURE_CONTAINER` (`container`) | required | container name; create it first |
| `IMAGE_STORE_AZURE_ACCOUNT_KEY` | secret | account key (Shared Key) |
| `IMAGE_STORE_AZURE_SAS_TOKEN` | secret | a SAS token with read, add, create, write, delete and list; use exactly one of this and the account key |
| `IMAGE_STORE_AZURE_ENDPOINT` (`endpoint`) | `https://<account>.blob.core.windows.net` | for an emulator, include the account in the path |
| `IMAGE_STORE_AZURE_PREFIX` (`prefix`) | none | text before every key |

### `ipfs`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_IPFS_PROVIDER` (`provider`) | required | `kubo` (any node that speaks the Kubo RPC), `filebase`, `pinata` |
| `IMAGE_STORE_IPFS_API_URL` (`apiUrl`) | provider's | pinning API address; required for `kubo` |
| `IMAGE_STORE_IPFS_GATEWAYS` (`gateways`) | provider's | comma-separated gateway addresses ending in `/ipfs/`, tried in order; required for `kubo` |
| `IMAGE_STORE_IPFS_API_TOKEN` | required for `filebase` and `pinata`, secret | bearer token |

sha256 is not an IPFS content identifier (CID), so the table `image_store_cid` (migration 0023) maps one to the
other and records each blob's length and last-write time. Bytes from a gateway are hashed and must match; a gateway
that serves other bytes is skipped. Deleting a blob unpins it. Other IPFS nodes that already hold a copy keep it.

### Composites

```sh
# a 5 GiB local cache in front of S3
IMAGE_STORE='{"type":"tiered","maxBytes":"5GiB","cache":{"type":"local","dir":"/var/cache/images"},"backing":"s3"}'

# every blob in two places; the second store reads its own settings from its own prefix
IMAGE_STORE='{"type":"mirrored","stores":["s3",{"type":"gcs","envPrefix":"IMAGE_STORE_BACKUP_GCS_"}]}'

# staging reads another installation's store without ever writing to it, listing it, or deleting from it
IMAGE_STORE='{"type":"fallback","primary":"local","fallback":{"type":"s3","envPrefix":"IMAGE_STORE_SHARED_S3_"}}'
```

- `tiered` settings: `maxBytes` (a number, or text such as `500MiB`, `5GiB`), `cache`, `backing`. The cache evicts the
  least recently used blobs when it holds more than `maxBytes`. A blob larger than the limit is never cached.
- `mirrored` settings: `stores` (a list), `minimumWrites` (default: all). A write needs that many stores to accept it.
  A mirror does not copy blobs a new member lacks; run `images copy`.
- `fallback` settings: `primary`, `fallback`. Give the fallback credentials that cannot write.

### Moving between stores

```sh
node --import ./src/bin/register-hooks.ts ./src/bin/images.ts copy \
  --from local --to '{"type":"s3","envPrefix":"IMAGE_STORE_NEW_S3_"}'
```

`images copy` works on any two stores, skips blobs the destination already holds, hashes every blob it reads, and
exits 1 if any blob is corrupt, unreadable or refused. Run it again to finish an interrupted copy. `images export`,
`verify`, `import` and `gc` work on whichever store `IMAGE_STORE` names.

## Database Migrations

The service uses Drizzle, not Knex. Migrations run automatically on server start (`db.migrate()` in
`packages/server/src/db/drizzle.ts`). No manual migration step needed — `yarn db:migrate-latest` runs
the same migration outside of server startup, if you need to apply them ahead of time.

## Docker

```dockerfile
# Build
docker build -t gib-show .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/gibshow \
  gib-show
```

## Deployment Notes

- Migrations run when the server starts; a separate migrate step is not needed.
- The images build with the `Dockerfile` (server and interface) and `Dockerfile.worker`
  (collector). Any host that runs containers works; set the environment variables there.
- The collector keeps its artwork repositories (Trust Wallet, SmolDapp, Ethereum Lists, PulseChain assets) current
  by itself: at the start of every run it fetches the newest commit of each, shallow and sparse, and falls back
  to the copy it has if the network fails. The image holds a first copy. To keep the refreshed copy between
  container restarts, mount a named volume at `/usr/src/app/submodules` (a named volume starts with the image's
  copy; an empty bind mount starts empty and the first run clones into it). Set `REFRESH_SUBMODULES=false` to turn
  the refresh off, and `SUBMODULES_DIRECTORY` to keep the repositories somewhere else.

## Monitoring

- `GET /health` — returns `ok`
- `x-response-time` header on all responses
- Server logs variant prune count daily
- Collection progress logged via terminal UI

## Scaling

- **Horizontal**: Multiple instances share the same PostgreSQL. Resize variants are DB-cached, so all instances benefit.
- **Cloudflare**: Put a CDN in front. Set cache rules for `/image/*` paths.
- **Memory**: sharp needs ~200MB for processing. The server itself is lightweight.
