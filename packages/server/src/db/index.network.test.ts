import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

// Static imports (rather than a per-test `await import('./index')`) so the
// module graph loads once during file setup instead of inside a test's own
// timeout budget — see index.order.test.ts for the flakiness this avoids.
import {
  insertNetworkFromChainId,
  setNetworkNaming,
  getChainIdsByReference,
  getListFromId,
  getNetworks,
  getListOrderId,
  getLists,
} from './index'

beforeEach(() => {
  harness.reset()
})

// ---------------------------------------------------------------------------
// insertNetworkFromChainId — validation guards before any query is issued
// ---------------------------------------------------------------------------

describe('insertNetworkFromChainId', () => {
  it('refuses a faked eip155 reference that belongs to a non-Ethereum-Virtual-Machine chain', async () => {
    // 501000101 is Solana echoed as a bare eip155 number by some upstream lists;
    // accepting it would resurrect a duplicate husk network the migrations removed.
    await expect(insertNetworkFromChainId(501000101 as never, 'evm')).rejects.toThrow(/mis-numbered/)
    expect(harness.queries).toHaveLength(0)
  })

  it("refuses a type that disagrees with the chain id's namespace", async () => {
    // A bare numeric id normalizes to eip155-<n>, which only ever carries type
    // 'evm' — filing it under a mismatched type would corrupt the row.
    await expect(insertNetworkFromChainId(1 as never, 'btc')).rejects.toThrow(/conflicts with chain id/)
    expect(harness.queries).toHaveLength(0)
  })

  it('accepts the reserved TEST_NETWORK_TYPE regardless of namespace', async () => {
    harness.queueResult([{ networkId: 'network-1', chainId: 'eip155-7777', type: 'test' }])

    const network = await insertNetworkFromChainId(7777 as never, 'test')

    expect(network).toMatchObject({ chainId: 'eip155-7777' })
    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as { chainId: string }
    expect(row.chainId).toBe('eip155-7777')
  })

  it('normalizes a bare number to its eip155 CAIP-2 form on insert', async () => {
    harness.queueResult([{ networkId: 'network-1', chainId: 'eip155-1', type: 'evm' }])

    await insertNetworkFromChainId(1 as never, 'evm')

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as { chainId: string }
    expect(row.chainId).toBe('eip155-1')
  })
})

// ---------------------------------------------------------------------------
// setNetworkNaming — blank-skipping, per-field write
// ---------------------------------------------------------------------------

describe('setNetworkNaming', () => {
  it('writes nothing when both name and title are blank or whitespace', async () => {
    await setNetworkNaming({ networkId: 'network-1', name: '   ', title: undefined })

    // A blank upstream value must not overwrite a name/title a previous run
    // already stored — skipping the whole update is what preserves it.
    expect(harness.queries).toHaveLength(0)
  })

  it('only sets the fields that were actually provided', async () => {
    harness.queueResult(undefined)

    await setNetworkNaming({ networkId: 'network-1', name: '  Ethereum Mainnet  ', title: undefined })

    const updateQuery = harness.queries.find((query) => query.root === 'update')
    const setStep = updateQuery?.steps.find((step) => step.method === 'set')
    // Trimmed, and title is absent entirely rather than set to undefined/null —
    // an explicit null would read as "upstream says there is no title" and
    // clobber a title a different registry already supplied.
    expect(setStep?.args[0]).toEqual({ name: 'Ethereum Mainnet' })
  })

  it('sets title independently of name when only title is provided', async () => {
    harness.queueResult(undefined)

    await setNetworkNaming({ networkId: 'network-1', name: undefined, title: '  Ethereum Testnet Sepolia  ' })

    const updateQuery = harness.queries.find((query) => query.root === 'update')
    const setStep = updateQuery?.steps.find((step) => step.method === 'set')
    expect(setStep?.args[0]).toEqual({ title: 'Ethereum Testnet Sepolia' })
  })
})

// ---------------------------------------------------------------------------
// getChainIdsByReference
// ---------------------------------------------------------------------------

describe('getChainIdsByReference', () => {
  it('coerces the hasTokens flag to a real boolean for every namespace sharing the reference', async () => {
    harness.queueResult({
      rows: [
        { chainId: 'eip155-501', hasTokens: false },
        { chainId: 'solana-501', hasTokens: true },
      ],
    })

    const result = await getChainIdsByReference('501')

    // A namespace-less request ("501") has to disambiguate between the EVM
    // husk and the real Solana chain by which one actually holds tokens.
    expect(result).toEqual([
      { chainId: 'eip155-501', hasTokens: false },
      { chainId: 'solana-501', hasTokens: true },
    ])
  })
})

// ---------------------------------------------------------------------------
// getListFromId / getNetworks — trivial selects, still worth pinning
// ---------------------------------------------------------------------------

describe('getListFromId', () => {
  it('returns undefined when no list matches the id', async () => {
    harness.queueResult([])

    const result = await getListFromId('missing-list')
    expect(result).toBeUndefined()
  })
})

