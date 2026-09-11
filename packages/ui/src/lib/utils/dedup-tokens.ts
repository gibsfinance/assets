import type { Token, TokenListReference } from '../types'
import { toChainIdentifier } from './chain-identifier'

/**
 * Build an image URI for a token. Accepts an optional prefix so callers
 * can prepend the API base URL (or omit it in tests).
 */
export function tokenImageUri(token: Token, prefix = ''): string {
  return `${prefix}/image/${toChainIdentifier(token.chainId)}/${token.address}`
}

/**
 * A token that has been through the dedupe, which always knows which lists carry it.
 *
 * The distinction is worth a type. A `Token` read straight from a list has an optional
 * `listReferences`, because a list entry says nothing about the other lists. Every token
 * this module returns has been merged, and merging is the step that answers the question,
 * so the field is no longer optional. Saying that here is what lets callers count the
 * references without a fallback that could never run.
 */
export type MergedToken = Token & { listReferences: TokenListReference[] }

/**
 * Merge a token into the dedup map, appending to the references already recorded there.
 *
 * The map only ever holds merged tokens, so an entry that is present is an entry that
 * already carries its own reference. There is nothing to initialize on the second visit.
 */
export function mergeTokenIntoMap(tokenMap: Map<string, MergedToken>, token: Token, ref: TokenListReference): void {
  const key = `${token.chainId}-${token.address.toLowerCase()}`
  const existing = tokenMap.get(key)
  if (!existing) {
    tokenMap.set(key, { ...token, listReferences: [ref] })
    return
  }
  if (existing.listReferences.some((r) => r.sourceList === ref.sourceList)) return
  existing.listReferences.push(ref)
}

/**
 * Deduplicate tokens across multiple lists for a given chain.
 *
 * Non-bridge lists are processed first so they become the "primary" entry;
 * bridge lists accumulate additional `listReferences` on existing entries.
 *
 * @param tokensByList  Map of list-key to its token array
 * @param enabledLists  Set of currently-enabled list keys
 * @param selectedChainId  Chain ID string to filter on
 * @param imageUriPrefix  Optional prefix prepended to image paths (e.g. API base URL)
 */
export function deduplicateTokens(
  tokensByList: Map<string, Token[]>,
  enabledLists: Set<string>,
  selectedChainId: string,
  imageUriPrefix = '',
): MergedToken[] {
  const tokenMap = new Map<string, MergedToken>()

  const addToken = (token: Token) => {
    if (toChainIdentifier(String(token.chainId)) !== toChainIdentifier(selectedChainId)) return
    if (!token.hasIcon) return
    const ref: TokenListReference = {
      sourceList: token.sourceList,
      imageUri: tokenImageUri(token, imageUriPrefix),
      imageFormat: '',
    }
    mergeTokenIntoMap(tokenMap, token, ref)
  }

  // Non-bridge lists first
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  // Bridge lists second
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || !listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  return Array.from(tokenMap.values())
}
