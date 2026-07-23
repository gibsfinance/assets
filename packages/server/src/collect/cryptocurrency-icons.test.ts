import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)

beforeEach(() => {
  harness.reset()
})

import cryptocurrencyIcons, { collect, parseCatalog } from './cryptocurrency-icons'
import { NAMESPACE_BY_COIN_TYPE } from './non-evm-resolver'

describe('parseCatalog', () => {
  it('keeps well-formed entries', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Monero', symbol: 'XMR', slug: 'monero', img_url: 'https://h/32/monero.png' },
    ]
    expect(parseCatalog(raw)).toHaveLength(2)
  })

  it('drops entries missing required string fields and non-array input', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Broken', symbol: 'BRK', slug: 'broken' }, // no img_url
      { symbol: 'NON', slug: 'no-name', img_url: 'https://h/32/x.png' }, // no name
    ]
    expect(parseCatalog(raw).map((e) => e.slug)).toEqual(['bitcoin'])
    expect(parseCatalog({ not: 'an array' })).toEqual([])
  })

  it('drops entries whose icon url is not https', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Relative', symbol: 'REL', slug: 'relative', img_url: '/32/relative.png' },
      { name: 'Insecure', symbol: 'INS', slug: 'insecure', img_url: 'http://h/32/insecure.png' },
    ]
    expect(parseCatalog(raw).map((e) => e.slug)).toEqual(['bitcoin'])
  })
})

/** A syntactically valid catalog covering the two curated coin types exercised below. */
const catalog = [
  { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
  { name: 'Monero', symbol: 'XMR', slug: 'monero', img_url: 'https://h/32/monero.png' },
]

describe('cryptocurrency-icons collector', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('registers the provider with a name and description, and discovers no lists', async () => {
    const manifest = await cryptocurrencyIcons.discover(new AbortController().signal)

    expect(harness.state.providers).toEqual([
      {
        providerId: 'provider:cryptocurrency-icons',
        key: 'cryptocurrency-icons',
        name: 'Cryptocurrency Icons',
        description: expect.stringContaining('Satoshi-Labs-Improvement-Proposal-44'),
      },
    ])
    // This collector stores per-network icons directly, never a token list.
    expect(manifest).toEqual([{ providerKey: 'cryptocurrency-icons', lists: [] }])
  })

  it('resolves the registered coin types against the catalog and stores one network icon per resolved chain', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog }) as Response)

    await cryptocurrencyIcons.collect(new AbortController().signal)

    // Bitcoin (bip122-0) and Monero (monero-128) both resolve against this catalog;
    // asserting the exact set (not just a non-zero count) protects the curated-chain
    // resolution wiring, not just "something got stored".
    const chainIds = harness.state.networkImages.map((image) => image.chainId).sort()
    expect(chainIds).toEqual(['bip122-0', 'monero-128'])
    expect(harness.state.networkImages.every((image) => image.providerKey === 'cryptocurrency-icons')).toBe(true)
  })

  it('logs a warning and stores nothing when the catalog fetch fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }) as Response)

    await cryptocurrencyIcons.collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('503'))
    warnSpy.mockRestore()
  })

  it('stops resolving further chains once the signal aborts mid-run', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog }) as Response)
    const controller = new AbortController()

    // Abort as a side effect of the first network-image write, deterministically
    // landing between the first and second resolved chain rather than racing a
    // timer against the collector's internal loop.
    let calls = 0
    harness.dbModule.fetchImageAndStoreForNetwork.mockImplementation(
      async (input: {
        network: { networkId: string; chainId: string }
        uri: string
        originalUri: string
        providerKey: string
      }) => {
        calls += 1
        harness.state.networkImages.push({
          providerKey: input.providerKey,
          networkId: input.network.networkId,
          chainId: input.network.chainId,
          uri: input.uri,
          originalUri: input.originalUri,
        })
        if (calls === 1) controller.abort()
        return { network: input.network }
      },
    )

    await cryptocurrencyIcons.collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(1)
  })

  it('logs a zero count for a skip reason that did not occur this run', async () => {
    // Every curated icon slug is present, so no chain is ever skipped for
    // 'no-icon' — the summary line's `?? 0` fallback only fires when a reason
    // bucket is genuinely empty, which a catalog that always satisfies every
    // curated slug (like this one) guarantees.
    const fullCatalog = Object.values(NAMESPACE_BY_COIN_TYPE).map((chain, index) => ({
      name: chain.iconSlug,
      symbol: `S${index}`,
      slug: chain.iconSlug,
      img_url: `https://h/32/${chain.iconSlug}.png`,
    }))
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => fullCatalog }) as Response)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await cryptocurrencyIcons.collect(new AbortController().signal)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-icon 0'))
    warnSpy.mockRestore()
  })

  it('exposes a standalone collect() that delegates to the same collector instance', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog }) as Response)

    await collect(new AbortController().signal)

    expect(harness.state.networkImages.length).toBeGreaterThan(0)
  })
})
