---
title: Running the server
description: Start commands, plain Node.js mode, Docker, database migrations, monitoring and scaling.
sidebar:
  order: 3
---

## Start commands

From the repository root, `yarn server:dev` starts the server with file watching. From `packages/server`, you have more choices:

| Command | What it runs |
|---------|--------------|
| `yarn dev` | The server with file watching, through `tsx`. |
| `yarn server` | The server once, through `tsx`. |
| `yarn start:server` | The server on plain Node.js. |
| `yarn start:collect` | The collector on plain Node.js. |

`yarn start:server` and `yarn start:collect` run the same thing production runs:

```bash
node --import ./src/bin/register-hooks.ts ./src/bin/server.ts
```

Plain Node.js uses less memory than the `tsx` launcher. Measured at idle in a Linux container, the whole server tree dropped from about 410 MB to about 250 MB. See [Architecture](/contributing/architecture/#running-on-plain-node) for how it works.

## Database migrations

The service uses Drizzle. Migrations run automatically when the server starts. You need no manual step. `yarn db:migrate-latest` runs the same migration outside of server start-up, if you want to apply it ahead of time.

## Docker

```dockerfile
# Build
docker build -t gib-show .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/gibshow \
  gib-show
```

The repository builds two images:

- `Dockerfile` builds the server and the interface.
- `Dockerfile.worker` builds the collector.

Any host that can run containers works. Set the environment variables where you run them.

## The artwork repositories

The collector keeps its artwork repositories (Trust Wallet, SmolDapp, Ethereum Lists, PulseChain assets) current by itself. At the start of every run it fetches the newest commit of each, shallow and sparse. If the network fails, it uses the copy it already has. The image holds a first copy.

To keep the refreshed copy between container restarts, mount a named volume at `/usr/src/app/submodules`. A named volume starts with the image's copy. An empty bind mount starts empty, and the first run clones into it.

Set `REFRESH_SUBMODULES=false` to turn the refresh off. Set `SUBMODULES_DIRECTORY` to keep the repositories somewhere else.

## Monitoring

- `GET /health` returns status 200 with `{"status":"ok"}` when the server is ready, and 503 while it starts.
- Every response carries an `x-response-time` header.
- The server logs the number of pruned image variants every day.
- Collection progress is logged through a terminal view.

To serve the server on your own domain name with encryption, see [Domains and reverse proxies](/self-hosting/domains-and-proxies/).

## Scaling

- **Horizontal.** Several instances can share one PostgreSQL database. Resized variants are cached in the database, so every instance benefits.
- **Content delivery network.** You can put one in front. See [Domains and reverse proxies](/self-hosting/domains-and-proxies/#a-content-delivery-network-or-a-tunnel-in-front). Set cache rules for the `/image/*` paths.
- **Memory.** `sharp` needs about 200 MB to process images. The server itself is light. See [Configuration](/self-hosting/configuration/#runtime-limits) to lower the `sharp` limits on a small host.
