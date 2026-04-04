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

Tokens are deduplicated by address within a chain. The deduplication happens **client-side** by accumulating tokens from multiple list fetches (StudioBrowser already fetches lists independently and merges them). The `Token` type gains a `listReferences` field:

```typescript
interface TokenListReference {
  sourceList: string           // e.g. 'piteas/exchange'
  imageUri: string             // the image URL from this list
  imageFormat: string          // 'svg', 'png', 'webp', etc. (from content-type header or ext)
}
```

When merging tokens across lists, tokens with the same `address + chainId` are grouped. The primary display uses the first reference with an SVG image, falling back to the first reference by fetch order. All references are stored for the expand view.

When multiple lists reference the same token:

- **Default view**: Show one row with the best image (SVG preferred)
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
- Sub-rows are sorted: SVGs first, then by fetch order

### Pagination Dark Mode

Verify `PaginationControls.tsx` dark mode classes. The component already uses `dark:` variants — if the bug persists, it may be a parent container issue. Investigate and fix the actual cause.

## Sub-Feature 2: List Editor

### Architecture: Sliding Three-Panel Layout

Three panels always exist in the DOM, but only two are visible at a time. The viewport slides horizontally:

```
 off-screen left          ←── viewport ──→         (default)
[List Editor (flex)]  [Browser 380px]  [Studio Canvas (flex)]
```

**Default**: Browser + Studio Canvas visible (current two-panel layout, unchanged).
**Edit mode**: Browser + List Editor visible. Triggered by clicking a list name in the token browser or the `[→]` button in expanded sub-rows.

The browser panel stays at **380px** (matching the current `lg:grid-cols-[380px_1fr]`). The editor and canvas panels each take the remaining viewport width (`flex: 1`).

Implementation: A single flex container with `translateX` animation. The browser panel is always centered. Sliding left reveals the editor, sliding right returns to studio.

#### Mobile

On mobile (`< lg`), the list editor replaces the current tab content. A third tab "Editor" appears in the tab bar when a list is being edited. Closing the editor removes the tab. No horizontal sliding on mobile — tabs handle the navigation.

### List Editor Panel

#### Header
- List name (editable)
- List provider/source badge
- Publish button (GitHub)
- Close button (slides back to studio)

#### Token Table
- Drag-and-drop reorderable rows using `@dnd-kit/core` + `@dnd-kit/sortable` (React 19 compatible, accessible)
- Each row: image thumbnail, name, symbol, address, decimals, actions (remove, resize image)
- Add token: by address (auto-fetches metadata via RPC) or search existing
- Bulk import: paste addresses (one per line)

#### Image Management
- Per-token image: click to upload replacement, resize via the server's `?w=N&h=N` endpoint
- Preview at multiple sizes (32, 64, 128, 256)
- Format indicator (SVG/PNG/WebP/JPG)
- Images stored as remote URLs only (not data URIs) to avoid localStorage size limits
- Uploaded images: convert to a data URI temporarily for preview, but publish as a file in the GitHub repo

#### Metadata from RPC
- Chain selector (viem built-in chains + custom RPC input)
- "Load metadata" button: fetches name, symbol, decimals for all tokens via multicall
- Custom RPC URL stored per chain ID in localStorage
- Uses viem's `readContract` with `erc20Abi` for `name()`, `symbol()`, `decimals()`

### Data Model (Client-Side)

