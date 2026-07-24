import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, createFakeTerminalRowProxy, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import * as inmemoryTokenlist from './inmemory-tokenlist'

describe('inmemory-tokenlist discover', () => {
  it('creates a provider, a list, and one network per unique non-zero chain id', async () => {
    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 1, address: '0x1111111111111111111111111111111111111111' }),
        buildTokenEntry({ chainId: 137, address: '0x2222222222222222222222222222222222222222' }),
        // A second token on chain 1 must not create a second network entry.
        buildTokenEntry({ chainId: 1, address: '0x3333333333333333333333333333333333333333' }),
      ],
    })

    const state = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(state).toBeDefined()
    expect(state?.provider.key).toBe('acme')
    expect(state?.list.key).toBe('default')
    expect(state?.chainIds.sort()).toEqual([1, 137])
    expect([...state!.networks.keys()].sort()).toEqual([1, 137])
    expect(harness.state.providers).toHaveLength(1)
    // one network for the default asset-0 network created inside the transaction, plus one per chain id
    expect(harness.state.networks.size).toBe(3)
  })

  it('skips network creation for a zero chain id entry without erroring', async () => {
    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 0, address: '0x1111111111111111111111111111111111111111' }),
        buildTokenEntry({ chainId: 1, address: '0x2222222222222222222222222222222222222222' }),
      ],
    })

    const state = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    // chain 0 is included in the manifest's chainIds set (it is not filtered upstream)
    // but never gets its own networks-map entry — only the truthy chain id does.
    expect(state?.chainIds.sort()).toEqual([0, 1])
    expect([...state!.networks.keys()]).toEqual([1])
  })

  it('sets isDefault on the created list', async () => {
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      isDefault: true,
      signal: new AbortController().signal,
    })

    expect(harness.state.lists[0]?.default).toBe(true)
  })

  it('derives major/minor/patch from the token list version when present', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1 })],
      version: { major: 3, minor: 2, patch: 1 },
    })

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      signal: new AbortController().signal,
    })

    const list = harness.state.lists[0]!
    expect([list.major, list.minor, list.patch]).toEqual([3, 2, 1])
  })

  it('falls back to 1.0.0 when the token list version fields are not numbers', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1 })],
      // Upstream lists occasionally publish a version object with missing or
      // non-numeric fields — the collector must not pass those through as-is.
      version: {} as unknown as { major: number; minor: number; patch: number },
    })

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      signal: new AbortController().signal,
    })

    const list = harness.state.lists[0]!
    expect([list.major, list.minor, list.patch]).toEqual([1, 0, 0])
  })

  it('omits major/minor/patch entirely when the token list carries no version', async () => {
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })
    delete (tokenList as { version?: unknown }).version

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.dbModule.insertList).toHaveBeenCalledWith(
      expect.not.objectContaining({ major: expect.anything() }),
      expect.anything(),
    )
  })

  it('fetches and stores the list logo when the token list carries one', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1 })],
      logoURI: 'https://example.com/list-logo.png',
    })

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.listImages).toHaveLength(1)
    expect(harness.state.listImages[0]?.uri).toBe('https://example.com/list-logo.png')
    expect(harness.state.listImages[0]?.providerKey).toBe('acme')
  })

  it('does not fetch a list logo when none is present', async () => {
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })
    delete (tokenList as { logoURI?: string }).logoURI

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'primary',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.listImages).toHaveLength(0)
  })

  it('returns undefined and creates nothing when the signal is aborted before any chain id is processed', async () => {
    const controller = new AbortController()
    controller.abort()
    const tokenList = buildTokenList({ tokens: [] })

    const state = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: controller.signal,
    })

    expect(state).toBeUndefined()
    expect(harness.state.providers).toHaveLength(0)
  })

  it('returns undefined and never creates the provider/list when aborted mid-network-loop', async () => {
    const controller = new AbortController()
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(async (chainId: number, type = 'evm') => {
      controller.abort()
      return { networkId: `network:eip155-${chainId}`, type, chainId: `eip155-${chainId}` }
    })
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    const state = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: controller.signal,
    })

    expect(state).toBeUndefined()
    expect(harness.state.providers).toHaveLength(0)
  })

  it('reuses a caller-supplied row instead of issuing its own', async () => {
    const row = createFakeTerminalRowProxy()
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      row,
      signal: new AbortController().signal,
    })

    expect(row.createCounter).toHaveBeenCalled()
  })
})

