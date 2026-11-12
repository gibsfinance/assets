---
title: Front end
description: The React interface, its pure utility modules, and how first paint and the service worker work.
sidebar:
  order: 10
---

The interface is a React 19 single-page application in `packages/ui`. It uses React Router 7 with a hash router, Tailwind CSS 4 and Headless UI 2. Vite builds it, and the server serves the result as static files.

## Structure

- **Pages:** Home (hero, metrics, network grid, API examples), Studio (three panels: list editor, browser, configurator) and Docs (endpoint cards rendered from the OpenAPI definition).
- **Contexts:** theme, settings, studio and list editor.
- **Hooks:** data and storage hooks such as `useLocalLists`, `useRpcMetadata`, `useVCSPublish` and `useTokenSearch`.
- **Studio layout:** `Studio.tsx` holds the panels. `StudioBrowser.tsx` holds the token list. `StudioConfigurator.tsx` holds the preview and controls.

The interface uses a hash router, so `/docs` and `/studio` need server redirects. A URL fragment never reaches the server.

## Interface utilities

Pure functions that you extract from components live in `packages/ui/src/lib/utils/`:

| Module | Contents |
|--------|----------|
| `formatting.ts` | `formatBytes`, `detectImageFormat`, `buildImageUrlWithSize`, `truncateAddress`, `generateRepoName` |
| `token-search.ts` | `searchTokens`, `scoreTokenMatch`, `SEARCH_RELEVANCE`, `getPopularChains`, `countResults`, `isCacheHit`, `parsePathParams`. This is the local filter over an already loaded chain. The cross-chain search is `hooks/useTokenSearch.ts`. |
| `code-output.ts` | `shadowToCSS`, `shapeToCSS`, `buildImageUrl`, `buildNetworkUrl` |
| `list-order.ts` | `isDefaultOrder`, `reorderArray`, `DEFAULT_PROVIDERS` |
| `dedup-tokens.ts` | `deduplicateTokens`, `mergeTokenIntoMap` |

Components import from these modules. Do not write that logic inline again once it is extracted. To add a utility, add it to the right `utils/*.ts` file and add its tests in `utils/*.test.ts`.

## First paint and the service worker

Return visitors paint from cache. The build removes the two blocking requests.

- **The stylesheet is inline.** The built `index.html` carries its stylesheet inline (`src/prerender/inline-stylesheet.ts`, run by the `inline-stylesheet` plugin in `vite.config.ts`). Font addresses are rewritten to `./assets/...`. The build fails if the stylesheet link is missing. The hashed `.css` file is still emitted, but nothing uses it.
- **`/sw.js` is the service worker** (`src/sw/`).
  - Decisions are pure functions in `worker-logic.ts`.
  - The event wiring in `worker.ts` takes fakes in tests.
  - `sw.ts` only attaches the worker to its scope.
  - It answers navigations to `/` from cache and refreshes in the background. It serves `/assets/*` cache first. It never touches the API, other origins, or requests that are not `GET`.
  - A returning visitor can see the previous version once after a deploy.
  - Raise `CACHE_VERSION` in `worker-logic.ts` to discard every cache.
- **The server sends `sw.js` with `no-cache`** (`static-headers.ts`). Never hash its name, and never cache it.
- **Registration** happens after `load`, in production builds only (`src/sw/register.ts`, called by `main.tsx`).
- **Kill switch.** Build with `VITE_SERVICE_WORKER=off`, and set it as an environment variable in your deploy. The build then ships a `/sw.js` that deletes every cache and unregisters itself, and the page stops registering a worker. Browsers pick it up on their next update check, which they make on each navigation and at least daily. Remove the variable to turn the worker back on.
- **Caching the page in front of the server.** If you put a cache in front of the server, a short lifetime for `/` and `/index.html` lets a new deploy reach first-time visitors quickly. Keep the browser lifetime on the origin's `no-cache`.

The non-home route loader (`src/prerender/route-loader.ts`) is one module of markup and style, so swapping the artwork is a one-file change. A test holds its byte size under a budget.

## The npm packages

`@gibs/sdk` is a client with no runtime dependencies. `@gibs/react` wraps it in components. Both are published to npm with signed provenance. A tag that starts with `sdk-v` runs the tests, then publishes `@gibs/sdk`, then `@gibs/react`.
