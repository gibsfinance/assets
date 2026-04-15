# Token Row Layout + SVG Ranking Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Studio token browser rows to show address + list name inline, add expandable multi-list references per token, and boost SVGs in server-side image ordering.

**Architecture:** Extend the `Token` type with `listReferences` for multi-list tracking. Modify the deduplication logic in StudioBrowser to accumulate references across list fetches. Create a `TokenSubRows` component for the expandable detail. Add SVG priority to `applyOrder` in the server.

**Tech Stack:** React 19, Tailwind CSS 4, Knex (server query change)

**Spec:** `docs/superpowers/specs/2026-03-20-list-editor-design.md` (Sub-Features 1 and 3)

---

### Task 1: Extend Token type with multi-list references

**Files:**
- Modify: `packages/ui/src/lib/types.ts`

- [ ] **Step 1: Add `TokenListReference` interface and extend `Token`**

In `packages/ui/src/lib/types.ts`, add after the `Token` interface (line 14):

```typescript
export interface TokenListReference {
  sourceList: string
  imageUri: string
  imageFormat: string // 'svg', 'png', 'webp', 'jpg', etc.
}
```

Then add to the `Token` interface:

```typescript
export interface Token extends TokenInfo {
  hasIcon: boolean
  sourceList: string
  isBridgeToken?: boolean
  chainName?: string
  listReferences?: TokenListReference[]
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/types.ts
git commit -m "feat(ui): add TokenListReference type for multi-list tracking"
```

---

### Task 2: Update token deduplication to accumulate list references

**Files:**
- Modify: `packages/ui/src/lib/components/StudioBrowser.tsx:58-89`

- [ ] **Step 1: Update the `filteredTokens` memo**

The current dedup logic at line 64-88 uses a `Map<string, Token>` and only keeps the first occurrence. Change it to accumulate `listReferences` when the same token appears in multiple lists:

```typescript
const filteredTokens = useMemo(() => {
  if (searchState?.isGlobalSearching && searchState.tokens.length > 0) {
    return searchState.tokens
  }

  const tokenMap = new Map<string, Token>()

  const addToken = (token: Token) => {
    if (token.chainId.toString() !== selectedChainId) return
    if (!token.hasIcon) return
    const key = `${token.chainId}-${token.address.toLowerCase()}`
    const ref: TokenListReference = {
      sourceList: token.sourceList,
      imageUri: getApiUrl(`/image/${token.chainId}/${token.address}?providerKey=${token.sourceList.split('/')[0]}&listKey=${token.sourceList.split('/')[1]}`),
      imageFormat: '', // populated later via content-type if needed
    }
    const existing = tokenMap.get(key)
    if (existing) {
      if (!existing.listReferences) {
        existing.listReferences = [{
          sourceList: existing.sourceList,
          imageUri: getApiUrl(`/image/${token.chainId}/${token.address}`),
          imageFormat: '',
        }]
      }
      // Avoid duplicate list references
      if (!existing.listReferences.some(r => r.sourceList === ref.sourceList)) {
        existing.listReferences.push(ref)
      }
    } else {
      tokenMap.set(key, { ...token, listReferences: [ref] })
    }
  }

  // Non-bridge tokens first
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  // Bridge tokens only if not already present
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || !listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  return Array.from(tokenMap.values())
}, [tokensByList, enabledLists, selectedChainId, searchState])
```

- [ ] **Step 2: Add `TokenListReference` import**

At the top of `StudioBrowser.tsx`, update the types import:

```typescript
import type { Token, TokenListReference } from '../types'
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/components/StudioBrowser.tsx
git commit -m "feat(ui): accumulate multi-list references during token dedup"
```

---

### Task 3: Create TokenSubRows component

**Files:**
- Create: `packages/ui/src/lib/components/TokenSubRows.tsx`

- [ ] **Step 1: Create the component**

```typescript
import Image from './Image'
import type { TokenListReference } from '../types'

interface TokenSubRowsProps {
  references: TokenListReference[]
  chainId: number
  address: string
  onNavigateToList?: (sourceList: string) => void
}

export default function TokenSubRows({ references, chainId, address, onNavigateToList }: TokenSubRowsProps) {
  if (references.length <= 1) return null

  return (
    <div className="ml-12 border-l border-gray-200 pl-3 dark:border-surface-3">
      {references.map((ref, idx) => {
        const isLast = idx === references.length - 1
        return (
          <div
            key={ref.sourceList}
            className="flex items-center gap-2 py-1 text-xs"
          >
            <span className="text-gray-300 dark:text-surface-3">
              {isLast ? '└─' : '├─'}
            </span>
            <Image
              src={ref.imageUri}
              size={16}
              skeleton
              lazy
              shape="circle"
              className="rounded-full"
            />
            <span className="flex-1 truncate text-gray-500 dark:text-white/40">
              {ref.sourceList}
            </span>
            <a
              href={ref.imageUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-accent-500 dark:text-white/30"
              title="Open image"
              onClick={(e) => e.stopPropagation()}
            >
              <i className="fas fa-external-link-alt text-[10px]" />
            </a>
            {onNavigateToList && (
              <button
                type="button"
                className="text-gray-400 hover:text-accent-500 dark:text-white/30"
                title="Open in list editor"
                onClick={(e) => {
                  e.stopPropagation()
                  onNavigateToList(ref.sourceList)
                }}
              >
                <i className="fas fa-arrow-right text-[10px]" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/TokenSubRows.tsx
git commit -m "feat(ui): add TokenSubRows for expandable multi-list references"
```

---

### Task 4: Redesign token row layout in StudioBrowser

**Files:**
- Modify: `packages/ui/src/lib/components/StudioBrowser.tsx:313-384`

