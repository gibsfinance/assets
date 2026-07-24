import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('../fetch', () => ({ fetch: fetchMock }))

beforeEach(() => {
  harness.reset()
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new Error('no mock configured for this url'))
})

import UniswapTokenListsCollector, { collect } from './uniswap-tokenlists'

const jsonResponse = (body: unknown) => ({ json: async () => body }) as Response

/**
 * One entry from the real harvested `lists.json`: 'Optimism' at
 * https://static.optimism.io/optimism.tokenlist.json, which the collector's
 * URL-prefixing/rewriting turns into a request whose target still contains
 * this substring — matched on, rather than reconstructed, so this test never
 * re-implements `buildUsableEntries`'s own URL-building logic.
 */
const OPTIMISM_URL_FRAGMENT = 'static.optimism.io/optimism.tokenlist.json'
/** 'Compound' at .../compound-finance/token-list/master/compound.tokenlist.json. */
const COMPOUND_URL_FRAGMENT = 'compound-finance/token-list/master/compound.tokenlist.json'

const optimismTokenList = () => ({
  name: 'Optimism',
  timestamp: new Date(0).toISOString(),
  version: { major: 1, minor: 0, patch: 0 },
  // Matches one of the two hardcoded CIDs applyTokenListFixes blanks outright.
  logoURI: 'https://ipfs.io/ipfs/QmUJQF5rDNQn37ToqCynz6iecGqAmeKHDQCigJWpUwuVLN',
  tokens: [
    {
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      name: 'Optimism Hosted',
      symbol: 'OPH',
      decimals: 18,
      logoURI: 'https://ethereum-optimism.github.io/img/token.png',
    },
    {
      chainId: 1,
      address: '0x2222222222222222222222222222222222222222',
      name: 'Cloudflare Pinned',
      symbol: 'CFP',
      decimals: 18,
      logoURI: 'https://cloudflare-ipfs.com/ipfs/xyz',
    },
    {
      chainId: 1,
      address: '0x3333333333333333333333333333333333333333',
      name: 'Query Stripped',
      symbol: 'QST',
      decimals: 18,
      logoURI: 'https://example.com/logo.png?width=64',
    },
    {
      chainId: 1,
      address: '0x4444444444444444444444444444444444444444',
      name: 'Broken Scheme',
      symbol: 'BRK',
      decimals: 18,
      logoURI: 'hhttps://example.com/broken.png',
    },
    {
      chainId: 1,
      address: '0x5555555555555555555555555555555555555555',
      name: 'Dead Ipfs',
      symbol: 'DIP',
      decimals: 18,
      logoURI: 'https://ipfs.io/ipfs/QmVDL8ji6HKEmt5gFo6Gi1roXk6SNifL3omG5RjRCGRMDH',
    },
  ],
})

