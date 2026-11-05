/**
 * The addresses of two exchange lists that stopped answering in 2026-11:
 * 9mm's repository was deleted (the list moved to the ninemm-pro organisation) and
 * levinswap's gateway, ipfs.io, began refusing server requests. Each collector must
 * ask the address that still serves the list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => harness.reset())

import nineMM from './9mm'
import levinswap from './levinswap'

const askedAddress = async (collector: typeof nineMM) => {
  harness.dbModule.cachedJSONRequest.mockResolvedValue(buildTokenList({ tokens: [buildTokenEntry({ chainId: 369 })] }))
  await collector.discover(new AbortController().signal)
  return harness.dbModule.cachedJSONRequest.mock.calls[0]?.[0]
}

describe('exchange list sources', () => {
  it('reads 9mm from the ninemm-pro repository, not the deleted 9mm-exchange one', async () => {
    expect(await askedAddress(nineMM)).toBe(
      'https://raw.githubusercontent.com/ninemm-pro/app-tokens/main/9mm-tokenlist.json',
    )
  })

  it('reads levinswap by content hash through the shared IPFS path, not from one hardcoded gateway', async () => {
    const address = await askedAddress(levinswap)
    expect(address).toBe('ipfs://QmUmN7Be3LLHiEwcVZDm6WsPjcTddWsc6C7hrLCmPzsanv')
  })
})
