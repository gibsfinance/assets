import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import { RemoteTokenListCollector, collect } from './remote-tokenlist'

const LIST_URL = 'https://example.com/list.json'

describe('RemoteTokenListCollector.discover', () => {
  it('fetches the list, delegates to inmemory-tokenlist, and returns a one-list manifest', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
    })

    const manifest = await collector.discover(new AbortController().signal)

    expect(manifest).toEqual([{ providerKey: 'acme', lists: [{ listKey: 'default' }] }])
    expect(harness.state.providers.map((p) => p.key)).toEqual(['acme'])
    expect(harness.state.lists.map((l) => l.key)).toEqual(['default'])
  })

  it('writes the provider name before inmemory-tokenlist creates the provider row, and the name survives the later no-op upsert', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
      providerName: 'Acme Protocol',
    })

    await collector.discover(new AbortController().signal)

    expect(harness.state.providers).toHaveLength(1)
    expect(harness.state.providers[0]?.name).toBe('Acme Protocol')
    // insertProvider was called twice: once here with the name, once inside
    // inmemory-tokenlist.discover() with only the key — proving the name came
    // from *this* write surviving the second, name-less upsert rather than
    // from the second call happening to carry it too.
    expect(harness.dbModule.insertProvider).toHaveBeenCalledTimes(2)
    // The second call — issued inside inmemory-tokenlist.discover()'s transaction — carries
    // only the key, no name, yet the provider's name is still "Acme Protocol" (asserted
    // above): proof the first write's name survived this second, name-less upsert.
    expect(harness.dbModule.insertProvider).toHaveBeenNthCalledWith(2, { key: 'acme' }, expect.anything())
  })

  it('leaves the provider name null when none is configured', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
    })

    await collector.discover(new AbortController().signal)

    expect(harness.dbModule.insertProvider).toHaveBeenCalledTimes(1)
    expect(harness.state.providers[0]?.name).toBeNull()
  })

  it('marks the created list as default when configured', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
      isDefault: true,
    })

    await collector.discover(new AbortController().signal)

    expect(harness.state.lists[0]?.default).toBe(true)
  })

  it('returns an empty manifest without writing anything when the fetch yields no tokens', async () => {
    harness.queueTokenListResponse(LIST_URL, { ...buildTokenList(), tokens: undefined } as never)
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
    })

    const manifest = await collector.discover(new AbortController().signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })

  it('returns an empty manifest without writing anything when the signal is already aborted', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
    })
    const controller = new AbortController()
    controller.abort()

    const manifest = await collector.discover(controller.signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })
})

describe('RemoteTokenListCollector.collect', () => {
  it('delegates to the functional collect() factory and stores the fetched tokens', async () => {
    harness.queueTokenListResponse(
      LIST_URL,
      buildTokenList({
        tokens: [buildTokenEntry({ chainId: 1, address: '0x1111111111111111111111111111111111111111' })],
      }),
    )
    const collector = new RemoteTokenListCollector('acme', {
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
    })

    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0x1111111111111111111111111111111111111111')
  })
})

