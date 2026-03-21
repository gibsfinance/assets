# List Editor — Design Spec

## Problem

The Studio currently shows tokens as flat rows with no way to manage lists, compare image sources, or create custom token lists. Users need a tool to curate token lists — adding/removing tokens, reordering, resizing images, loading metadata from chains — and publish them to their own GitHub repos. The token browser also needs a layout refresh to show more metadata per row and surface the multiple list references behind each token.

## Scope

This spec covers three sub-features that ship together:

1. **Token row layout refresh** — new two-line layout with address, list name, expandable multi-list references
2. **List Editor UI** — client-side list management with sliding three-panel layout
3. **Server: SVG ranking boost** — prefer SVGs in `applyOrder` ordering

## Sub-Feature 1: Token Row Layout

### Current

```
[icon] [name] [symbol] [address] [info]
```

### New

```
[icon]  Name         0xa107...9a27  [▼ 3] [i]
        WPLS         piteas/exchange
```

- **Top line**: Token name (left), truncated address in monospace (right)
- **Bottom line**: Symbol (left), winning list name in accent color (right)
- **Icon**: 36px circle, skeleton + lazy loaded via `<Image>` component
- **Info button**: Far right, opens TokenDetailModal
- **External image link**: Within the detail modal or expanded row (not on the main row)

### Token Deduplication

Tokens are deduplicated by address within a chain. When multiple lists reference the same token:

- **Default view**: Show one row with the highest-priority image (SVG preferred, then by provider ranking)
- **Expand chevron** `[▼ 3]`: Shows count of lists, click toggles sub-rows:

```
[icon]  Wrapped Pulse    0xa107...9a27  [▲ 3] [i]
        WPLS             piteas/exchange
        ├─ [svg]  piteas/exchange         [↗] [→]
        ├─ [png]  coingecko/pulsechain    [↗] [→]
        └─ [png]  pls369/repo            [↗] [→]
```

- `[↗]` — opens the image URL directly in new tab
- `[→]` — navigates to that list in the list editor (slides panel left)
- Each sub-row shows its own image thumbnail and format badge (svg/png/webp)
- Sub-rows are sorted: SVGs first, then by provider priority

### Pagination Dark Mode Fix

The pagination controls at the bottom of the token browser have black text in dark mode. Fix to use proper dark mode classes.

## Sub-Feature 2: List Editor

### Architecture: Sliding Three-Panel Layout

Three panels always exist in the DOM, but only two are visible at a time. The viewport slides horizontally:

```
 off-screen left          ←── viewport ──→         (default)
[List Editor 1000px]  [Browser 280px]  [Studio Canvas 1000px]
```

**Default**: Browser + Studio Canvas visible (current behavior).
**Edit mode**: Browser + List Editor visible. Triggered by clicking a list name in the token browser or the `[→]` button in expanded sub-rows.

Implementation: A single flex container with `translateX` animation. The browser panel is always centered. Sliding left reveals the editor, sliding right returns to studio.

### List Editor Panel

The 1000px editor panel contains:

#### Header
- List name (editable)
- List provider/source badge
- Publish button (GitHub)
- Close button (slides back to studio)

#### Token Table
- Drag-and-drop reorderable rows
- Each row: image thumbnail, name, symbol, address, decimals, actions (remove, resize image)
- Add token: by address (auto-fetches metadata via RPC) or search existing
- Bulk import: paste addresses (one per line)

#### Image Management
- Per-token image: click to upload replacement, resize via the server's `?w=N&h=N` endpoint
- Preview at multiple sizes (32, 64, 128, 256)
- Format indicator (SVG/PNG/WebP/JPG)

#### Metadata from RPC
- Chain selector (viem built-in chains + custom RPC input)
- "Load metadata" button: fetches name, symbol, decimals for all tokens via multicall
- Custom RPC URL stored per chain ID in localStorage
- Uses viem's `readContract` with `erc20Abi` for `name()`, `symbol()`, `decimals()`

### Data Model (Client-Side)

Lists are stored in localStorage as `gib-lists`:

