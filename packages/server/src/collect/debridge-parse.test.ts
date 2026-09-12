import { describe, it, expect } from 'vitest'
import { parseChainList, parseChainTokens, NON_EVM_CHAIN_IDS } from './debridge-parse'

/**
 * A syntactically valid chain entry, as `supported-chains-info` returns it.
 * `chainId` is deBridge's own request number; `originalChainId` is the real
 * chain id. Every field is overridable so a test can break exactly one of
 * them.
 */
const buildChainEntry = (
  overrides: Partial<{ chainId: unknown; originalChainId: unknown; chainName: unknown }> = {},
) => ({
  chainId: 1,
  originalChainId: 1,
  chainName: 'Ethereum',
  ...overrides,
})

describe('parseChainList', () => {
  it('reads the real chain id from originalChainId, and keeps chainId only as the request number', () => {
    // HyperEVM's real chain id is 999. deBridge's own internal number for the
    // same chain is 100000022. Reading chainId as the chain id would create a
    // network row for chain 100000022 - a chain that does not exist - and every
    // HyperEVM token would be filed there instead of under 999, where wallets
    // and explorers actually look for it.
    const raw = { chains: [{ chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' }] }

    const [chain] = parseChainList(raw)

    expect(chain?.chainId).toBe(999)
    expect(chain?.requestId).toBe(100000022)
  })

  it("excludes Solana and Tron by their real chain ids, not by deBridge's request numbers", () => {
    // Tron's real id, 728126428, is the one the chain registry refuses by
    // name - a collector that offered it would be told so on every run.
    // Excluding it here, before the chain ever reaches the database, means
    // that refusal never happens: the question never reaches the database.
    const raw = {
      chains: [
        { chainId: 7565164, originalChainId: 7565164, chainName: 'Solana' },
        { chainId: 100000026, originalChainId: 728126428, chainName: 'Tron' },
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
      ],
    }

    const result = parseChainList(raw)

    expect(result.map((chain) => chain.chainId)).toEqual([1])
    expect(NON_EVM_CHAIN_IDS.has(7565164)).toBe(true)
    expect(NON_EVM_CHAIN_IDS.has(728126428)).toBe(true)
  })

  it('keeps one entry when a chain is repeated in the list', () => {
    const raw = {
      chains: [
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
      ],
    }

    const result = parseChainList(raw)

    expect(result).toHaveLength(1)
  })

  it('drops an entry whose real chain id is missing, fractional, or not positive', () => {
    const raw = {
      chains: [
        buildChainEntry({ chainId: 2, originalChainId: undefined, chainName: 'Missing' }),
        buildChainEntry({ chainId: 3, originalChainId: 4326.5, chainName: 'Fractional' }),
        buildChainEntry({ chainId: 4, originalChainId: 0, chainName: 'Zero' }),
        buildChainEntry({ chainId: 5, originalChainId: -1, chainName: 'Negative' }),
        buildChainEntry({ chainId: 6, originalChainId: 4326, chainName: 'MegaETH' }),
      ],
    }

    const result = parseChainList(raw)

    expect(result.map((chain) => chain.chainId)).toEqual([4326])
  })

  it('drops an entry whose request number is missing or not a whole number', () => {
    // A malformed request number cannot ask the token endpoint for anything,
    // so a chain with one is unusable even though its real chain id is fine.
    const raw = {
      chains: [
        buildChainEntry({ chainId: undefined, originalChainId: 143 }),
        buildChainEntry({ chainId: 100000030.5, originalChainId: 143 }),
        buildChainEntry({ chainId: '100000030', originalChainId: 143 }),
        buildChainEntry({ chainId: 100000030, originalChainId: 143, chainName: 'Monad' }),
      ],
    }

    const result = parseChainList(raw)

    expect(result.map((chain) => chain.requestId)).toEqual([100000030])
  })

  it('skips an entry that is not a record, rather than crashing on one', () => {
    const raw = { chains: [null, 42, 'nonsense', buildChainEntry()] }

    const result = parseChainList(raw)

    expect(result).toHaveLength(1)
  })

  it('names a chain by its real chain number when deBridge sends no chainName', () => {
    const raw = { chains: [{ chainId: 100000031, originalChainId: 4326 }] }

    const [chain] = parseChainList(raw)

    expect(chain?.name).toBe('4326')
  })

  it('yields an empty list, without throwing, when the body is not an object or chains is not an array', () => {
    expect(parseChainList(null)).toEqual([])
    expect(parseChainList(42)).toEqual([])
    expect(parseChainList('nonsense')).toEqual([])
    expect(parseChainList({})).toEqual([])
    expect(parseChainList({ chains: 'not an array' })).toEqual([])
  })
})

describe('parseChainTokens', () => {
  it('files every token under the chain id it is given, never under a value found on the token record', () => {
    // A deBridge token record carries no chain of its own. A parser that read
    // one anyway - by habit, or by copying a shape from another source - would
    // file the token under whatever number happened to sit there, not under
    // the chain this response was actually fetched for.
    const raw = {
      tokens: {
        '0xabc': { address: '0xabc', name: 'Token', symbol: 'TKN', decimals: 18, chainId: 999999 },
      },
    }

    const result = parseChainTokens(raw, 1)

    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0]?.chainId).toBe(1)
  })

  it('keeps a token that declares zero decimals, rather than rewriting it to eighteen', () => {
    // Ethereum alone carries thirty-seven zero-decimal tokens in the live feed.
    // A silent rewrite to eighteen would misprice every one of them by
    // eighteen orders of magnitude: a balance of one token would read as
    // 0.000000000000000001.
    const raw = {
      tokens: {
        '0xabc': { address: '0xabc', name: 'Zero Decimal Token', symbol: 'ZERO', decimals: 0 },
      },
    }

    const result = parseChainTokens(raw, 1)

    expect(result.tokens[0]?.decimals).toBe(0)
  })

  it('rejects a token with unreadable decimals, no symbol, or no address, with a counted reason, rather than repairing it', () => {
    const raw = {
      tokens: {
        a: { address: '0xa', name: 'Bad Decimals', symbol: 'BAD', decimals: -1 },
        b: { address: '0xb', name: 'No Symbol', decimals: 18 },
        c: { name: 'No Address', symbol: 'NOADDR', decimals: 18 },
        d: 'not an object',
      },
    }

    const result = parseChainTokens(raw, 1)

    expect(result.tokens).toHaveLength(0)
    expect(result.rejected).toEqual({
      'decimals outside 0 to 255': 1,
      'no symbol': 1,
      'no address': 1,
      'not an object': 1,
    })
  })

  it("reads the address from the record's own address field, not the object key it is stored under", () => {
    const raw = {
      tokens: {
        '0xkeycasing': { address: '0xRecordCasing', name: 'Token', symbol: 'TKN', decimals: 18 },
      },
    }

    const result = parseChainTokens(raw, 1)

    expect(result.tokens[0]?.address).toBe('0xRecordCasing')
  })

  it('yields no tokens, without throwing, when tokens is missing or not an object', () => {
    expect(parseChainTokens({}, 1)).toEqual({ tokens: [], rejected: {} })
    expect(parseChainTokens({ tokens: 'not an object' }, 1)).toEqual({ tokens: [], rejected: {} })
    expect(parseChainTokens({ tokens: [] }, 1)).toEqual({ tokens: [], rejected: {} })
    expect(parseChainTokens(null, 1)).toEqual({ tokens: [], rejected: {} })
    expect(parseChainTokens(42, 1)).toEqual({ tokens: [], rejected: {} })
  })
})