describe('collect() factory', () => {
  it('normalizes addresses and forwards logos through to the stored token', async () => {
    harness.queueTokenListResponse(
      LIST_URL,
      buildTokenList({
        tokens: [
          buildTokenEntry({
            chainId: 1,
            address: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
            logoURI: 'https://example.com/logo.png',
          }),
        ],
      }),
    )

    await collect({ providerKey: 'acme', listKey: 'default', tokenList: LIST_URL })(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0xcccccccccccccccccccccccccccccccccccccccc')
    expect(harness.state.tokenImages[0]?.uri).toBe('https://example.com/logo.png')
  })

  it('blanks the logo of a blacklisted address but keeps the token', async () => {
    const blacklisted = '0x1111111111111111111111111111111111111111'
    harness.queueTokenListResponse(
      LIST_URL,
      buildTokenList({
        tokens: [buildTokenEntry({ chainId: 1, address: blacklisted, logoURI: 'https://example.com/logo.png' })],
      }),
    )

    await collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
      blacklist: new Set([blacklisted]),
    })(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.uri).toBeNull()
  })

  it('applies rewriteLogoURI to every non-blacklisted logo', async () => {
    harness.queueTokenListResponse(
      LIST_URL,
      buildTokenList({
        tokens: [buildTokenEntry({ chainId: 1, logoURI: 'https://example.com/thumb.png' })],
      }),
    )

    await collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
      rewriteLogoURI: (uri) => uri.replace('thumb', 'large'),
    })(new AbortController().signal)

    expect(harness.state.tokenImages[0]?.uri).toBe('https://example.com/large.png')
  })

  it('throws when the remote fetch does not resolve to a token list at all', async () => {
    harness.queueTokenListResponse(LIST_URL, null as never)

    await expect(
      collect({ providerKey: 'acme', listKey: 'default', tokenList: LIST_URL })(new AbortController().signal),
    ).rejects.toThrow(/Invalid JSON response/)
  })

  it('logs and returns without throwing when the response has no tokens field', async () => {
    harness.queueTokenListResponse(LIST_URL, { ...buildTokenList(), tokens: undefined } as never)

    await collect({ providerKey: 'acme', listKey: 'default', tokenList: LIST_URL })(new AbortController().signal)

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('does nothing when the signal is already aborted', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))
    const controller = new AbortController()
    controller.abort()

    await collect({ providerKey: 'acme', listKey: 'default', tokenList: LIST_URL })(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('issues its task under a caller-supplied section instead of the shared terminal', async () => {
    harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [buildTokenEntry({ chainId: 1 })] }))

    await collect({
      providerKey: 'acme',
      listKey: 'default',
      tokenList: LIST_URL,
      row: harness.utilsModule.terminal,
    })(new AbortController().signal)

    expect(harness.utilsModule.terminal.task).toHaveBeenCalledWith(
      'acme/default',
      expect.objectContaining({ id: 'acme/default' }),
    )
  })

  describe('extensions', () => {
    const extensionAddress = '0x2222222222222222222222222222222222222222' as `0x${string}`

    it('merges a resolved extension token in alongside the fetched list', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(extensionAddress, ['Extension Token', 'EXT', 6])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(1)
      const image = harness.state.tokenImages[0]!
      expect(image.token.providedId).toBe(extensionAddress)
      expect(image.token.name).toBe('Extension Token')
      expect(image.token.symbol).toBe('EXT')
      expect(image.token.decimals).toBe(6)
      // A plain (non-network-image) extension never writes a network logo.
      expect(harness.state.networkImages).toHaveLength(0)
    })

    it('falls back to the extension-supplied name/symbol/decimals for a network (native-gas) token and stores its network image', async () => {
      const nativeAddress = '0x0000000000000000000000000000000000dEaD' as `0x${string}`
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      // The chain's native asset has no ERC-20 contract to read, so erc20Read
      // resolves to blank (not undefined — undefined would already fall back via
      // the destructuring default) name/symbol for it, forcing the explicit
      // isNetworkImage fallback to fire and overwrite name/symbol/decimals with
      // the extension's own values instead of dropping the entry.
      harness.setErc20Metadata(nativeAddress, ['', '', 0])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: nativeAddress,
            logoURI: 'https://example.com/native.png',
            name: 'Native Coin',
            symbol: 'NTV',
            decimals: 18,
            network: { id: 1, isNetworkImage: true },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(1)
      const image = harness.state.tokenImages[0]!
      expect(image.token.name).toBe('Native Coin')
      expect(image.token.symbol).toBe('NTV')
      expect(image.token.decimals).toBe(18)
      expect(harness.state.networkImages).toHaveLength(1)
      // `uri` is the already-fetched buffer, not the source string — `originalUri`
      // is the extension's logo URL, and is what the network row actually keys off.
      expect(harness.state.networkImages[0]?.originalUri).toBe('https://example.com/native.png')
    })

    it('drops an extension entry that resolves with no name, symbol, or decimals', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(extensionAddress, [undefined, undefined, undefined] as unknown as [
        string,
        string,
        number,
      ])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('drops an extension entry whose logo image cannot be fetched', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(extensionAddress, ['Extension Token', 'EXT', 6])
      harness.failImageFetch('https://example.com/ext.png')

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('drops an extension entry whose on-chain read throws, and logs the failure', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      // No metadata was registered for this address, so the harness's erc20Read
      // mock rejects — simulating a genuine RPC/contract-read failure.

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(0)
      expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
    })

    it('formats a thrown non-Error value into a plain string for the failure log', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.dbModule.fetchImage.mockImplementationOnce(() => {
        throw 'not an Error instance'
      })

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
        expect.any(String),
        'acme',
        'default',
        expect.anything(),
        'not an Error instance',
      )
    })

    it('does not overwrite a network-image token whose on-chain name/symbol resolved successfully', async () => {
      const wrappedNative = '0x4444444444444444444444444444444444444444' as `0x${string}`
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(wrappedNative, ['Wrapped Native', 'WNTV', 18])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: wrappedNative,
            logoURI: 'https://example.com/wrapped.png',
            name: 'Fallback Name',
            symbol: 'FALL',
            decimals: 9,
            network: { id: 1, isNetworkImage: true },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(1)
      const image = harness.state.tokenImages[0]!
      // The on-chain read succeeded, so the extension's fallback fields must not
      // have overwritten it.
      expect(image.token.name).toBe('Wrapped Native')
      expect(image.token.symbol).toBe('WNTV')
      expect(image.token.decimals).toBe(18)
    })

    it('prefers the extension entry over a fetched-list entry sharing the same address', async () => {
      harness.queueTokenListResponse(
        LIST_URL,
        buildTokenList({
          tokens: [buildTokenEntry({ chainId: 1, address: extensionAddress, name: 'List Version', symbol: 'LST' })],
        }),
      )
      harness.setErc20Metadata(extensionAddress, ['Extension Version', 'EXT', 6])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      expect(harness.state.tokenImages).toHaveLength(1)
      expect(harness.state.tokenImages[0]?.token.name).toBe('Extension Version')
    })

    it('blanks an extension logo whose address is blacklisted', async () => {
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(extensionAddress, ['Extension Token', 'EXT', 6])

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        blacklist: new Set([extensionAddress]),
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/ext.png',
            network: { id: 1, isNetworkImage: false },
          },
        ],
      })(new AbortController().signal)

      // fetchImage('') short-circuits to null, so a blacklisted extension is
      // dropped exactly like one whose image fetch failed outright.
      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('stops resolving further extensions once the signal aborts mid-flight', async () => {
      const secondAddress = '0x3333333333333333333333333333333333333333' as `0x${string}`
      const controller = new AbortController()
      harness.queueTokenListResponse(LIST_URL, buildTokenList({ tokens: [] }))
      harness.setErc20Metadata(extensionAddress, ['First', 'ONE', 18])
      harness.setErc20Metadata(secondAddress, ['Second', 'TWO', 18])
      // Abort as a side effect of resolving the *first* extension's image fetch —
      // by the time Array.prototype.map reaches the second extension's own
      // synchronous prefix, the signal already reads aborted.
      harness.dbModule.fetchImage.mockImplementationOnce((uri: string) => {
        controller.abort()
        return Promise.resolve(Buffer.from(`fixture-image:${uri}`))
      })

      await collect({
        providerKey: 'acme',
        listKey: 'default',
        tokenList: LIST_URL,
        extension: [
          {
            address: extensionAddress,
            logoURI: 'https://example.com/one.png',
            network: { id: 1, isNetworkImage: false },
          },
          { address: secondAddress, logoURI: 'https://example.com/two.png', network: { id: 1, isNetworkImage: false } },
        ],
      })(controller.signal)

      expect(harness.state.tokenImages).toHaveLength(0)
    })
  })
})
