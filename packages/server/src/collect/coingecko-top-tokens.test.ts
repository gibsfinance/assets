import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
// The harness's `limitBy` is a bare function; the collector calls `.map(items, fn)` on a
// `promise-limit` style instance, and a mid-run abort must be seen by later items.
vi.mock('@gibs/utils', () => ({
  ...harness.gibsUtilsModule,
  limitBy: <T>(_key: string, count = 16) => ({
    map: async (items: T[], fn: (item: T) => Promise<unknown>) => {
      let nextIndex = 0
      const worker = async () => {
        while (nextIndex < items.length) {
          const current = nextIndex
          nextIndex += 1
          await fn(items[current]!)
        }
      }
      await Promise.all(Array.from({ length: Math.min(count, items.length) }, worker))
    },
  }),
}))

import defaultInstance, {
  CoinGeckoTopTokensCollector,
  MIN_LIST_SIZE,
  matchChainsToPlatforms,
  topTokensListKey,
  walkMarketPages,
} from './coingecko-top-tokens'
import type { CoinGeckoClient } from './coingecko-client'
import { MARKETS_PAGE_SIZE } from './coingecko-top-tokens-settings'

/** Recorded shape of `/asset_platforms` rows (extra fields kept, as the live answer has them). */
const platformRows = [
  { id: 'ethereum', chain_identifier: 1, name: 'Ethereum', shortname: '', native_coin_id: 'ethereum' },
  {
    id: 'binance-smart-chain',
    chain_identifier: 56,
    name: 'BNB Smart Chain',
    shortname: 'BSC',
    native_coin_id: 'binancecoin',
  },
  { id: 'solana', chain_identifier: null, name: 'Solana', shortname: '', native_coin_id: 'solana' },
]

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

/** The address a fixture coin has on a platform: unique per coin and platform. */
const addressOn = (coinIndex: number, platformId: string) =>
  address(coinIndex * 10 + (platformId === 'ethereum' ? 1 : 2))

type Fixture = {
  /** Coins in market-capitalisation order. */
  coinCount: number
  /** Platforms every coin below `cutoff` is on. */
  platformCutoffs: Record<string, number>
}

const coinId = (index: number) => `coin-${index}`

const marketRow = (index: number) => ({
  id: coinId(index),
  symbol: `c${index}`,
  name: `Coin ${index}`,
  image: `https://coin-images.example.test/${index}.png`,
  current_price: 1,
  market_cap: 1_000_000 - index,
  market_cap_rank: index + 1,
})

const coinListRows = ({ coinCount, platformCutoffs }: Fixture) =>
  Array.from({ length: coinCount }, (_, index) => ({
    id: coinId(index),
    symbol: `c${index}`,
    name: `Coin ${index}`,
    platforms: Object.fromEntries(
      Object.entries(platformCutoffs)
        .filter(([, cutoff]) => index < cutoff)
        .map(([platformId]) => [platformId, addressOn(index, platformId)]),
    ),
  }))

/** Market pages of at most 250 rows, in rank order. */
const marketPages = (coinCount: number): unknown[][] => {
  const rows = Array.from({ length: coinCount }, (_, index) => marketRow(index))
  const pages: unknown[][] = []
  for (let start = 0; start < rows.length; start += MARKETS_PAGE_SIZE) {
    pages.push(rows.slice(start, start + MARKETS_PAGE_SIZE))
  }
  return pages
}

type World = {
  platforms?: unknown
  coinList?: unknown
  /** One entry per page; `null` makes that page fail. */
  pages?: (unknown[] | null)[]
  tokenLists?: Record<string, unknown>
}

/** A client that answers from a world of recorded-shape documents and records every request. */
const makeClient = (world: World, onRequest: (path: string, query: Record<string, unknown>) => void = () => {}) => {
  const requests: string[] = []
  const client: CoinGeckoClient = {
    getJson: async (path, query) => {
      requests.push(path === '/coins/markets' ? `${path}?page=${query.page}` : path)
      onRequest(path, query)
      if (path === '/asset_platforms') return world.platforms ?? platformRows
      if (path === '/coins/list') return world.coinList ?? null
      if (path === '/coins/markets') return world.pages?.[Number(query.page) - 1] ?? null
      const platformId = path.split('/')[2]!
      return world.tokenLists?.[platformId] ?? null
    },
  }
  return { client, requests }
}

const baseEnv = { COINGECKO_TOP_TOKENS_CHAINS: '1,56', COINGECKO_TOP_TOKENS_COUNT: '6' }

const collectorFor = (client: CoinGeckoClient, env: Record<string, string> = {}) =>
  new CoinGeckoTopTokensCollector({ env: { ...baseEnv, ...env }, createClient: () => client })

