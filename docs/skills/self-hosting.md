# Self-Hosting Gib.Show

Run your own Gib.Show instance for private token metadata and image serving.

## Requirements

- Node.js 20+ (24 recommended)
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
| `DATABASE_SCHEMA` | No | Schema name (default: `public`) |
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
GET /image/{chainId}/{address}?w=72&h=72&format=webp
```

- **sharp** processes the resize
- Results cached in `image_variant` table (survives restarts)
- Rate-limited: 5 new variants/image/min, 100 globally
- Daily prune job removes variants with <3 accesses in 24h
- SVGs pass through when `viewBox` is present

## Database Migrations

Migrations run automatically on server start (`db.getDB().migrate.latest()`). No manual migration step needed.

## Docker

```dockerfile
# Build
docker build -t gib-show .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/gibshow \
  gib-show
```

## Railway Deployment

The project is configured for Railway:
- Auto-deploys from `staging` branch
- Migrations run on startup
- sharp compiles natively on Railway's Linux containers
- Set env vars in Railway dashboard

## Monitoring

- `GET /health` — returns `ok`
- `x-response-time` header on all responses
- Server logs variant prune count daily
- Collection progress logged via terminal UI

## Scaling

- **Horizontal**: Multiple instances share the same PostgreSQL. Resize variants are DB-cached, so all instances benefit.
- **Cloudflare**: Put a CDN in front. Set cache rules for `/image/*` paths.
- **Memory**: sharp needs ~200MB for processing. The server itself is lightweight.
