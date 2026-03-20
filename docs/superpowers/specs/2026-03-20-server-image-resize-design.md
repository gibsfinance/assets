# Server-Side Image Resize — Design Spec

## Problem

The `/image/` endpoints serve original-resolution images regardless of how the client displays them. The conveyor belt renders icons at 28-36px CSS (56-72px on Retina) but receives 250x250 PNGs (~15KB each). With 240 icons, that's ~3.6MB of unnecessary data. Additionally, some stored images are 25x25 CoinGecko thumbnails that look fuzzy when upscaled — there's no way to reject them at serve time.

## Goals

1. Serve optimally-sized images via `?w=N&h=N` query params on all `/image/` endpoints
2. Persist resized variants in the database for horizontal scaling and restart survival
3. Prevent griefing (unbounded variant creation) via rate-limited inserts + daily pruning
4. Reject images below a requested size (min-size filter as a side effect)
5. Support explicit format conversion (`?format=webp`) for bandwidth savings
6. SVGs: pass through if `viewBox` present, rasterize to PNG at requested size if not

## Non-Goals

- Client-side resizing or srcset generation
- API key gating for size tiers (future enhancement)
- Replacing the existing image serving path (resize is opt-in via query params)
- CDN-level image optimization (Cloudflare Polish, etc.)

## API Surface

### Query Parameters (added to all `/image/` routes)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `w` | int (1-2048) | — | Target width in pixels |
| `h` | int (1-2048) | — | Target height in pixels |
| `format` | string | original | Output format: `webp`, `png`, `jpg`, or `avif` |

**Behavior:**
- No `w`/`h` → existing behavior, no resize
- `w` only → resize width, height scales proportionally
- `h` only → resize height, width scales proportionally
- `w` + `h` → resize to fit within bounds, preserve aspect ratio (`sharp.resize({ fit: 'inside' })`)
- Source image smaller than requested size → serve original (no upscale)
- `mode=LINK` images (empty buffer) → redirect as-is, ignore resize params
- SVG with `viewBox` → serve SVG as-is (scalable), ignore `w`/`h`
- SVG without `viewBox` → rasterize to PNG at requested size via sharp

### Response Headers

- `x-resize: original` — no resize applied (original served)
- `x-resize: WxH` — resized to these dimensions
- `content-type` — reflects actual output format (may differ from source if `?format=` used)
- `cache-control` — unchanged (`public, max-age=86400`)

## Database Schema

### New Table: `image_variant`

```sql
CREATE TABLE image_variant (
  image_hash      TEXT NOT NULL REFERENCES image(image_hash),
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  format          TEXT NOT NULL,           -- 'webp', 'png', 'jpg', 'avif'
  content         BYTEA NOT NULL,          -- resized binary
  content_length  INTEGER NOT NULL,        -- byte count
  access_count    INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_hash, width, height, format)
);

CREATE INDEX idx_image_variant_prune
  ON image_variant (access_count, last_accessed_at);
```

**Why a separate table:** The `image` table stores canonical source images. Variants are derived, disposable, and potentially numerous. Keeping them separate means the core image pipeline is unaffected and pruning is a single `DELETE` on one table.

## Resize Flow

```
Request: GET /image/1/0xabc?w=72&h=72&format=webp
                     │
                     ▼
          Parse w/h/format from query
                     │
                     ▼
          Run existing image lookup
          (multi-join, applyOrder, etc.)
                     │
                     ▼
          Got Image record?
          ├─ No → 404 (existing behavior)
          └─ Yes ─┐
                   ▼
          mode=LINK? → redirect (ignore resize)
                   │
                   ▼
          SVG with viewBox? → serve as-is
                   │
                   ▼
          Check image_variant table
          (imageHash + w + h + format)
          ├─ HIT → bump access_count + last_accessed_at, send variant
          └─ MISS ─┐
                    ▼
          Rate limit check (5 new inserts/imageHash/min)
          ├─ Over limit → resize on-the-fly, send, don't persist
          └─ Under limit ─┐
                          ▼
          sharp(content).resize(w, h, { fit: 'inside' }).toFormat(format)
                          │
                          ▼
          INSERT into image_variant
                          │
                          ▼
          Send resized content
```

## Anti-Griefing

**Rate-limited variant creation:**
- Max 5 new `image_variant` INSERTs per `imageHash` per minute
- Tracked in-memory (simple Map of `imageHash → { count, windowStart }`)
- Over the limit → resize still happens (on-the-fly), just not persisted
- Legitimate traffic patterns won't hit this — a dapp with 5 sizes creates them over normal request flow

**Daily prune job:**
- Runs every 24 hours (setInterval, like the existing `syncDefaultOrder` refresh)
- Deletes variants where `access_count < 3` AND `last_accessed_at < NOW() - INTERVAL '24 hours'`
- Resets `access_count` to 0 for surviving variants (rolling window)
- Logs count of pruned variants

**Burst tolerance:** A griefer creating thousands of random sizes causes temporary DB growth (up to 24h). At ~5KB average per variant, 10,000 variants = ~50MB — manageable. The prune job clears them all since none get repeat hits.

## Implementation Scope

### Files to Create
- `packages/server/src/db/migrations/YYYYMMDD_image_variant.ts` — new table
- `packages/server/src/server/image/resize.ts` — resize logic, variant lookup/store, rate limiting, SVG detection

### Files to Modify
- `packages/server/src/server/image/handlers.ts` — parse `w`/`h`/`format` query params, call resize before `sendImage()`
- `packages/server/src/bin/server.ts` — start daily prune job
- `packages/server/package.json` — add `sharp` dependency

### Files Unchanged
- `packages/server/src/db/index.ts` — no changes to core image queries
- All UI code — conveyor URLs updated separately after server feature ships

## Dependencies

- `sharp` — image processing (already compiles natively on Railway's Linux containers)
- No other new dependencies

## Testing

- Unit: `resize.ts` — SVG viewBox detection, dimension clamping, rate limit logic
- Integration: request `/image/:chainId/:address?w=72&h=72` and verify response dimensions
- Integration: verify variant is persisted in DB on second request
- Integration: verify rate limit triggers on-the-fly resize without DB write
- Edge cases: SVG passthrough, mode=LINK passthrough, source smaller than requested
