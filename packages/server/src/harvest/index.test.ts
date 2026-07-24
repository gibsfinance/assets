/**
 * Test for the CoinGecko asset-platforms harvester.
 *
 * Why this matters: this script writes the raw upstream response straight to
 * disk for the collector pipeline to read later — the API key must reach the
 * request query string and the exact upstream payload (not a copy built by
 * the test) must land in the written file untouched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'fs'
import * as paths from '../paths'
import { main } from './index'

describe('harvest main', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches CoinGecko asset platforms with the given key and writes the raw response to disk', async () => {
    const platforms = [
      { id: 'ethereum', chain_identifier: 1 },
      { id: 'pulsechain', chain_identifier: 369 },
    ]
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(platforms),
    })
    vi.stubGlobal('fetch', fetchMock)
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)

    await main({ coingeckoApiKey: 'test-api-key' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/asset_platforms?x_cg_demo_api_key=test-api-key',
    )
    // The file must carry the exact upstream payload the collector pipeline
    // will later parse — not some shape the test reconstructed independently.
    expect(writeFileSpy).toHaveBeenCalledWith(
      paths.harvestedCoingeckoAssetPlatforms,
      JSON.stringify(platforms, null, 2),
    )
  })
})
