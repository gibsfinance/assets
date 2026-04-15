# CAIP-2 Chain Identifiers — Design Spec

## Goal

Adopt CAIP-2 style chain identifiers (`eip155-369`, `asset-0`) as the canonical format. Bare numeric chain IDs remain accepted at the API boundary for backwards compatibility.

Uses `-` (dash) instead of `:` (colon) for URL safety.

## Format

| Current | CAIP-2 | Notes |
|---------|--------|-------|
| `369` | `eip155-369` | PulseChain |
| `1` | `eip155-1` | Ethereum |
| `56` | `eip155-56` | BSC |
| `0` | `asset-0` | Non-chain assets (countries, icon sets) |

## Conversion utility

New module: `packages/server/src/chain-id.ts`

```ts
toCAIP2("369")          → "eip155-369"
toCAIP2("0")            → "asset-0"
toCAIP2("eip155-369")   → "eip155-369"   // passthrough
toCAIP2("asset-0")      → "asset-0"      // passthrough

fromCAIP2("eip155-369") → "369"           // for DB queries (Phase 1)
fromCAIP2("asset-0")    → "0"
fromCAIP2("369")        → "369"           // bare number passthrough
```

Pure functions, zero dependencies, fully testable.

## Phase 1: API boundary layer

### Changes

1. **Conversion module** — `packages/server/src/chain-id.ts` with `toCAIP2()`, `fromCAIP2()`, tests.

2. **Route validation** — `tokensByChain` handler currently rejects non-numeric chain IDs with 400. Change to accept both bare numbers and CAIP-2 strings. Use `fromCAIP2()` to normalize before DB query.

3. **Response format** — all endpoints that return `chainId` add a `chainIdentifier` field:
   ```json
   { "chainId": 369, "chainIdentifier": "eip155-369", ... }
   ```
   For `asset-0`: `{ "chainId": 0, "chainIdentifier": "asset-0" }`

4. **Image routes** — `/image/:chainId/:address` accepts both `369` and `eip155-369`. Uses `fromCAIP2()` internally.

5. **Stats endpoint** — response includes `chainIdentifier` alongside numeric `chainId`.

6. **Chain 0 support** — remove the `chain_id != '0'` filter in the `merged` handler so asset-0 tokens are accessible.

### What stays the same

- DB schema stays `numeric(78, 0)` — conversion at the edge only
- Collectors unchanged
- UI can adopt `chainIdentifier` at its own pace
- Token list response `chainId` field stays numeric for wallet/dapp compat

## Phase 2: Schema migration

### Changes

1. **Column type** — `network.chain_id`: `numeric(78, 0)` → `text`

2. **Data migration**:
   ```sql
   UPDATE network SET chain_id = 'eip155-' || chain_id WHERE chain_id != '0';
   UPDATE network SET chain_id = 'asset-0' WHERE chain_id = '0';
   ```

3. **Remove `fromCAIP2()` calls** — DB queries use CAIP-2 natively. `fromCAIP2()` only needed at API input (bare number → CAIP-2).

4. **Collectors** — `insertNetworkFromChainId` accepts CAIP-2 strings. Numeric inputs auto-prefixed via `toCAIP2()`.

5. **Schema indexes** — rebuild `network_chainid_index` for text ops instead of numeric_ops.

6. **Drizzle schema** — `chain_id` column type changes from `numeric` to `text`.

### Migration safety

- `IF NOT EXISTS` guards on new indexes
- Backwards-compatible: bare numbers auto-convert at every entry point
- No downtime needed — the conversion is additive

## Testing

- `chain-id.ts` — pure function tests for all conversion cases including edge cases (already CAIP-2, bare 0, negative numbers, non-numeric strings)
- `tokensByChain` handler — test both `/list/tokens/369` and `/list/tokens/eip155-369` return same result
- Stats endpoint — verify `chainIdentifier` field present
- Image routes — verify both formats resolve to same image

## Out of scope

- UI migration to use `chainIdentifier` (can happen independently)
- `network.type` column removal (derivable from namespace prefix, cleanup later)
- Non-EVM namespace registration (solana, cosmos — future when those chains are added)