```typescript
interface LocalList {
  id: string                    // uuid
  name: string
  description: string
  chainId: number
  source: LocalListSource
  tokens: LocalToken[]
  createdAt: string             // ISO timestamp
  updatedAt: string
}

interface LocalListSource {
  type: 'scratch' | 'fork' | 'import' | 'paste'
  remoteProvider?: string       // e.g. 'piteas'
  remoteKey?: string            // e.g. 'exchange'
  remoteUrl?: string            // original JSON URL
}

interface LocalToken {
  address: string
  name: string
  symbol: string
  decimals: number
  imageUri?: string             // custom uploaded image data URI or remote URL
  order: number                 // for drag-and-drop ordering
}
```

### List Creation Flows

1. **From scratch**: "New List" button → empty editor, pick chain, add tokens
2. **Fork existing**: Click `[→]` on a list name → copies remote list to local, opens editor
3. **Import URL**: Paste a token list JSON URL (e.g., CoinGecko, Uniswap format) → fetched, parsed, stored locally
4. **Upload/paste**: Drag a JSON file or paste raw JSON → parsed into local list

### Publishing to GitHub

OAuth flow using GitHub's device flow (no server needed):

1. User clicks "Publish to GitHub"
2. App initiates GitHub device authorization (client-side, using a public OAuth app client ID)
3. User authorizes in browser
4. App creates/updates repo with the list as a standard token list JSON
5. Confirmation with repo link

The token list JSON follows the [Uniswap Token List](https://tokenlists.org/) standard format for interoperability.

GitHub token stored in localStorage, scoped to `public_repo`.

## Sub-Feature 3: SVG Ranking Boost

### Problem

The `applyOrder` function in `db/index.ts` ranks images purely by provider priority. SVGs are resolution-independent and typically higher quality than raster images but may come from a lower-ranked provider.

### Change

In the `denseRank` window function within `applyOrder`, add a sort clause that promotes SVGs:

```sql
ORDER BY
  CASE WHEN image.ext = '.svg' THEN 0 ELSE 1 END ASC,  -- SVGs first
  COALESCE(list_order_item.ranking, 9223372036854775807) ASC,
  list.major DESC,
  list.minor DESC,
  list.patch DESC,
  list_token.listTokenOrderId ASC
```

This means: among all images for a token, SVGs always win regardless of which provider they came from. Within SVGs (or within rasters), provider priority still applies.

### Impact

- Tokens with SVG images from any provider will serve the SVG
- No migration needed — this is a query-level change
- The ordering auto-syncs within 60 seconds via `syncDefaultOrder`

## Non-Goals

- Server-side list storage (lists are client-side only, published to GitHub)
- User accounts or authentication (except GitHub OAuth for publishing)
- Real-time collaboration on lists
- List marketplace or discovery
- Image upload to the server (images reference URLs or are embedded as data URIs)

## Files Overview

### New Files
- `packages/ui/src/lib/components/ListEditor.tsx` — main editor panel
- `packages/ui/src/lib/components/ListTokenRow.tsx` — editable token row with drag handle
- `packages/ui/src/lib/components/TokenSubRows.tsx` — expanded multi-list reference rows
- `packages/ui/src/lib/hooks/useLocalLists.ts` — localStorage CRUD for lists
- `packages/ui/src/lib/hooks/useRpcMetadata.ts` — viem multicall for token metadata
- `packages/ui/src/lib/hooks/useGitHubPublish.ts` — GitHub device flow + repo push

### Modified Files
- `packages/ui/src/lib/components/StudioBrowser.tsx` — new token row layout, deduplication, expand/collapse
- `packages/ui/src/lib/pages/Studio.tsx` — three-panel sliding layout
- `packages/ui/src/lib/components/PaginationControls.tsx` — dark mode fix
- `packages/server/src/db/index.ts` — SVG ranking boost in `applyOrder`

## Testing

- Unit: `useLocalLists` — CRUD operations, localStorage persistence
- Unit: Token deduplication logic — address grouping, SVG preference, sorting
- Unit: `parseResizeParams` already tested, verify SVG ranking in isolation
- Integration: Three-panel slide animation, panel state preservation
- E2E: Create list → add tokens → load RPC metadata → publish to GitHub (mock)