Lists are stored in IndexedDB via a thin wrapper (avoids localStorage's 5-10MB limit for lists with many tokens):

```typescript
interface LocalList {
  id: string                    // uuid
  name: string
  description: string
  tokens: LocalToken[]          // tokens carry their own chainId
  source: LocalListSource
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
  chainId: number               // per-token chain (supports multi-chain lists)
  address: string
  name: string
  symbol: string
  decimals: number
  imageUri?: string             // remote URL (not data URI)
  order: number                 // for drag-and-drop ordering
}
```

**Multi-chain lists**: `chainId` lives on `LocalToken`, not `LocalList`. This supports importing Uniswap-format lists that span multiple chains. The editor's chain selector filters the token view but doesn't restrict the list to a single chain.

### List Creation Flows

1. **From scratch**: "New List" button → empty editor, pick chain, add tokens
2. **Fork existing**: Click `[→]` on a list name → copies remote list to local, opens editor
3. **Import URL**: Paste a token list JSON URL (e.g., CoinGecko, Uniswap format) → fetched, parsed, stored locally
4. **Upload/paste**: Drag a JSON file or paste raw JSON → parsed into local list

### Publishing to GitHub

Standard OAuth web flow with a thin server proxy (GitHub's token exchange endpoint does not support CORS):

1. User clicks "Publish to GitHub"
2. App redirects to GitHub authorization URL (standard web flow)
3. GitHub redirects back with auth code to a callback URL
4. Server proxy at `/api/github/token` exchanges code for access token
5. Access token returned to client, stored in localStorage
6. App creates/updates repo via GitHub API (client-side with token)
7. Confirmation with repo link

The token list JSON follows the [Uniswap Token List](https://tokenlists.org/) standard format for interoperability.

**Server endpoint**: `POST /api/github/token` — accepts `{ code }`, exchanges with GitHub for access token, returns `{ access_token }`. This is the only server-side piece for publishing.

### Editor-Browser Synchronization

When the editor panel is visible alongside the browser:

- **Adding a token**: The browser's token list does NOT update in real-time (the browser shows server data, not local edits). The browser panel is read-only context.
- **Forking a list**: The browser shows the list as "forked" with a badge if it detects a local copy exists.
- **Sliding back to Studio**: Local list state is preserved. Re-opening the editor restores it.
- The editor and browser are independent views — the editor works with local data, the browser shows server data. No real-time sync needed.

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

**Precondition**: All callers of `applyOrder` must join the `image` table before passing the query builder. This is currently true for all callers in `image/handlers.ts` (they join `image` via `getListTokens`). If new callers are added, they must also join `image` or the query will fail. Add a comment in `applyOrder` documenting this dependency.

### Impact

- Tokens with SVG images from any provider will serve the SVG
- No migration needed — this is a query-level change
- The ordering auto-syncs within 60 seconds via `syncDefaultOrder`

## Non-Goals

- Server-side list storage (lists are client-side only, published to GitHub)
- User accounts or authentication (except GitHub OAuth for publishing)
- Real-time collaboration on lists
- List marketplace or discovery
- Server-side image upload (images reference URLs; uploaded images go to GitHub repo)

## Dependencies

- `@dnd-kit/core` + `@dnd-kit/sortable` — drag-and-drop (React 19 compatible)
- `viem` — already in the server, add to UI for RPC metadata loading
- `idb-keyval` — lightweight IndexedDB wrapper (or similar, ~1KB)

## Files Overview

### New Files
- `packages/ui/src/lib/components/ListEditor.tsx` — main editor panel
- `packages/ui/src/lib/components/ListTokenRow.tsx` — editable token row with drag handle
- `packages/ui/src/lib/components/TokenSubRows.tsx` — expanded multi-list reference rows
- `packages/ui/src/lib/hooks/useLocalLists.ts` — IndexedDB CRUD for lists
- `packages/ui/src/lib/hooks/useRpcMetadata.ts` — viem multicall for token metadata
- `packages/ui/src/lib/hooks/useGitHubPublish.ts` — GitHub OAuth + repo push
- `packages/server/src/server/github.ts` — thin proxy for GitHub token exchange

### Modified Files
- `packages/ui/src/lib/components/StudioBrowser.tsx` — new token row layout, deduplication, expand/collapse
- `packages/ui/src/lib/pages/Studio.tsx` — three-panel sliding layout + mobile tab
- `packages/ui/src/lib/types.ts` — add `TokenListReference`, extend `Token`
- `packages/server/src/db/index.ts` — SVG ranking boost in `applyOrder`
- `packages/server/src/server/routes.ts` — mount GitHub proxy route

## Testing

- Unit: `useLocalLists` — CRUD operations, IndexedDB persistence
- Unit: Token deduplication logic — address grouping, SVG preference, sorting
- Unit: SVG ranking boost — verify `applyOrder` query orders SVGs first
- Integration: Three-panel slide animation, panel state preservation
- Integration: GitHub token exchange proxy
- E2E: Create list → add tokens → load RPC metadata → publish to GitHub (mock)
