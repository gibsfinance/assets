# Server-Side Image Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-the-fly image resizing with DB-persisted variants, rate-limited creation, and daily pruning to all `/image/` endpoints.

**Architecture:** New `image_variant` table stores resized image binaries keyed by `(imageHash, width, height, format)`. The resize module in `resize.ts` handles sharp processing, SVG detection, variant lookup/store, and rate limiting. Handlers parse `?w=N&h=N&format=F` query params and call into resize before sending the response. A daily prune job deletes low-access variants.

**Tech Stack:** sharp (image processing), Knex (migration + queries), Express (handlers), PostgreSQL (storage)

**Spec:** `docs/superpowers/specs/2026-03-20-server-image-resize-design.md`

---

### Task 1: Add `sharp` dependency

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: Install sharp**

```bash
cd packages/server && yarn add sharp && yarn add -D @types/sharp
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/server && node -e "const sharp = require('sharp'); console.log('sharp version:', sharp.versions.sharp)"
```

Expected: prints sharp version without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json yarn.lock
git commit -m "deps(server): add sharp for image resizing"
```

---

### Task 2: Database schema — `image_variant` table + type declarations

**Files:**
- Create: `packages/server/src/db/migrations/20260320000000_image_variant.ts`
- Modify: `packages/server/src/db/tables.ts`
- Modify: `packages/server/src/global.d.ts`

- [ ] **Step 1: Add `imageVariant` to `tableNames`**

In `packages/server/src/db/tables.ts`, add to the `tableNames` object:

```typescript
imageVariant: 'image_variant',
```

Add after the `cacheRequest` entry (line 19).

- [ ] **Step 2: Add `ImageVariant` interface to `global.d.ts`**

In `packages/server/src/global.d.ts`, add before the `Tables` interface (before line 161):

```typescript
interface ImageVariant {
  imageHash: string
  width: number
  height: number
  format: string
  content: Buffer
  accessCount: number
  createdAt: Date
  lastAccessedAt: Date
}
interface InsertableImageVariant extends Omit<ImageVariant, 'accessCount' | 'createdAt' | 'lastAccessedAt'> {}
```

Then add to the `Tables` interface:

```typescript
[tableNames.imageVariant]: ImageVariant
```

- [ ] **Step 3: Create migration file**

Create `packages/server/src/db/migrations/20260320000000_image_variant.ts`:

```typescript
import type { Knex } from 'knex'
import userConfig from '../../../config'
import { log } from '../../logger'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.imageVariant)
  if (!exists) {
    log('creating table %o', tableNames.imageVariant)
    await knex.schema.withSchema(userConfig.database.schema).createTable(tableNames.imageVariant, (t) => {
      t.text('imageHash').notNullable().references('imageHash').inTable(`${userConfig.database.schema}.${tableNames.image}`)
      t.integer('width').notNullable()
      t.integer('height').notNullable()
      t.text('format').notNullable()
      t.binary('content').notNullable()
      t.integer('accessCount').notNullable().defaultTo(1)
      t.timestamp('createdAt', { useTz: true, precision: 3 }).defaultTo(knex.fn.now())
      t.timestamp('lastAccessedAt', { useTz: true, precision: 3 }).defaultTo(knex.fn.now())
      t.primary(['imageHash', 'width', 'height', 'format'])
    })
    // Index for the daily prune query
    await knex.schema.withSchema(userConfig.database.schema).table(tableNames.imageVariant, (t) => {
      t.index(['accessCount', 'lastAccessedAt'], 'idx_image_variant_prune')
    })
    // NOTE: Do NOT revoke UPDATE — access_count bumping requires it
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(userConfig.database.schema).dropTableIfExists(tableNames.imageVariant)
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/migrations/20260320000000_image_variant.ts \
       packages/server/src/db/tables.ts \
       packages/server/src/global.d.ts
git commit -m "feat(db): add image_variant table for resized image cache"
```

---

### Task 3: DB query functions for variants

**Files:**
- Modify: `packages/server/src/db/index.ts`

Add four exports to `db/index.ts`, following the existing pattern where all database queries live in this file. Place them near the end of the file, after the `applyOrder` export.

- [ ] **Step 1: Add `getVariant`**

```typescript
export const getVariant = async (
  imageHash: string,
  width: number,
  height: number,
  format: string,
  t: Tx = getDB(),
): Promise<ImageVariant | undefined> => {
  return t(tableNames.imageVariant)
    .where({ imageHash, width, height, format })
    .first()
}
```

- [ ] **Step 2: Add `insertVariant`**

```typescript
export const insertVariant = async (
  variant: InsertableImageVariant,
  t: Tx = getDB(),
): Promise<void> => {
  await t(tableNames.imageVariant)
    .insert(variant)
    .onConflict(['imageHash', 'width', 'height', 'format'])
    .merge({ content: variant.content, lastAccessedAt: t.fn.now() })
}
```

- [ ] **Step 3: Add `bumpVariantAccess`**

```typescript
export const bumpVariantAccess = async (
  imageHash: string,
  width: number,
  height: number,
  format: string,
  t: Tx = getDB(),
): Promise<void> => {
  await t(tableNames.imageVariant)
    .where({ imageHash, width, height, format })
    .increment('accessCount', 1)
    .update({ lastAccessedAt: t.fn.now() })
}
```

Note: Knex `.increment()` produces atomic `SET "access_count" = "access_count" + 1`.

- [ ] **Step 4: Add `pruneVariants`**

```typescript
export const pruneVariants = async (
  minAccessCount: number = 3,
  maxAgeHours: number = 24,
  t: Tx = getDB(),
): Promise<number> => {
  const deleted = await t(tableNames.imageVariant)
    .where('accessCount', '<', minAccessCount)
    .andWhere('lastAccessedAt', '<', t.raw(`NOW() - INTERVAL '${maxAgeHours} hours'`))
    .delete()
  // Reset access counts for surviving variants (rolling window)
  await t(tableNames.imageVariant).update({ accessCount: 0 })
  return deleted
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/index.ts
git commit -m "feat(db): add variant CRUD + prune queries"
```

---

### Task 4: Resize module — core logic

**Files:**
- Create: `packages/server/src/server/image/resize.ts`

This is the core module. It exports a single function `maybeResize()` that handlers call, plus the rate limiter and SVG helpers.

- [ ] **Step 1: Create `resize.ts` with query param parsing and SVG detection**

```typescript
import sharp from 'sharp'
import type { Request, Response } from 'express'
import type { Image, ImageVariant } from 'knex/types/tables'
import * as db from '../../db'
import config from '../../../config'
import { imageMode } from '../../db/tables'

/** Allowed output formats */
const VALID_FORMATS = new Set(['webp', 'png', 'jpg', 'jpeg', 'avif'])

/** Max dimension to prevent abuse */
const MAX_DIM = 2048

export interface ResizeParams {
  w: number | null
  h: number | null
  format: string | null
}

/** Parse and validate w/h/format from Express query string */
export function parseResizeParams(query: Request['query']): ResizeParams | null {
  const wRaw = typeof query.w === 'string' ? parseInt(query.w, 10) : NaN
  const hRaw = typeof query.h === 'string' ? parseInt(query.h, 10) : NaN
  const fRaw = typeof query.format === 'string' ? query.format.toLowerCase() : null

  const w = !isNaN(wRaw) && wRaw >= 1 && wRaw <= MAX_DIM ? wRaw : null
  const h = !isNaN(hRaw) && hRaw >= 1 && hRaw <= MAX_DIM ? hRaw : null
  const format = fRaw && VALID_FORMATS.has(fRaw) ? (fRaw === 'jpeg' ? 'jpg' : fRaw) : null // user-facing: 'jpg'; convert to 'jpeg' for sharp via normalizeFormat()

  if (!w && !h && !format) return null
  return { w, h, format }
}

/** Check if SVG content has a viewBox attribute */
export function svgHasViewBox(content: Buffer): boolean {
  const str = content.toString('utf8', 0, Math.min(content.length, 4096))
  return /viewBox=/i.test(str)
}

/** Map format string to content-type */
export function formatToContentType(format: string): string {
  switch (format) {
    case 'webp': return 'image/webp'
    case 'png': return 'image/png'
    case 'jpg': return 'image/jpeg'
    case 'avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

/** Map file extension to sharp format name */
export function extToFormat(ext: string): string {
  const clean = ext.replace('.', '').toLowerCase()
  if (clean === 'jpg' || clean === 'jpeg') return 'jpeg' // sharp uses 'jpeg' not 'jpg'
  if (clean === 'svg' || clean === 'svg+xml') return 'png' // SVGs rasterize to PNG
  if (['webp', 'png', 'avif'].includes(clean)) return clean
  return 'png' // fallback
}

/** Map user-facing format param to sharp format name */
function normalizeFormat(format: string): string {
  return format === 'jpg' ? 'jpeg' : format
}

/** Map sharp format name to file extension for content-type */
function formatToExt(format: string): string {
  return format === 'jpeg' ? 'jpg' : format
}
```

- [ ] **Step 2: Add rate limiter**

Append to `resize.ts`:

```typescript
/** In-memory rate limiter for variant creation */
const PER_IMAGE_LIMIT = 5
const GLOBAL_LIMIT = 100
const WINDOW_MS = 60_000

interface RateWindow {
  count: number
  windowStart: number
}

const perImageWindows = new Map<string, RateWindow>()
let globalWindow: RateWindow = { count: 0, windowStart: Date.now() }

function cleanExpiredWindows(): void {
  const now = Date.now()
  for (const [key, win] of perImageWindows) {
    if (now - win.windowStart > WINDOW_MS) {
      perImageWindows.delete(key)
    }
  }
}

export function checkRateLimit(imageHash: string): boolean {
  const now = Date.now()

  // Global limit
  if (now - globalWindow.windowStart > WINDOW_MS) {
    globalWindow = { count: 0, windowStart: now }
  }
  if (globalWindow.count >= GLOBAL_LIMIT) return false

  // Per-image limit
  let win = perImageWindows.get(imageHash)
  if (!win || now - win.windowStart > WINDOW_MS) {
    win = { count: 0, windowStart: now }
    perImageWindows.set(imageHash, win)
  }
  if (win.count >= PER_IMAGE_LIMIT) return false

  win.count++
  globalWindow.count++

  // Periodic cleanup
  if (perImageWindows.size > 1000) cleanExpiredWindows()

  return true
}
```

- [ ] **Step 3: Add the main `maybeResize` function**

Append to `resize.ts`:

```typescript
/**
 * Attempt to serve a resized/transcoded variant of the image.
 * Returns true if a variant was served, false if caller should use default sendImage.
 */
export async function maybeResize(
  req: Request,
  res: Response,
  img: Image,
): Promise<boolean> {
  const params = parseResizeParams(req.query)
  if (!params) return false

  const { w, h, format } = params
  const targetFormat = format || extToFormat(img.ext)

  // For LINK-mode images, fetch the remote content
  let content = img.content
  if (img.mode === imageMode.LINK && (!content || content.length === 0)) {
    if (!img.uri || !img.uri.startsWith('http')) return false
    try {
      const fetchRes = await fetch(img.uri, { signal: AbortSignal.timeout(5000) })
      if (!fetchRes.ok) return false
      content = Buffer.from(await fetchRes.arrayBuffer())
    } catch {
      return false
    }
  }

  // SVG with viewBox and no explicit format conversion → serve as-is
  if (img.ext === '.svg' || img.ext === '.svg+xml') {
    if (svgHasViewBox(content) && !format) return false
  }

  // Build the variant key — use original dimensions if only format requested
  let targetW = w
  let targetH = h
  if (!targetW && !targetH) {
    // Format-only conversion: use 0 as sentinel for "original size"
    targetW = 0
    targetH = 0
  }

  // Check for cached variant
  const existing = await db.getVariant(img.imageHash, targetW || 0, targetH || 0, targetFormat)
  if (existing) {
    // Cache hit — bump access and serve
    db.bumpVariantAccess(img.imageHash, targetW || 0, targetH || 0, targetFormat).catch(() => {})
    sendVariant(res, existing, img.uri)
    return true
  }

  // Cache miss — resize with sharp
  let pipeline = sharp(content)

  if (targetW || targetH) {
    const metadata = await pipeline.metadata()
    // Don't upscale: if source is smaller than target, serve original
    if (metadata.width && metadata.height) {
      if ((targetW && metadata.width < targetW) && (targetH && metadata.height < targetH)) {
        // Source smaller than requested in both dimensions
        // Still transcode format if requested, but at original size
        targetW = 0
        targetH = 0
      }
    }

    if (targetW || targetH) {
      pipeline = pipeline.resize(targetW || undefined, targetH || undefined, {
        fit: 'inside',
        withoutEnlargement: true,
      })
    }
  }

  pipeline = pipeline.toFormat(normalizeFormat(targetFormat) as keyof sharp.FormatEnum)

  const resizedBuffer = await pipeline.toBuffer()

  const variantRecord: InsertableImageVariant = {
    imageHash: img.imageHash,
    width: targetW || 0,
    height: targetH || 0,
    format: targetFormat,
    content: resizedBuffer,
  }

  // Persist if under rate limit
  if (checkRateLimit(img.imageHash)) {
    db.insertVariant(variantRecord).catch(() => {})
  }

  // Serve the resized image
  sendVariant(res, {
    ...variantRecord,
    accessCount: 1,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }, img.uri)

  return true
}

function sendVariant(res: Response, variant: ImageVariant, uri?: string): void {
  let r = res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  r = r.set('x-resize', variant.width && variant.height
    ? `${variant.width}x${variant.height}`
    : 'transcoded')
  if (uri) {
    if (uri.startsWith('http') || uri.startsWith('ipfs')) {
      r = r.set('x-uri', uri)
    }
  }
  r.contentType(formatToContentType(variant.format)).send(variant.content)
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server/image/resize.ts
git commit -m "feat(server): add image resize module with sharp, rate limiting, SVG detection"
```

---

### Task 5: Integrate resize into handlers

**Files:**
- Modify: `packages/server/src/server/image/handlers.ts`

The integration point is every place that calls `sendImage()`. We intercept with `maybeResize()` first — if it returns `true`, the response is already sent; if `false`, fall through to existing `sendImage()`.

- [ ] **Step 1: Add import**

At the top of `handlers.ts`, add:

```typescript
import { maybeResize } from './resize'
```

- [ ] **Step 2: Modify `getImage` handler (line 180-191)**

Replace the current `getImage` handler:

```typescript
export const getImage =
  (parseOrder: boolean): RequestHandler =>
  async (req, res, next) => {
    const img = await getListImage(parseOrder)({
      chainId: Number(req.params.chainId),
      address: req.params.address as viem.Hex,
      order: req.params.order,
      providerKey: queryStringToList(req.query.providerKey),
      listKey: queryStringToList(req.query.listKey),
    })
    if (await maybeResize(req, res, img)) return
    sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
  }
```

- [ ] **Step 3: Modify `getImageAndFallback` handler (line 193-211)**

This handler has two fallback paths that both end at the same `sendImage` call (line 211). Add the intercept right before line 211 (`sendImage(res, img, ...)`):

```typescript
if (await maybeResize(req, res, img)) return
sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
```

- [ ] **Step 4: Modify `getImageByHash` handler (line 213-227)**

After the `if (!img)` guard (line 223-225), add before the `sendImage` call (line 226):

```typescript
if (await maybeResize(req, res, img)) return
sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
```

- [ ] **Step 5: Modify `bestGuessNetworkImageFromOnOnChainInfo` handler (line 241-244)**

After getting `img` (line 242), add before `sendImage` (line 243):

```typescript
if (await maybeResize(req, res, img)) return
sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
```

- [ ] **Step 6: Modify `tryMultiple` handler (line 258-304)**

This handler has TWO `sendImage` calls — line 278 (network icon match) and line 301 (token image match). Add `maybeResize` before each:

Line 278:
```typescript
if (await maybeResize(req, res, img)) return
return sendImage(res, img, resolveImageMode(req.query.mode))
```

Line 301:
```typescript
if (await maybeResize(req, res, img)) return
return sendImage(res, img, resolveImageMode(req.query.mode))
```

- [ ] **Step 7: Add `x-resize: original` header to existing `sendImage`**

In `sendImage()` (line 317-334), add after the cache-control header (line 323):

```typescript
r = r.set('x-resize', 'original')
```

This satisfies the spec requirement that non-resized responses also include the header.

- [ ] **Step 8: Typecheck and build**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/server/image/handlers.ts
git commit -m "feat(server): integrate resize into all image handlers"
```

---

### Task 6: Daily prune job

**Files:**
- Modify: `packages/server/src/bin/server.ts`

- [ ] **Step 1: Add prune job to server startup**

Modify `packages/server/src/bin/server.ts` to add the prune interval after the existing periodic refresh:

```typescript
import * as server from '../server'
import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

db.getDB()
  .migrate.latest()
  .then(async () => {
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
    startPeriodicRefresh(keys, manifests, 60_000)

    // Daily variant prune job
    const pruneTimer = setInterval(async () => {
      try {
        const deleted = await db.pruneVariants()
        if (deleted > 0) {
          log('pruned %d image variants', deleted)
        }
      } catch (err) {
        log('variant prune failed: %o', err)
      }
    }, PRUNE_INTERVAL_MS)
    pruneTimer.unref()

    return server.main()
  })
  .catch((err) => {
    console.error(err)
  })
  .then(cleanup)
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bin/server.ts
git commit -m "feat(server): add daily image variant prune job"
```

---

### Task 7: Integration testing

**Files:**
- Create: `packages/server/src/server/image/resize.test.ts` (or alongside existing test files)

- [ ] **Step 1: Write unit tests for `parseResizeParams`**

```typescript
import { describe, it, expect } from 'vitest'
import { parseResizeParams, svgHasViewBox, checkRateLimit } from './resize'

describe('parseResizeParams', () => {
  it('returns null when no resize params', () => {
    expect(parseResizeParams({})).toBeNull()
    expect(parseResizeParams({ providerKey: 'test' })).toBeNull()
  })

  it('parses w only', () => {
    expect(parseResizeParams({ w: '72' })).toEqual({ w: 72, h: null, format: null })
  })

  it('parses h only', () => {
    expect(parseResizeParams({ h: '64' })).toEqual({ w: null, h: 64, format: null })
  })

  it('parses w + h + format', () => {
    expect(parseResizeParams({ w: '72', h: '72', format: 'webp' })).toEqual({ w: 72, h: 72, format: 'webp' })
  })

  it('normalizes jpeg to jpg', () => {
    expect(parseResizeParams({ format: 'jpeg' })).toEqual({ w: null, h: null, format: 'jpg' })
  })

  it('rejects invalid dimensions', () => {
    expect(parseResizeParams({ w: '0' })).toBeNull()
    expect(parseResizeParams({ w: '-1' })).toBeNull()
    expect(parseResizeParams({ w: '9999' })).toBeNull()
    expect(parseResizeParams({ w: 'abc' })).toBeNull()
  })

  it('rejects invalid formats', () => {
    expect(parseResizeParams({ format: 'bmp' })).toBeNull()
    expect(parseResizeParams({ format: 'tiff' })).toBeNull()
  })

  it('parses format only', () => {
    expect(parseResizeParams({ format: 'webp' })).toEqual({ w: null, h: null, format: 'webp' })
  })
})

describe('svgHasViewBox', () => {
  it('detects viewBox attribute', () => {
    expect(svgHasViewBox(Buffer.from('<svg viewBox="0 0 24 24"></svg>'))).toBe(true)
    expect(svgHasViewBox(Buffer.from('<svg ViewBox="0 0 24 24"></svg>'))).toBe(true)
  })

  it('returns false when no viewBox', () => {
    expect(svgHasViewBox(Buffer.from('<svg width="24" height="24"></svg>'))).toBe(false)
  })
})

describe('checkRateLimit', () => {
  it('allows up to 5 inserts per image', () => {
    const hash = 'test-rate-limit-' + Date.now()
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(hash)).toBe(true)
    }
    expect(checkRateLimit(hash)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/server && npx vitest run src/server/image/resize.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/server/image/resize.test.ts
git commit -m "test(server): add unit tests for resize param parsing, SVG detection, rate limiting"
```

---

### Task 8: End-to-end verification

**Files:** None (manual testing)

- [ ] **Step 1: Start the dev server**

```bash
cd packages/server && yarn dev
```

- [ ] **Step 2: Test basic resize**

```bash
# Should return a resized PNG
curl -sI "http://localhost:3000/image/1?w=72&h=72" | grep -iE 'content-type|x-resize|content-length'

# Should return WebP format
curl -sI "http://localhost:3000/image/1?w=72&format=webp" | grep -iE 'content-type|x-resize'

# No params should return original
curl -sI "http://localhost:3000/image/1" | grep -iE 'content-type|x-resize'
```

- [ ] **Step 3: Test format-only conversion**

```bash
curl -sI "http://localhost:3000/image/1?format=webp" | grep -iE 'content-type|x-resize'
```

Expected: `content-type: image/webp`, `x-resize: transcoded`

- [ ] **Step 4: Test SVG passthrough**

Find an SVG image and verify it passes through without resize:

```bash
curl -sI "http://localhost:3000/image/1/0xSOME_SVG_TOKEN?w=72" | grep -iE 'content-type|x-resize'
```

- [ ] **Step 5: Test variant caching**

```bash
# First request — miss, creates variant
curl -s "http://localhost:3000/image/1?w=72&h=72" > /dev/null
# Second request — should be faster (DB hit)
curl -s "http://localhost:3000/image/1?w=72&h=72" > /dev/null
```

- [ ] **Step 6: Verify no regressions**

```bash
# Existing endpoints without resize params should work identically
curl -sI "http://localhost:3000/image/1" | head -5
curl -sI "http://localhost:3000/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27" | head -5
```

- [ ] **Step 7: Full typecheck + build**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 8: Commit any fixes found during E2E testing**

```bash
git add -A && git commit -m "fix(server): address issues found during E2E resize testing"
```