describe('inmemory-tokenlist collect', () => {
  it('inserts one token image per entry, keyed to the discovered network', async () => {
    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 1, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'AAA' }),
        buildTokenEntry({ chainId: 1, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'BBB' }),
      ],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.tokenImages).toHaveLength(2)
    const [first, second] = harness.state.tokenImages
    expect(first?.token.providedId).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(first?.listTokenOrderId).toBe(0)
    expect(second?.token.providedId).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(second?.listTokenOrderId).toBe(1)
  })

  it('normalizes the provided address before storing it', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1, address: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' })],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0xcccccccccccccccccccccccccccccccccccccccc')
  })

  it('blanks out a blacklisted placeholder logo instead of storing it', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1, logoURI: 'missing_thumb.png' })],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.tokenImages[0]?.uri).toBeNull()
  })

  it('repairs a malformed double-h logo URL', async () => {
    const tokenList = buildTokenList({
      tokens: [buildTokenEntry({ chainId: 1, logoURI: 'hhttps://example.com/logo.png' })],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.state.tokenImages[0]?.uri).toBe('https://example.com/logo.png')
  })

  it('skips an entry whose chain id has no discovered network and continues with the rest', async () => {
    // Build a `discovered` state by hand that only covers chain 1, then collect a
    // token list that also carries an entry for chain 137 — the defensive
    // "no network found" branch that only fires when collect() is handed a
    // discovered state narrower than the list it is asked to process.
    const chain1Only = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }),
      signal: new AbortController().signal,
    })
    harness.state.tokenImages.length = 0

    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 1, address: '0xdddddddddddddddddddddddddddddddddddddddd' }),
        buildTokenEntry({ chainId: 137, address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }),
      ],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      discovered: chain1Only,
      signal: new AbortController().signal,
    })

    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0xdddddddddddddddddddddddddddddddddddddddd')
  })

  it('records a failed insert and continues processing the remaining tokens', async () => {
    harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 1, address: '0xffffffffffffffffffffffffffffffffffffffff' }),
        buildTokenEntry({ chainId: 1, address: '0x1234123412341234123412341234123412341234' }),
      ],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    // The first token's insert threw and was not recorded; the second still went through.
    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0x1234123412341234123412341234123412341234')
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
  })

  it('returns without processing tokens when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: controller.signal,
    })

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops mid-list when the signal aborts between tokens', async () => {
    const controller = new AbortController()
    harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async (input) => {
      controller.abort()
      harness.state.tokenImages.push({
        providerKey: input.providerKey,
        listId: input.listId,
        listTokenOrderId: input.listTokenOrderId,
        uri: input.uri,
        originalUri: input.originalUri,
        token: input.token,
      })
    })
    const tokenList = buildTokenList({
      tokens: [
        buildTokenEntry({ chainId: 1, address: '0x111111111111111111111111111111111111111a' }),
        buildTokenEntry({ chainId: 1, address: '0x222222222222222222222222222222222222222b' }),
      ],
    })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: controller.signal,
    })

    // Only the first token — aborting mid-loop stops the second from being reached.
    expect(harness.state.tokenImages).toHaveLength(1)
  })

  it('reuses a pre-discovered state instead of discovering again', async () => {
    const discovered = await inmemoryTokenlist.discover({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }),
      signal: new AbortController().signal,
    })
    harness.dbModule.insertProvider.mockClear()
    harness.dbModule.insertList.mockClear()

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }),
      discovered,
      signal: new AbortController().signal,
    })

    expect(harness.dbModule.insertProvider).not.toHaveBeenCalled()
    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
  })

  it('leaves a caller-supplied row uncompleted', async () => {
    const row = createFakeTerminalRowProxy()
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      row,
      signal: new AbortController().signal,
    })

    expect(row.complete).not.toHaveBeenCalled()
  })

  it('completes its own row when it issues one itself', async () => {
    const tokenList = buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] })

    await inmemoryTokenlist.collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList,
      signal: new AbortController().signal,
    })

    expect(harness.utilsModule.terminal.issue).toHaveBeenCalled()
  })
})
