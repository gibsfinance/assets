import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))

import { getTopTokenAddresses } from './source-tokens'

beforeEach(() => {
  harness.reset()
})

const rowsOf = (...addresses: string[]) => ({ rows: addresses.map((providedId) => ({ providedId })) })

describe('getTopTokenAddresses', () => {
  it('asks once per selector and binds the provider, network, prefix and limit', async () => {
    harness.queueResult(rowsOf('0xa'))
    harness.queueResult(rowsOf('0xb'))

    await getTopTokenAddresses({
      networkId: 'eip155-1',
      sources: [
        { providerKey: 'coingecko', listKeyPrefix: 'top-tokens' },
        { providerKey: 'routescan', listKeyPrefix: '' },
      ],
      limit: 7,
    })

    expect(harness.queries).toHaveLength(2)
    expect(sqlParams(harness.queries[0].steps[0].args[0])).toEqual([
      'coingecko',
      'eip155-1',
      'eip155-1',
      'top-tokens',
      7,
    ])
    expect(sqlParams(harness.queries[1].steps[0].args[0])).toEqual(['routescan', 'eip155-1', 'eip155-1', '', 7])
  })

  it('reads only the newest published version of a list, ordered by position in the list', async () => {
    harness.queueResult(rowsOf())

    await getTopTokenAddresses({ networkId: 'eip155-1', sources: [{ providerKey: 'p', listKeyPrefix: '' }], limit: 1 })

    const text = renderSql(harness.queries[0].steps[0].args[0]).replace(/\s+/g, ' ')
    expect(text).toMatch(/source_list\.tokens_collected_at IS NOT NULL/)
    expect(text).toMatch(/NOT EXISTS \( SELECT 1 FROM "list" newer WHERE newer\.provider_id = source_list\.provider_id/)
    expect(text).toMatch(/newer\.tokens_collected_at IS NOT NULL/)
    expect(text).toMatch(/starts_with\(source_list\.key, \$\d+\)/)
    expect(text).toMatch(/ORDER BY MIN\(source_entry\.list_token_order_id\)/)
  })

  it('keeps a token at its earliest place when several selectors name it, and stops at the limit', async () => {
    harness.queueResult(rowsOf('0xa', '0xb'))
    harness.queueResult(rowsOf('0xb', '0xc', '0xd'))

    const addresses = await getTopTokenAddresses({
      networkId: 'eip155-1',
      sources: [
        { providerKey: 'one', listKeyPrefix: '' },
        { providerKey: 'two', listKeyPrefix: '' },
      ],
      limit: 3,
    })

    expect(addresses).toEqual(['0xa', '0xb', '0xc'])
  })

  it('returns nothing for no selectors', async () => {
    expect(await getTopTokenAddresses({ networkId: 'eip155-1', sources: [], limit: 5 })).toEqual([])
    expect(harness.queries).toHaveLength(0)
  })
})
