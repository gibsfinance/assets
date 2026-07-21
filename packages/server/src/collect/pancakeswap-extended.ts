import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * PancakeSwap's extended Binance Smart Chain list — a far larger superset of the
 * default list already collected by `pancake` (hundreds of tokens versus a dozen).
 * Kept as its own provider so the curated default can still outrank it.
 */
export default new RemoteTokenListCollector('pancakeswap-extended', {
  providerKey: 'pancakeswap-extended',
  providerName: 'PancakeSwap Extended',
  listKey: 'extended',
  tokenList: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
})