describe('getNetworks', () => {
  it('returns every stored network row', async () => {
    harness.queueResult([{ networkId: 'network-1' }, { networkId: 'network-2' }])

    const result = await getNetworks()
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// getListOrderId — three resolution strategies over one input
// ---------------------------------------------------------------------------

describe('getListOrderId', () => {
  it('returns null for an empty input without issuing any query', async () => {
    const result = await getListOrderId('')
    expect(result).toBeNull()
    expect(harness.queries).toHaveLength(0)
  })

  it('resolves a friendly key ("default") ahead of treating it as a hex id', async () => {
    harness.queueResult([{ listOrderId: '0xorderid', key: 'default' }])

    const result = await getListOrderId('default')

    expect(result).toBe('0xorderid')
    // Only one query — the key lookup short-circuits before any hex parsing.
    expect(harness.queries).toHaveLength(1)
  })

  it('falls back to a fragment search when the input is not a full 32-byte hex id', async () => {
    harness.queueResult([]) // key lookup misses
    harness.queueResult([{ listOrderId: '0xabc123full' }]) // fragment ilike hits

    const result = await getListOrderId('abc123')

    expect(result).toBe('0xabc123full')
    const fragmentQuery = harness.queries[1]
    const whereStep = fragmentQuery.steps.find((step) => step.method === 'where')
    expect(renderSql(whereStep?.args[0])).toContain('ilike')
    // The fragment search must wrap the input in wildcards, not match it exactly —
    // that is the entire point of accepting a shortened id from a user.
    expect(sqlParams(whereStep?.args[0])).toEqual(['%abc123%'])
  })

  it('resolves a full 32-byte id by direct equality rather than a wildcard scan', async () => {
    const storedId = 'a'.repeat(64)
    harness.queueResult([]) // key lookup misses
    harness.queueResult([{ listOrderId: storedId }])

    const result = await getListOrderId(`0x${storedId}`)

    expect(result).toBe(storedId)
    const whereStep = harness.queries[1].steps.find((step) => step.method === 'where')
    // A complete id needs no scan, and an unanchored ILIKE over every stored id
    // is the expensive way to answer a question the primary key already answers.
    expect(renderSql(whereStep?.args[0])).not.toContain('ilike')
    expect(sqlParams(whereStep?.args[0])).toEqual([storedId])
  })

  it('matches the stored form of an id, which is unprefixed and lowercase', async () => {
    const storedId = 'a'.repeat(64)
    harness.queueResult([])
    harness.queueResult([{ listOrderId: storedId }])

    // Every generator in `ids` slices "0x" off a keccak hash before storing, so
    // a caller-supplied "0x"-prefixed or uppercase id has to be normalized or
    // the equality lookup silently misses a row that is really there.
    const result = await getListOrderId(`0X${'A'.repeat(64)}`)

    expect(result).toBe(storedId)
    const whereStep = harness.queries[1].steps.find((step) => step.method === 'where')
    expect(sqlParams(whereStep?.args[0])).toEqual([storedId])
  })

  it('returns null for input that is not a key and cannot be an id', async () => {
    harness.queueResult([]) // key lookup misses

    const result = await getListOrderId('nonexistent')

    expect(result).toBeNull()
    // Ids are hex, so a non-hex string cannot match one — scanning the table
    // with it would burn a query to prove something already known.
    expect(harness.queries).toHaveLength(1)
  })

  it('returns null when a well-formed id matches no row', async () => {
    harness.queueResult([])
    harness.queueResult([])

    const result = await getListOrderId('b'.repeat(64))
    expect(result).toBeNull()
  })

  it('returns null when a fragment matches no row', async () => {
    harness.queueResult([])
    harness.queueResult([])

    const result = await getListOrderId('abc123')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getLists — default-list lookup with a provider-wide fallback
// ---------------------------------------------------------------------------

describe('getLists', () => {
  it('filters by both provider and list key when a key is given', async () => {
    harness.queueResult([{ list: { key: 'wallet-ethereum' } }])

    await getLists('trustwallet', 'wallet-ethereum')

    const selectQuery = harness.queries[0]
    const whereStep = selectQuery.steps.find((step) => step.method === 'where')
    // Both the provider key and the list key are bound conditions — a caller
    // asking for one provider's specific list must not see another list of
    // the same key from a different provider.
    expect(sqlParams(whereStep?.args[0])).toEqual(['trustwallet', 'wallet-ethereum'])
  })

  it('falls back to any list for the provider when the default list is empty and no key was requested', async () => {
    harness.queueResult([]) // default-list lookup: no rows
    harness.queueResult([{ list: { key: 'legacy' } }]) // fallback: any list for provider

    const result = await getLists('trustwallet', '')

    // Providers that never flagged a list `default: true` must still resolve to
    // something rather than a permanently empty response.
    expect(harness.queries).toHaveLength(2)
    expect(result).toEqual([{ list: { key: 'legacy' } }])
  })

  it('does not fall back when a specific key was requested and returned nothing', async () => {
    harness.queueResult([])

    const result = await getLists('trustwallet', 'nonexistent-key')

    // Falling back here would silently substitute a different list than the one
    // the caller explicitly asked for.
    expect(harness.queries).toHaveLength(1)
    expect(result).toEqual([])
  })
})
