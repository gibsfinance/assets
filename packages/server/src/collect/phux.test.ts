import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import phux, { collect } from './phux'

describe('phux collector', () => {
  it('registers itself under the phux provider key and the default exchange list', async () => {
    const manifest = await phux.discover(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['phux'])
    expect(manifest).toEqual([{ providerKey: 'phux', lists: [{ listKey: 'exchange' }] }])
    expect(harness.state.lists.find((list) => list.key === 'exchange')?.default).toBe(true)
  })

  it('prefixes every relative logo with its list domain before storing tokens', async () => {
    await phux.collect(new AbortController().signal)

    // The harvested fixture carries a mix of already-absolute logo urls and
    // relative ones (`/img/...`); a relative url reaching image storage
    // unresolved would fail to fetch in production, so this must never regress.
    expect(harness.state.tokenImages.length).toBeGreaterThan(0)
    const relativeGoneAbsolute = harness.state.tokenImages.find((image) =>
      (image.uri as string)?.startsWith('https://phux.io/'),
    )
    expect(relativeGoneAbsolute).toBeDefined()
    for (const image of harness.state.tokenImages) {
      expect(image.uri).not.toMatch(/^\//)
    }
  })

  it('exposes a standalone collect() that delegates to the same collector instance', async () => {
    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['phux'])
    expect(harness.state.tokenImages.length).toBeGreaterThan(0)
  })
})
