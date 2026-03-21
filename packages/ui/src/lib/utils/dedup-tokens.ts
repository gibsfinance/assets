import type { Token, TokenListReference } from '../types'

/**
 * Build an image URI for a token. Accepts an optional prefix so callers
 * can prepend the API base URL (or omit it in tests).
 */
function tokenImageUri(token: Token, prefix = ''): string {
  return `${prefix}/image/${token.chainId}/${token.address}`
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
): Token[] {
  const tokenMap = new Map<string, Token>()

  const addToken = (token: Token) => {
    if (token.chainId.toString() !== selectedChainId) return
    if (!token.hasIcon) return
    const key = `${token.chainId}-${token.address.toLowerCase()}`
    const ref: TokenListReference = {
      sourceList: token.sourceList,
      imageUri: tokenImageUri(token, imageUriPrefix),
      imageFormat: '',
    }
    const existing = tokenMap.get(key)
    if (existing) {
      if (!existing.listReferences) {
        existing.listReferences = [
          {
            sourceList: existing.sourceList,
            imageUri: tokenImageUri(existing, imageUriPrefix),
            imageFormat: '',
          },
        ]
      }
      if (!existing.listReferences.some((r) => r.sourceList === ref.sourceList)) {
        existing.listReferences.push(ref)
      }
    } else {
      tokenMap.set(key, { ...token, listReferences: [ref] })
    }
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
