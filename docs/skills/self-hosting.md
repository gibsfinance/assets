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
| `COINGECKO_API_KEY` | No | CoinGecko API key for token list collection |
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