const runOnce = async (world: World, env: Record<string, string> = {}, signal = new AbortController().signal) => {
  const { client, requests } = makeClient(world)
  const collector = collectorFor(client, env)
  const manifest = await collector.discover(signal)
  await collector.collect(signal)
  return { manifest, requests }
}

const healthy = (overrides: Partial<Fixture> = {}): World => {
  const fixture: Fixture = {
    coinCount: 8,
    platformCutoffs: { ethereum: 8, 'binance-smart-chain': 6 },
    ...overrides,
  }
  return { coinList: coinListRows(fixture), pages: marketPages(fixture.coinCount) }
}

const listsFor = (listKey: string) => harness.state.lists.filter((list) => list.key === listKey)

const servedMembers = async (listKey: string): Promise<string[]> => {
  const { providerId } = harness.state.providers[0]!
  const { published } = await harness.dbModule.getListVersionSnapshot({ providerId, listKey })
  // The harness records a repeated store of one version twice; the database upserts it once.
  return published ? [...new Set<string>(published.providedIds)].sort() : []
}

const versionOf = (list: { major: number; minor: number; patch: number }) => `${list.major}.${list.minor}.${list.patch}`

beforeEach(() => {
  harness.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('topTokensListKey', () => {
  it('follows the routescan naming with the numeric chain id', () => {
    expect(topTokensListKey(56)).toBe('top-tokens-56')
  })
})

describe('matchChainsToPlatforms', () => {
  it('maps configured chain ids to platforms through chain_identifier, in configured order', () => {
    const { targets, missing } = matchChainsToPlatforms(platformRows, [56, 1, 999])

    expect(targets.map((target) => [target.chainId, target.platformId, target.platformName])).toEqual([
      [56, 'binance-smart-chain', 'BNB Smart Chain'],
      [1, 'ethereum', 'Ethereum'],
    ])
    expect(missing).toEqual([999])
  })

  it('ignores unreadable rows, non-EVM platforms and a second platform on the same chain', () => {
    const { targets, missing } = matchChainsToPlatforms(
      [
        null,
        { id: 5, chain_identifier: 1 },
        { id: 'no-chain', chain_identifier: null },
        { id: 'solana', chain_identifier: 5 },
        { id: 'first', chain_identifier: 7, name: '' },
        { id: 'second', chain_identifier: 7, name: 'Second' },
      ],
      [1, 5, 7],
    )

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ chainId: 7, platformId: 'first', platformName: 'first' })
    expect(missing).toEqual([1, 5])
  })

  it('finds nothing in a document that is not an array', () => {
    expect(matchChainsToPlatforms({ status: { error_code: 429 } }, [1])).toEqual({ targets: [], missing: [1] })
  })
})

describe('walkMarketPages', () => {
  const walk = (
    pages: (unknown[] | null)[],
    options: { pageLimit?: number; filledAt?: number; signal?: AbortSignal } = {},
  ) =>
    walkMarketPages({
      client: makeClient({ pages }).client,
      signal: options.signal ?? new AbortController().signal,
      pageLimit: options.pageLimit ?? 10,
      isFilled: (coins) => coins.length >= (options.filledAt ?? Infinity),
    })

  it('stops when a page is short: the ranking has ended', async () => {
    const result = await walk([marketPages(300)[0]!, marketPages(300)[1]!])
    expect(result.end).toBe('exhausted')
    expect(result.coins).toHaveLength(300)
  })

  it('stops as soon as every chain is filled', async () => {
    const result = await walk(marketPages(1000), { filledAt: 250 })
    expect(result.end).toBe('filled')
    expect(result.coins).toHaveLength(250)
  })

  it('stops at the page limit', async () => {
    const result = await walk(marketPages(1000), { pageLimit: 2 })
    expect(result.end).toBe('exhausted')
    expect(result.coins).toHaveLength(500)
  })

  it('reports a failed page, keeping the coins read before it', async () => {
    const result = await walk([marketPages(500)[0]!, null])
    expect(result.end).toBe('failed')
    expect(result.coins).toHaveLength(250)
  })

  it('reports an abort', async () => {
    const controller = new AbortController()
    controller.abort()
    expect((await walk(marketPages(500), { signal: controller.signal })).end).toBe('aborted')
  })
})