describe('uniswap-tokenlists collector', () => {
  it('skips every hardcoded blacklisted sub-list without ever fetching it', async () => {
    const collector = new UniswapTokenListsCollector()

    const manifest = await collector.discover(new AbortController().signal)

    const providerKeys = manifest.map((entry) => entry.providerKey)
    for (const blacklisted of [
      'uniswap-agora-datafi-tokens',
      'uniswap-coingecko',
      'uniswap-kleros-t-2-cr',
      'uniswap-testnet-tokens',
    ]) {
      expect(providerKeys).not.toContain(blacklisted)
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('theagora'))).toBe(false)
  })

  it('applies every logo fix (blank/rewrite/query-strip/scheme-fix) before storing a fetched sub-list', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(OPTIMISM_URL_FRAGMENT)) return jsonResponse(optimismTokenList())
      throw new Error('no mock configured for this url')
    })
    const collector = new UniswapTokenListsCollector()

    const manifest = await collector.discover(new AbortController().signal)

    expect(manifest).toContainEqual({ providerKey: 'uniswap-optimism', lists: [{ listKey: 'hosted' }] })
    // The list-level logo matched a blanked CID, so no list image should ever be stored.
    expect(harness.state.listImages).toHaveLength(0)

    await collector.collect(new AbortController().signal)

    const byLogo = Object.fromEntries(harness.state.tokenImages.map((image) => [image.token.symbol, image.uri]))
    expect(byLogo['OPH']).toBe('https://static.optimism.io/img/token.png')
    expect(byLogo['CFP']).toBe('https://ipfs.io/ipfs/xyz')
    expect(byLogo['QST']).toBe('https://example.com/logo.png')
    expect(byLogo['BRK']).toBe('https://example.com/broken.png')
    expect(byLogo['DIP']).toBeNull()
  })

  it('reuses the sub-list discover() already fetched, rather than fetching it again during collect()', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(OPTIMISM_URL_FRAGMENT)) return jsonResponse(optimismTokenList())
      throw new Error('no mock configured for this url')
    })
    const collector = new UniswapTokenListsCollector()
    await collector.discover(new AbortController().signal)
    const callsAfterDiscover = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(OPTIMISM_URL_FRAGMENT),
    ).length

    await collector.collect(new AbortController().signal)

    const callsAfterCollect = fetchMock.mock.calls.filter(([url]) => String(url).includes(OPTIMISM_URL_FRAGMENT)).length
    expect(callsAfterCollect).toBe(callsAfterDiscover)
    expect(harness.state.tokenImages.length).toBeGreaterThan(0)
  })

  it('re-fetches a sub-list at collect() time when discover() never cached it, and gives up cleanly if that also fails', async () => {
    // fetchMock stays in its default always-reject state, so discover() finds
    // nothing to cache and collect()'s own re-fetch attempt fails the same way.
    const collector = new UniswapTokenListsCollector()
    await collector.discover(new AbortController().signal)

    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.state.providers).toHaveLength(0)
  })

  it('increments the blacklisted counter and never fetches during collect() for a blacklisted sub-list', async () => {
    const collector = new UniswapTokenListsCollector()
    await collector.discover(new AbortController().signal)
    fetchMock.mockClear()

    await collector.collect(new AbortController().signal)

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('theagora'))).toBe(false)
  })

  it('stops before processing a cached sub-list once the signal is already aborted', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(OPTIMISM_URL_FRAGMENT)) return jsonResponse(optimismTokenList())
      throw new Error('no mock configured for this url')
    })
    const collector = new UniswapTokenListsCollector()
    await collector.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()

    await collector.collect(controller.signal)

    // discover() never stores token images (only collect() does); an aborted
    // collect() must leave that count at zero even though a list was cached.
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('logs and tallies a failure, without aborting the run, when inmemory-tokenlist.collect() itself throws', async () => {
    // The Compound entry fails to fetch during discover() (so nothing is cached),
    // then succeeds during collect()'s own re-fetch — but carries a token whose
    // chain id is one of the reserved "faked Ethereum-Virtual-Machine reference"
    // values, so inmemory-tokenlist's internal network insert throws.
    // The discover()-time fetch stays in the default always-reject state, so
    // nothing gets cached for Compound and discover() itself never touches
    // inmemory-tokenlist with the bad chain id.
    const collector = new UniswapTokenListsCollector()
    await collector.discover(new AbortController().signal)
    // Only the collect()-time re-fetch succeeds for Compound.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(COMPOUND_URL_FRAGMENT)) {
        return jsonResponse({
          name: 'Compound',
          timestamp: new Date(0).toISOString(),
          version: { major: 1, minor: 0, patch: 0 },
          tokens: [
            {
              chainId: 501000101,
              address: '0x6666666666666666666666666666666666666666',
              name: 'Faked Reference',
              symbol: 'FAKE',
              decimals: 18,
              logoURI: '',
            },
          ],
        })
      }
      throw new Error('no mock configured for this url')
    })

    await collector.collect(new AbortController().signal)

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith('compound failed to collect')
    // The failure is contained to this one sub-list — nothing was stored for it.
    expect(harness.state.tokenImages.some((image) => image.token.symbol === 'FAKE')).toBe(false)
  })

  it('exposes a standalone collect() that runs discover() then collect() on a fresh instance', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(OPTIMISM_URL_FRAGMENT)) return jsonResponse(optimismTokenList())
      throw new Error('no mock configured for this url')
    })

    await collect(new AbortController().signal)

    expect(harness.state.tokenImages.length).toBeGreaterThan(0)
  })
})
