import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)

// Isolated in its own file because it replaces the real Satoshi-Labs-Improvement-
// Proposal-44 registry with a synthetic one containing only curated, resolvable
// coin types. Mocking 'slip44' here would otherwise poison every other test in
// cryptocurrency-icons.test.ts, which relies on the real (much larger) registry
// to naturally produce reserved-evm and not-curated skips.
vi.mock('slip44', () => ({
  registeredCoinTypes: [[0, 2147483648, 'BTC', 'Bitcoin']],
}))

beforeEach(() => {
  harness.reset()
})

import cryptocurrencyIcons from './cryptocurrency-icons'

describe('cryptocurrency-icons collector against a registry with nothing to skip', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reports every skip-reason bucket as zero when nothing was skipped', async () => {
    // A registry containing only a curated, catalog-satisfied coin type resolves
    // every entry, so `skipped` is empty and every `skipCounts[...] ?? 0` fallback
    // in the summary line resolves through its default rather than a real count.
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [{ name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' }],
        }) as Response,
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await cryptocurrencyIcons.collect(new AbortController().signal)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reserved-evm 0, not-curated 0, no-icon 0'))
    expect(harness.state.networkImages).toHaveLength(1)
    warnSpy.mockRestore()
  })
})