- [ ] **Step 1: Add expand state**

Near the top of the StudioBrowser component function, add:

```typescript
const [expandedTokens, setExpandedTokens] = useState<Set<string>>(() => new Set())

const toggleExpand = useCallback((key: string) => {
  setExpandedTokens(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
}, [])
```

Add `useState` to the React import if not already there.

- [ ] **Step 2: Import TokenSubRows**

```typescript
import TokenSubRows from './TokenSubRows'
```

- [ ] **Step 3: Replace the token row markup**

Replace the existing row markup (lines 322-382) with the new two-line layout:

```tsx
return (
  <div key={iconKey}>
    <div
      className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-all ${
        isSelected
          ? 'bg-accent-500/10 shadow-glow-green-subtle ring-1 ring-accent-500/30'
          : 'hover:bg-gray-100 dark:hover:bg-surface-2'
      }`}
      onClick={() => selectToken(token)}
    >
      {/* Icon */}
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
        {hasIcon ? (
          <Image
            src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
            alt={token.symbol}
            className="rounded-full object-contain"
            size={28}
            skeleton
            lazy
            shape="circle"
            onError={() => handleIconError(token)}
          />
        ) : (
          <span className="text-xs font-bold text-gray-300 dark:text-white/30">
            {token.symbol.slice(0, 2)}
          </span>
        )}
      </div>

      {/* Name/Address (top) + Symbol/List (bottom) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
            {token.name}
          </span>
          <span className="flex-shrink-0 font-mono text-[10px] text-gray-400 dark:text-white/30">
            {token.address.slice(0, 6)}...{token.address.slice(-4)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-gray-400 dark:text-white/40">
            {token.symbol}
          </span>
          <span className="truncate text-[10px] text-accent-500/70">
            {token.sourceList}
          </span>
        </div>
      </div>

      {/* Expand chevron (only if multiple lists) */}
      {(token.listReferences?.length ?? 0) > 1 && (
        <button
          type="button"
          className="flex h-6 items-center gap-0.5 rounded px-1 text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-white/30 dark:hover:bg-surface-2 dark:hover:text-white/60"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpand(iconKey)
          }}
          title={`${token.listReferences!.length} lists`}
        >
          <i className={`fas fa-chevron-${expandedTokens.has(iconKey) ? 'up' : 'down'} text-[8px]`} />
          <span>{token.listReferences!.length}</span>
        </button>
      )}

      {/* Info button */}
      <button
        type="button"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-300 opacity-0 transition-all hover:bg-accent-500/10 hover:text-accent-500 group-hover:opacity-100 dark:text-white/20"
        onClick={(e) => {
          e.stopPropagation()
          onInspectToken(token)
        }}
        title="Inspect token"
      >
        <i className="fas fa-info-circle text-sm" />
      </button>
    </div>

    {/* Expanded sub-rows */}
    {expandedTokens.has(iconKey) && token.listReferences && (
      <TokenSubRows
        references={token.listReferences}
        chainId={token.chainId}
        address={token.address}
      />
    )}
  </div>
)
```

- [ ] **Step 4: Remove old `showMetadata` toggle and related code**

The old metadata display (`showMetadata` state, the toggle button, and the conditional metadata lines) are replaced by the new layout which always shows this info. Search for `showMetadata` and remove it.

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/components/StudioBrowser.tsx
git commit -m "feat(ui): redesign token rows with address, list name, expand chevron"
```

---

### Task 5: SVG ranking boost in applyOrder

**Files:**
- Modify: `packages/server/src/db/index.ts:1062-1071`

- [ ] **Step 1: Add SVG priority to the dense rank ordering**

In the `denseRank` callback within `applyOrder` (line 1062), add an SVG-first sort clause before the existing ranking:

```typescript
.denseRank('rank', function denseRankByConfiged() {
  return this.orderBy(
    t.raw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END`) as unknown as string,
    'asc',
  )
    .orderBy(
      t.raw(`COALESCE(${tableNames.listOrderItem}.ranking, 9223372036854775807)`) as unknown as string,
      'asc',
    )
    .orderBy(`${tableNames.list}.major`, 'desc')
    .orderBy(`${tableNames.list}.minor`, 'desc')
    .orderBy(`${tableNames.list}.patch`, 'desc')
    .orderBy(`${tableNames.listToken}.listTokenOrderId`, 'asc')
    .partitionBy([`${tableNames.token}.token_id`, `${tableNames.token}.network_id`])
})
```

- [ ] **Step 2: Add precondition comment**

Above `applyOrder`, add:

```typescript
/**
 * Apply dense-rank ordering to select the top image per token.
 * SVGs are always preferred over raster images regardless of provider ranking.
 *
 * PRECONDITION: The query `q` must already join the `image` table
 * (all callers in image/handlers.ts do this via getListTokens).
 */
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/index.ts
git commit -m "feat(server): boost SVG images in applyOrder ranking"
```

---

### Task 6: Verify and fix pagination dark mode

**Files:**
- Modify: `packages/ui/src/lib/components/PaginationControls.tsx` (if needed)

- [ ] **Step 1: Inspect the component**

Read `PaginationControls.tsx` and check all text/background classes for proper `dark:` variants. The reviewer noted it may already be fixed — verify by checking for any classes missing `dark:` prefixes.

- [ ] **Step 2: Fix any issues found**

Look for parent containers in `StudioBrowser.tsx` around the pagination area (line 389-399) that may be overriding colors.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
npx vite build
```

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add packages/ui/src/lib/components/PaginationControls.tsx packages/ui/src/lib/components/StudioBrowser.tsx
git commit -m "fix(ui): pagination dark mode in Studio browser"
```
