---
title: Contributing overview
description: What Gib.Show is made of, how the repository is laid out, and where to start when you change the code.
sidebar:
  order: 1
---

Gib.Show collects token metadata and images from more than 30 providers. It stores the images with a priority order, and it serves them over an HTTP API with on-the-fly resizing, sprite sheets and edge caching. This section is for people who work on that code. If you only want to use the service, start with [Getting started](/getting-started/overview/).

The code is public at `github.com/gibsfinance/assets`.

## How the parts fit

```
Collectors ──▶ PostgreSQL + image store ◀── Express server ◀── Interface and packages
(30+ providers)   (rows, blobs)             (images, lists)     (browser, npm clients)
```

- **Collectors** read providers and write rows and image bytes. They run on a schedule.
- **The server** reads rows and bytes and answers HTTP requests.
- **The interface** is a React single-page application. It talks to the server.
- **The npm packages** let other applications talk to the server.

## Repository layout

```
packages/
  server/src/
    bin/              Entry points: server, collect, migrate, create-orders, images, etherscan
    collect/          One collector per provider, plus a base class
    db/               Drizzle schema, queries, provider ranking, migrations
    image-store/      Content-addressed blob storage and its adapters
    server/           Express routes: image/, list/, sprite, submissions
    sanitize.ts       Image cleaning (sharp re-encode, vector-image stripping)
    types.ts          Shared server types
  server/drizzle/     Migration files and snapshots
  ui/src/lib/
    pages/            Home, Studio, Docs
    components/       React components
    contexts/         Theme, Settings, Studio, ListEditor
    hooks/            Data and storage hooks
    utils/            Pure functions
  sdk/src/            @gibs/sdk, a client with no runtime dependencies
  react/src/          @gibs/react, React components on top of the client
  utils/src/          @gibs/utils, shared helpers: fetch, viem, logging
  dexscreener/src/    @gibs/dexscreener, an API client and collector
```

| Package | Role |
|---------|------|
| `server` | Express API, collection pipeline and Drizzle storage. It is private. |
| `ui` | The React interface. It is private. Vite builds it, and the server serves it as static files. |
| `@gibs/utils` | Internal and server-only. A workspace dependency. |
| `@gibs/dexscreener` | The client and collector for DexScreener data. |
| `@gibs/sdk` and `@gibs/react` | Published to npm with signed provenance. Pushing a tag that starts with `sdk-v` runs the tests and publishes `@gibs/sdk`, then `@gibs/react`. |

## Technology

| Layer | Technology |
|-------|-----------|
| Server | Node.js 24, Express 5, Drizzle (PostgreSQL), `sharp`, `viem` |
| Interface | React 19, React Router 7 with a hash router, Tailwind CSS 4, Headless UI 2, Vite |
| Clients | TypeScript, with no runtime dependencies in the base client |
| Tests | Vitest, Testing Library, Playwright |

## Where to start

| Task | Where |
|------|-------|
| Add a collector | [Collectors](/contributing/collectors/#add-a-collector) |
| Add an API endpoint | Write the handler in `src/server/`. Register the route in the module's `index.ts` or in `routes.ts`. Add it to `openapi.ts` in the same change. See [Continuous integration](/contributing/continuous-integration/#the-openapi-coverage-test). |
| Change image priority | Reorder entries in `collectables.ts`. See [Collectors](/contributing/collectors/). |
| Add a front-end component | Create it in `ui/src/lib/components/`. Put pure logic in `utils/`. See [Front end](/contributing/front-end/). |
| Change the database | [Database](/contributing/database/) |
| Understand how an image is chosen | [Image serving](/contributing/image-serving/) |

## Before you open a pull request

Run the tests, the coverage run, the lint and the typecheck for every workspace you touched. [Development setup](/contributing/development-setup/) lists the commands. The project requires 100 percent coverage, and a passing test run does not prove a passing coverage run.
