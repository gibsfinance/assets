import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

// countries.ts calls db.insertToken directly, which the shared harness does not
// model (it only stands in for the functions remote/inmemory token-list collectors
// use). Built locally here rather than upstreamed speculatively — see the report.
const { insertToken, readFile } = vi.hoisted(() => ({
  insertToken: vi.fn(async (_token: { symbol: string; name: string }) => undefined),
  readFile: vi.fn(),
}))
vi.mock('../db', () => ({ ...harness.dbModule, insertToken }))
vi.mock('../utils', () => harness.utilsModule)
// The harness's `limitBy` stands in as a bare `(items, fn) => Promise<...>`
// function, but the real `@gibs/utils` `limitBy` returns a `promise-limit`
// instance with a `.map(items, fn)` method — which is how countries.ts (and
// jupiter.ts) actually call it. Worth upstreaming; overridden locally here in
// the meantime. See the report for the exact gap.
vi.mock('@gibs/utils', () => ({
  ...harness.gibsUtilsModule,
  limitBy: <T>(_key: string, _count = 16) => ({
    map: (items: T[], fn: (item: T) => Promise<unknown>) => Promise.all(items.map(fn)),
  }),
}))
vi.mock('fs', () => ({ default: { promises: { readFile } }, promises: { readFile } }))

beforeEach(() => {
  harness.reset()
  insertToken.mockClear()
  readFile.mockReset()
})

import countries, { collect } from './countries'

/**
 * Three fixture countries, each exercising a different branch: a normal flagged
 * country, a flagless one (skipped before ever reaching storage), and one whose
 * image storage fails so the collector's own catch handler runs.
 */
const fixtureCountries = () => [
  { code: 'USD', name: 'US Dollar', countryCode: 'US', country: 'United States', flag: 'data:image/png;base64,AAAA' },
  { code: 'XXX', name: 'No Flag Country', countryCode: 'XX', country: 'Nowhere', flag: '' },
  { code: 'ERR', name: 'Error Country', countryCode: 'ER', country: 'Errland', flag: 'data:image/png;base64,QkJC' },
]

describe('countries collector', () => {
  it('registers the default-chain network, provider, and list during discover()', async () => {
    const manifest = await countries.discover(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['countries'])
    expect(harness.state.lists.map((list) => list.key)).toEqual(['countries'])
    expect(manifest).toEqual([{ providerKey: 'countries', lists: [{ listKey: 'countries' }] }])
  })

  it('stores a token per flagged country, skips flagless ones, and tolerates a per-country storage failure', async () => {
    readFile.mockResolvedValue(JSON.stringify(fixtureCountries()))
    const originalFetchImageAndStoreForToken = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
    harness.dbModule.fetchImageAndStoreForToken.mockImplementation(async (input: { token: { symbol: string } }, tx) => {
      if (input.token.symbol === 'ERR') throw new Error('storage exploded')
      return originalFetchImageAndStoreForToken(input, tx)
    })

    await countries.collect(new AbortController().signal)

    // The flagless country never reaches insertToken or image storage at all.
    expect(insertToken).toHaveBeenCalledTimes(2)
    const insertedSymbols = insertToken.mock.calls.map(([token]) => (token as { symbol: string }).symbol)
    expect(insertedSymbols).toEqual(['USD', 'ERR'])

    // The erroring country's image write is swallowed rather than aborting the run.
    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.symbol).toBe('USD')
  })

  it('stops issuing new work once the signal is already aborted', async () => {
    readFile.mockResolvedValue(JSON.stringify(fixtureCountries()))
    const controller = new AbortController()
    controller.abort()

    await countries.collect(controller.signal)

    expect(insertToken).not.toHaveBeenCalled()
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('exposes a standalone collect() that delegates to the same collector instance', async () => {
    readFile.mockResolvedValue(JSON.stringify(fixtureCountries()))

    await collect(new AbortController().signal)

    expect(insertToken).toHaveBeenCalledTimes(2)
  })
})
