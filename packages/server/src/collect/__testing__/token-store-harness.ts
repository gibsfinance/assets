/**
 * Shared stand-in for the token-storage half of `../db` — `insertToken`,
 * `insertTokenBatch`, `insertListToken`, and `storeToken` — used by collectors
 * that write tokens without going through the image-fetching path that
 * `collector-harness.ts` already models (`omnibridge.ts` and `etherscan.ts`
 * both call `storeToken` directly instead of `fetchImageAndStoreForToken`).
 *
 * Mirrors the identity/upsert semantics of the real functions in `../db`
 * because that behavior is load-bearing for collectors that re-process the
 * same token across multiple runs or multiple bridge directions:
 *
 * - `insertToken` targets the `(network_id, provided_id)` unique constraint;
 *   on conflict only `tokenId` is reassigned (a no-op) — name/symbol/decimals
 *   from a later call are ignored, matching the real `onConflictDoUpdate`.
 * - `insertListToken` targets the `list_token_id` primary key (itself derived
 *   from `(token_id, list_id)`); on conflict `listTokenOrderId` always takes
 *   the new value but `imageHash` is `COALESCE`d so a later run that fetched
 *   no image never clobbers a previously stored one.
 *
 * Real row shapes (timestamps, every column) are not modeled — collectors
 * never read them, same rule `collector-harness.ts` follows.
 */
import { vi, type Mock } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { normalizeProvidedId as realNormalizeProvidedId } from '../../db/provided-id'
import type { InsertableToken, InsertableListToken } from '../../db/schema-types'
import type { DrizzleTx } from '../../db/drizzle'

export type RecordedTokenRow = {
  tokenId: string
  networkId: string
  providedId: string
  name: string
  symbol: string
  decimals: number
}

export type RecordedListTokenRow = {
  listTokenId: string
  tokenId: string
  listId: string
  listTokenOrderId: number
  imageHash: string | null
}

export type TokenStoreState = {
  tokens: Map<string, RecordedTokenRow>
  listTokens: Map<string, RecordedListTokenRow>
}

const tokenKey = (networkId: string, providedId: string) => `${networkId}:${providedId}`
const listTokenKey = (tokenId: string, listId: string) => `${tokenId}:${listId}`

const computeTokenId = (networkId: string, providedId: string) =>
  keccak256(toBytes(`${networkId}${providedId}`)).slice(2)

const computeListTokenId = (tokenId: string, listId: string) => keccak256(toBytes(`${tokenId}${listId}`)).slice(2)

const stripNullBytes = (value: string) => value.split('\x00').join('')

export type TokenStoreHarness = {
  state: TokenStoreState
  insertToken: Mock
  insertTokenBatch: Mock
  insertListToken: Mock
  storeToken: Mock
  reset: () => void
}

/** Builds one independent token-store harness instance. */
export const createTokenStoreHarness = (): TokenStoreHarness => {
  const state: TokenStoreState = { tokens: new Map(), listTokens: new Map() }

  const upsertToken = (token: InsertableToken): RecordedTokenRow => {
    const providedId = realNormalizeProvidedId(token.providedId)
    const key = tokenKey(token.networkId, providedId)
    const existing = state.tokens.get(key)
    if (existing) return existing
    const created: RecordedTokenRow = {
      tokenId: computeTokenId(token.networkId, providedId),
      networkId: token.networkId,
      providedId,
      name: stripNullBytes(token.name ?? ''),
      symbol: stripNullBytes(token.symbol ?? ''),
      decimals: token.decimals ?? 0,
    }
    state.tokens.set(key, created)
    return created
  }

  const insertToken = vi.fn(async (token: InsertableToken, _tx?: DrizzleTx) => upsertToken(token))

  const insertTokenBatch = vi.fn(async (tokens: InsertableToken[], _tx?: DrizzleTx) => tokens.map(upsertToken))

  const upsertListToken = (item: InsertableListToken): RecordedListTokenRow => {
    const key = listTokenKey(item.tokenId, item.listId)
    const existing = state.listTokens.get(key)
    if (existing) {
      existing.listTokenOrderId = item.listTokenOrderId
      existing.imageHash = item.imageHash ?? existing.imageHash
      return existing
    }
    const created: RecordedListTokenRow = {
      listTokenId: computeListTokenId(item.tokenId, item.listId),
      tokenId: item.tokenId,
      listId: item.listId,
      listTokenOrderId: item.listTokenOrderId,
      imageHash: item.imageHash ?? null,
    }
    state.listTokens.set(key, created)
    return created
  }

  const insertListToken = vi.fn(async (listToken: InsertableListToken | InsertableListToken[], _tx?: DrizzleTx) => {
    const items = Array.isArray(listToken) ? listToken : [listToken]
    return items.map(upsertListToken)
  })

  const storeToken = vi.fn(
    async (
      {
        token,
        listId,
        imageHash,
        listTokenOrderId,
      }: { token: InsertableToken; listId: string; imageHash?: string; listTokenOrderId: number },
      tx?: DrizzleTx,
    ) => {
      const insertedToken = await insertToken({ type: 'erc20', ...token }, tx)
      const [listToken] = await insertListToken(
        { tokenId: insertedToken.tokenId, listId, imageHash, listTokenOrderId },
        tx,
      )
      return { token: insertedToken, listToken }
    },
  )

  const reset = () => {
    state.tokens.clear()
    state.listTokens.clear()
  }

  return { state, insertToken, insertTokenBatch, insertListToken, storeToken, reset }
}
