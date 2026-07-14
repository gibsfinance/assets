import { describe, it, expect, vi } from 'vitest'
// ../utils instantiates the Ink terminal renderer at module load, which cannot
// run under vitest. An endlessly-chainable no-op stands in.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import { chainIdToChain } from '@gibs/dexscreener'

import { chainIdToNetworkId, toKeccakBytes } from '../utils'

/**
 * DexScreener names its non-Ethereum-Virtual-Machine chains ('solana', 'ton') and
 * assigns them internal numeric ids (900, 1) that do not correspond to any real
 * chain. The collector must persist them under their Satoshi-Labs-Improvement-Proposal-44
 * CAIP-2 identifiers instead, or the stored network is filed under the wrong
 * namespace (eip155-900 / eip155-1) and its logo can never be served.
 */
describe('DexScreener non-Ethereum-Virtual-Machine chain identifiers', () => {
  it('files Solana under solana-501 (type solana), not its internal id 900', () => {
    const solana = chainIdToChain.get('solana')!
    expect(solana.caip2).toBe('solana-501')
    expect(solana.type).toBe('solana')
  })

  it('files TON under ton-607 (type ton), keeping tvm reserved for Tron', () => {
    const ton = chainIdToChain.get('ton')!
    expect(ton.caip2).toBe('ton-607')
    expect(ton.type).toBe('ton')
  })

  it('produces a servable network_id for each non-EVM chain', () => {
    // What insertNetworkFromChainId(caip2, type) yields via the DB trigger must
    // equal what the serving path computes from the CAIP-2 id alone.
    for (const name of ['solana', 'ton'] as const) {
      const chain = chainIdToChain.get(name)!
      const reference = chain.caip2!.split('-')[1]
      const served = chainIdToNetworkId(chain.caip2!)
      expect(chainIdToNetworkId(chain.caip2!, chain.type)).toBe(served)
      expect(served).toBe(toKeccakBytes(`${chain.type}${reference}`))
    }
  })

  it('leaves Ethereum-Virtual-Machine chains without a caip2 override', () => {
    // EVM chains fall back to their numeric id, which the collector normalizes to
    // eip155-<id>; only non-EVM chains carry an explicit caip2.
    expect(chainIdToChain.get('ethereum')!.caip2).toBeUndefined()
  })
})
