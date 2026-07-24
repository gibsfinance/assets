import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import pulsex, { collect } from './pulsex'

const EXTENDED_URL = 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json'
const V0_1_2_URL = 'https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json'

/**
 * pulsex.ts reads a fixed set of on-chain addresses (mainnet + V4 testnet)
 * for both its hardcoded "inline" list and the extensions attached to every
 * remote list variant. Every one of them needs erc20 metadata queued before
 * collect() runs, or the harness's erc20Read mock rejects.
 */
const registerAllOnChainAddresses = () => {
  const mainnetTargets = [
    '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
    '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
    '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
    '0xefd766ccb38eaf1dfd701853bfce31359239f305',
    '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07',
    '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f',
    '0x57fde0a71132198bbec939b98976993d8d89d225',
    '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    '0xb17d901469b9208b17d916112988a3fed19b5ca1',
    '0x4d3aea379b7689e0cb722826c909fab39e54123d',
    '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    '0x514910771af9ca656af840dff83e8264ecf986ca',
    '0xee2d275dbb79c7871f8c6eb2a4d0687dd85409d1',
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    '0x3f105121a10247de9a92e818554dd5fcd2063ae7',
  ]
  const v4Targets = [
    '0x70499adebb11efd915e3b69e700c331778628707',
    '0x8a810ea8b121d08342e9e7696f4a9915cbe494b7',
    '0x6efafcb715f385c71d8af763e8478feea6fadf63',
    '0x826e4e896cc2f5b371cd7bb0bd929db3e3db67c0',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
  ]
  for (const address of [...mainnetTargets, ...v4Targets]) {
    harness.setErc20Metadata(address, [`Token ${address.slice(2, 6)}`, address.slice(2, 6).toUpperCase(), 18])
  }
}

describe('pulsex collector', () => {
  it('registers a provider and every configured list key during discover()', async () => {
    const manifest = await pulsex.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['pulsex'])
    expect(manifest).toEqual([
      {
        providerKey: 'pulsex',
        lists: [
          { listKey: 'extended' },
          { listKey: 'extended-composite' },
          { listKey: 'v0.1.2' },
          { listKey: 'v0.1.2-composite' },
          { listKey: 'v4-v0.1.2' },
          { listKey: 'v4-v0.1.2-composite' },
          { listKey: 'inline' },
        ],
      },
    ])
  })

  it('collects every remote list variant plus the hardcoded inline lists, sharing cached fetches by URL', async () => {
    registerAllOnChainAddresses()
    harness.queueTokenListResponse(EXTENDED_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 369 })] }))
    harness.queueTokenListResponse(V0_1_2_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 369 })] }))

    await pulsex.collect(new AbortController().signal)

    // Six remote-list variants are collected — 'extended'/'extended-composite' share
    // one URL and all four v0.1.2 variants share the other, but caching the underlying
    // fetch is `cachedJSONRequest`'s own responsibility (mocked away here), not something
    // this collector does itself, so each variant still calls through independently.
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledTimes(6)

    const listKeysWritten = new Set(harness.state.lists.map((list) => list.key))
    expect(listKeysWritten).toEqual(
      new Set([
        'extended',
        'extended-composite',
        'v0.1.2',
        'v0.1.2-composite',
        'v4-v0.1.2',
        'v4-v0.1.2-composite',
        'inline',
      ]),
    )

    // The inline mainnet list is read directly off-chain (erc20Read), not fetched as JSON.
    const inlineImages = harness.state.tokenImages.filter(
      (image) => image.listId === harness.state.lists.find((list) => list.key === 'inline')?.listId,
    )
    expect(inlineImages.length).toBeGreaterThan(0)
  })

  it('exposes a standalone collect() function that delegates to the same collector instance', async () => {
    registerAllOnChainAddresses()
    harness.queueTokenListResponse(EXTENDED_URL, buildTokenList({ tokens: [] }))
    harness.queueTokenListResponse(V0_1_2_URL, buildTokenList({ tokens: [] }))

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['pulsex'])
  })
})