describe('CoinGeckoTopTokensCollector', () => {
  it('files one ranked list per chain, with decimals from the token list and the market logo', async () => {
    const world = healthy()
    world.tokenLists = {
      ethereum: {
        tokens: [
          { chainId: 1, address: addressOn(0, 'ethereum'), decimals: 6, logoURI: 'https://list.example.test/0.png' },
        ],
      },
    }

    const { manifest, requests } = await runOnce(world)

    expect(manifest).toEqual([
      {
        providerKey: 'coingecko-top-tokens',
        lists: [
          { listKey: 'top-tokens-1', listId: expect.any(String) },
          { listKey: 'top-tokens-56', listId: expect.any(String) },
        ],
      },
    ])
    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['coingecko-top-tokens'])
    expect(harness.state.lists.map((list) => list.name)).toEqual([
      'CoinGecko: top tokens on Ethereum',
      'CoinGecko: top tokens on BNB Smart Chain',
    ])
    // 6 of the 8 coins make the Ethereum list, in market-capitalisation order.
    const ethereumList = listsFor('top-tokens-1')[0]!
    const ethereumImages = harness.state.tokenImages.filter((image) => image.listId === ethereumList.listId)
    expect(ethereumImages.map((image) => image.token.providedId)).toEqual(
      [0, 1, 2, 3, 4, 5].map((index) => addressOn(index, 'ethereum')),
    )
    expect(ethereumImages.map((image) => image.listTokenOrderId)).toEqual([0, 1, 2, 3, 4, 5])
    expect(ethereumImages[0]).toMatchObject({
      providerKey: 'coingecko-top-tokens',
      uri: 'https://coin-images.example.test/0.png',
      token: { name: 'Coin 0', symbol: 'c0', decimals: 6 },
    })
    // Not in the token list: decimals fall back to 0.
    expect(ethereumImages[1]!.token.decimals).toBe(0)
    expect(requests).toEqual([
      '/asset_platforms',
      '/coins/list',
      '/coins/markets?page=1',
      '/token_lists/ethereum/all.json',
      '/token_lists/binance-smart-chain/all.json',
    ])
    expect(harness.state.networks.has('eip155-1')).toBe(true)
    expect(harness.state.networks.has('eip155-56')).toBe(true)
  })

  it('reads one market page when it already holds enough tokens for every chain', async () => {
    const world = healthy({ coinCount: 300, platformCutoffs: { ethereum: 300, 'binance-smart-chain': 300 } })

    const { requests } = await runOnce(world, { COINGECKO_TOP_TOKENS_COUNT: '10' })

    expect(requests.filter((request) => request.startsWith('/coins/markets'))).toEqual(['/coins/markets?page=1'])
  })

  it('reads further pages until a scarce chain is filled', async () => {
    // The BNB chain only has coins past rank 250, so a second page is needed.
    const fixture = { coinCount: 400, platformCutoffs: { ethereum: 400, 'binance-smart-chain': 400 } }
    const coinList = coinListRows(fixture).map((row, index) =>
      index < 250 ? { ...row, platforms: { ethereum: row.platforms.ethereum } } : row,
    )

    const { requests } = await runOnce({ coinList, pages: marketPages(400) }, { COINGECKO_TOP_TOKENS_COUNT: '10' })

    expect(requests.filter((request) => request.startsWith('/coins/markets'))).toEqual([
      '/coins/markets?page=1',
      '/coins/markets?page=2',
    ])
    expect(await servedMembers('top-tokens-56')).toHaveLength(10)
  })

  it('stops at the page limit and lists what the pages held', async () => {
    const world = healthy({ coinCount: 600, platformCutoffs: { ethereum: 600, 'binance-smart-chain': 3 } })

    const { requests } = await runOnce(world, {
      COINGECKO_TOP_TOKENS_MARKET_PAGES: '2',
      COINGECKO_TOP_TOKENS_COUNT: '10',
    })

    expect(requests.filter((request) => request.startsWith('/coins/markets'))).toHaveLength(2)
    // BNB had only three coins: below the minimum, so no list. Ethereum is full.
    expect(listsFor('top-tokens-56')).toHaveLength(0)
    expect(await servedMembers('top-tokens-1')).toHaveLength(10)
  })

  it('still files a list when the token list for decimals cannot be fetched', async () => {
    const { manifest } = await runOnce(healthy())

    expect(manifest[0]!.lists).toHaveLength(2)
    expect(harness.state.tokenImages.every((image) => image.token.decimals === 0)).toBe(true)
  })

  it('files no new version when the top tokens are unchanged, and one when they change', async () => {
    await runOnce(healthy())
    await runOnce(healthy())
    expect(listsFor('top-tokens-1').map(versionOf)).toEqual(['0.0.0'])

    // A different coin enters the BNB top six; another leaves.
    const changed = healthy({ platformCutoffs: { ethereum: 8, 'binance-smart-chain': 7 } })
    const coinList = (changed.coinList as ReturnType<typeof coinListRows>).map((row, index) =>
      index === 0 ? { ...row, platforms: { ethereum: row.platforms.ethereum } } : row,
    )
    await runOnce({ ...changed, coinList })

    expect(listsFor('top-tokens-56').map(versionOf).sort()).toEqual(['0.0.0', '0.0.1'])
    const served = await servedMembers('top-tokens-56')
    expect(served).not.toContain(addressOn(0, 'binance-smart-chain'))
    expect(served).toContain(addressOn(6, 'binance-smart-chain'))
    expect(listsFor('top-tokens-1').map(versionOf)).toEqual(['0.0.0'])
  })

  it('leaves every list alone when CoinGecko answers nothing usable', async () => {
    await runOnce(healthy())
    const before = harness.state.lists.length

    const outcomes = [
      await runOnce({ ...healthy(), platforms: { status: { error_code: 429 } } }),
      await runOnce({ ...healthy(), platforms: [{ id: 'ethereum', chain_identifier: 777 }] }),
      await runOnce({ ...healthy(), coinList: null }),
      await runOnce({ ...healthy(), pages: [null] }),
      await runOnce({ ...healthy(), pages: [[]] }),
    ]

    expect(outcomes.map((outcome) => outcome.manifest)).toEqual([[], [], [], [], []])
    expect(harness.state.lists).toHaveLength(before)
    expect(await servedMembers('top-tokens-1')).toHaveLength(6)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o no configured chain found among the CoinGecko platforms',
      'coingecko-top-tokens',
    )
  })

  it('leaves a chain alone when the ranking was cut short before the chain had enough tokens', async () => {
    const fixture = { coinCount: 400, platformCutoffs: { ethereum: 400, 'binance-smart-chain': 400 } }
    const coinList = coinListRows(fixture).map((row, index) =>
      index < 250 ? { ...row, platforms: { ethereum: row.platforms.ethereum } } : row,
    )
    const env = { COINGECKO_TOP_TOKENS_COUNT: '10' }
    await runOnce({ coinList, pages: marketPages(400) }, env)
    const before = await servedMembers('top-tokens-56')
    expect(before).toHaveLength(10)

    // Page 2, which holds every BNB coin, fails: BNB keeps its list; Ethereum, already full, is filed.
    await runOnce({ coinList, pages: [marketPages(400)[0]!, null] }, env)

    expect(await servedMembers('top-tokens-56')).toEqual(before)
    expect(listsFor('top-tokens-56')).toHaveLength(1)
    expect(await servedMembers('top-tokens-1')).toHaveLength(10)
  })

  it('leaves the list of a chain CoinGecko no longer lists alone, and files the others', async () => {
    await runOnce(healthy())

    await runOnce({ ...healthy(), platforms: platformRows.filter((row) => row.id === 'ethereum') })

    expect(await servedMembers('top-tokens-56')).toHaveLength(6)
  })

  it('retires the list of a chain that is no longer configured, once', async () => {
    await runOnce(healthy())

    await runOnce(healthy(), { COINGECKO_TOP_TOKENS_CHAINS: '1' })
    await runOnce(healthy(), { COINGECKO_TOP_TOKENS_CHAINS: '1' })

    expect(await servedMembers('top-tokens-56')).toEqual([])
    expect(listsFor('top-tokens-56').map(versionOf).sort()).toEqual(['0.0.0', '0.0.1'])
    expect(await servedMembers('top-tokens-1')).toHaveLength(6)
  })

  it('files no list for a chain with fewer than the minimum number of tokens', async () => {
    const world = healthy({ platformCutoffs: { ethereum: 8, 'binance-smart-chain': MIN_LIST_SIZE - 1 } })

    const { manifest } = await runOnce(world)

    expect(manifest[0]!.lists.map((list) => list.listKey)).toEqual(['top-tokens-1'])
    expect(listsFor('top-tokens-56')).toHaveLength(0)
  })

  it('lets one failing chain fail alone', async () => {
    const original = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    harness.dbModule.insertNetworkFromChainId.mockImplementation(
      async (chainId: number | string, ...rest: unknown[]) => {
        if (chainId === 1) throw new Error('database unavailable')
        return original(chainId, ...rest)
      },
    )
    try {
      await runOnce(healthy())
    } finally {
      harness.dbModule.insertNetworkFromChainId.mockImplementation(original)
    }

    expect(harness.state.lists.map((list) => list.key)).toEqual(['top-tokens-56'])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o list=%o failed: %o',
      'coingecko-top-tokens',
      'top-tokens-1',
      'database unavailable',
    )
  })

  it('files nothing and retires nothing when the run is aborted while reading the ranking', async () => {
    await runOnce(healthy())
    const controller = new AbortController()
    const { client } = makeClient(healthy(), (path) => {
      if (path === '/coins/markets') controller.abort()
    })

    const manifest = await collectorFor(client).discover(controller.signal)

    expect(manifest).toEqual([])
    expect(await servedMembers('top-tokens-1')).toHaveLength(6)
  })

  it('stops between chains when the run is aborted', async () => {
    const controller = new AbortController()
    const { client } = makeClient(healthy(), (path) => {
      if (path === '/token_lists/ethereum/all.json') controller.abort()
    })

    const manifest = await collectorFor(client).discover(controller.signal)

    expect(manifest).toEqual([])
    expect(listsFor('top-tokens-56')).toHaveLength(0)
  })

  it('stops after the last chain when the abort comes late', async () => {
    const controller = new AbortController()
    const { client } = makeClient(healthy(), (path) => {
      if (path === '/token_lists/binance-smart-chain/all.json') controller.abort()
    })

    expect(await collectorFor(client).discover(controller.signal)).toEqual([])
  })

  describe('collect', () => {
    it('does nothing before discover has prepared a list', async () => {
      await collectorFor(makeClient(healthy()).client).collect(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('does nothing when aborted, and publishes no version', async () => {
      const collector = collectorFor(makeClient(healthy()).client)
      await collector.discover(new AbortController().signal)
      const controller = new AbortController()
      controller.abort()

      await collector.collect(controller.signal)

      expect(harness.state.tokenImages).toHaveLength(0)
      expect(harness.dbModule.pruneSupersededListVersions).not.toHaveBeenCalled()
    })

    it('stops storing tokens once aborted mid-list', async () => {
      const collector = collectorFor(makeClient(healthy()).client)
      await collector.discover(new AbortController().signal)
      const controller = new AbortController()
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
        controller.abort()
      })

      await collector.collect(controller.signal)

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('carries on past a token that fails to store, and publishes the list', async () => {
      harness.dbModule.fetchImageAndStoreForToken.mockRejectedValueOnce(new Error('image host down'))

      await runOnce(healthy())

      expect(await servedMembers('top-tokens-1')).toHaveLength(5)
      expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
        'token %o/%o/%o failed: %o',
        'coingecko-top-tokens',
        'top-tokens-1',
        addressOn(0, 'ethereum'),
        'image host down',
      )
    })

    it('trims old versions after publishing', async () => {
      await runOnce(healthy())

      expect(harness.dbModule.pruneSupersededListVersions).toHaveBeenCalledWith({
        providerId: harness.state.providers[0]!.providerId,
        listKey: 'top-tokens-1',
        keep: 3,
      })
    })
  })

  describe('with its own client and the process environment', () => {
    it('reads the environment and asks CoinGecko with the configured header, spacing out requests', async () => {
      vi.stubEnv('COINGECKO_API_KEY', 'demo-key')
      vi.stubEnv('COINGECKO_API_PLAN', 'demo')
      vi.stubEnv('COINGECKO_TOP_TOKENS_INTERVAL_MS', '1')
      vi.stubEnv('COINGECKO_TOP_TOKENS_CHAINS', '1')
      vi.stubEnv('COINGECKO_TOP_TOKENS_COUNT', '6')
      const world = healthy()
      const requested: { url: string; headers: Record<string, string> }[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
          requested.push({ url, headers: init.headers })
          const path = new URL(url).pathname.replace('/api/v3', '')
          if (path === '/asset_platforms') return new Response(JSON.stringify(platformRows))
          if (path === '/coins/list') return new Response(JSON.stringify(world.coinList))
          if (path === '/coins/markets') return new Response(JSON.stringify(world.pages![0]))
          return new Response('missing', { status: 404 })
        }),
      )

      const controller = new AbortController()
      const manifest = await defaultInstance.discover(controller.signal)
      await defaultInstance.collect(controller.signal)

      expect(manifest[0]!.lists.map((list) => list.listKey)).toEqual(['top-tokens-1'])
      expect(requested[0]!.url).toBe('https://api.coingecko.com/api/v3/asset_platforms')
      expect(requested.every((request) => request.headers['x-cg-demo-api-key'] === 'demo-key')).toBe(true)
      // The token list answered 404: the failure is logged by the default client and decimals fall back to 0.
      expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
        'provider=%o %s',
        'coingecko-top-tokens',
        '/token_lists/ethereum/all.json answered 404; giving up',
      )
      expect(harness.state.tokenImages).toHaveLength(6)
    })
  })
})
