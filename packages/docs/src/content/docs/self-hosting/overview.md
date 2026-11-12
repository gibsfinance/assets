---
title: Self-hosting overview
description: Run your own Gib.Show instance for private token metadata and image serving, with requirements and a quick start.
sidebar:
  order: 1
---

You can run your own Gib.Show instance for private token metadata and image serving. The server, the collector and the interface all live in the public repository at `github.com/gibsfinance/assets`.

## Requirements

- Node.js 22 or later. Node.js 24 is recommended, because it matches the Docker image and the continuous integration runs.
- PostgreSQL 14 or later. The repository's Docker Compose file uses the plain `postgres:16` image.
- Yarn 4, through `corepack`.
- About 2 GB of memory at the least, for image processing with `sharp`.

## Quick start

```bash
# Clone
git clone https://github.com/gibsfinance/assets.git
cd assets

# Install
corepack enable
yarn install

# Start a local database (Docker)
yarn db:up

# Start the server (it applies database migrations when it starts)
yarn server:dev
```

Set `DATABASE_URL` in your shell to point at your database. See [Configuration](/self-hosting/configuration/) for every setting. Without it, the server uses a local default database on port 5876.

The database is empty at first. Run the [collector](/self-hosting/collection/) to fill it:

```bash
yarn collect
```

For a full first-time setup in one command, run `yarn workspace server run setup`. It builds the images, starts the database, runs the migrations, seeds the database, runs a first collection and creates the provider orders.

## Architecture

```
┌─────────────────────────────────────────────┐
│          Content delivery network            │
│        (optional, for edge caching)          │
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
│  │ (rows)  │  │          │  │            │ │
│  ├─────────┤  ├──────────┤  ├────────────┤ │
│  │ image_  │  │ list_    │  │  provider  │ │
│  │ variant │  │ token    │  │            │ │
│  └─────────┘  └──────────┘  └────────────┘ │
└─────────────────────────────────────────────┘
```

Image bytes live in a content-addressed store, which you choose with `IMAGE_STORE`. See [Image storage](/self-hosting/image-storage/).

## Pages in this section

| Page | What it covers |
|------|----------------|
| [Configuration](/self-hosting/configuration/) | Every environment variable |
| [Running the server](/self-hosting/running/) | Start commands, Docker, migrations, monitoring, scaling |
| [Collection](/self-hosting/collection/) | How data gets in, provider priority, the artwork repositories |
| [Etherscan collector](/self-hosting/etherscan-collector/) | Settings and the check command |
| [Image storage](/self-hosting/image-storage/) | Choosing a store and every store setting |
| [Moving between stores](/self-hosting/moving-between-stores/) | Copy, export, verify, import and garbage collection |
| [Image resizing](/self-hosting/image-resizing/) | On-the-fly resizing and its limits |
