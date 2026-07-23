import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import honeyswap from './honeyswap'

const LIST_URL = 'https://tokens.honeyswap.org/'

describe('honeyswap collector', () => {
  it('registers itself under the honeyswap provider key and exchange list', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 100 })] }))

    const manifest = await honeyswap.discover(new AbortController().signal)

    expect(manifest).toEqual([{ providerKey: 'honeyswap', lists: [{ listKey: 'exchange' }] }])
    expect(harness.state.providers.map((p) => p.key)).toEqual(['honeyswap'])
  })

  it('blanks the logo of every address on its hardcoded blacklist', async () => {
    const blacklistedAddress = '0xfC40a4F89b410a1b855b5e205064a38fC29F5eb5'
    harness.queueTokenListResponse(
      LIST_URL,
      buildTokenList({
        tokens: [
          buildTokenEntry({ chainId: 100, address: blacklistedAddress, logoURI: 'https://example.com/scam.png' }),
          buildTokenEntry({ chainId: 100, logoURI: 'https://example.com/legit.png' }),
        ],
      }),
    )

    await honeyswap.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(2)
    const blanked = harness.state.tokenImages.find(
      (image) => image.token.providedId === blacklistedAddress.toLowerCase(),
    )
    const kept = harness.state.tokenImages.find((image) => image.token.providedId !== blacklistedAddress.toLowerCase())
    expect(blanked?.uri).toBeNull()
    expect(kept?.uri).toBe('https://example.com/legit.png')
  })
})
