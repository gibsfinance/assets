import { describe, it, expect, vi, beforeEach } from 'vitest'
import { etherscanHarness as harness, createFakePage } from './__testing__/etherscan-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('@gibs/utils/viem', () => harness.gibsUtilsViemModule)
vi.mock('../utils/delay', () => harness.delayModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('fs', () => harness.fsModule)
vi.mock('puppeteer', () => harness.puppeteerModule)
vi.mock('puppeteer-core', () => harness.puppeteerCoreModule)

beforeEach(() => {
  harness.reset()
})

import etherscanCollector, { collect } from './etherscan'

const CHAINLIST_URL = 'https://api.etherscan.io/v2/chainlist'

const MAINNET_ADDRESS = '0x1111111111111111111111111111111111111111'
const SECOND_ADDRESS = '0x2222222222222222222222222222222222222222'
const THIRD_ADDRESS = '0x3333333333333333333333333333333333333333'
const FOURTH_ADDRESS = '0x4444444444444444444444444444444444444444'

const chainInfo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  chainname: 'Ethereum Mainnet',
  chainid: '1',
  blockexplorer: 'https://etherscan.io/',
  apiurl: 'https://api.etherscan.io/v2/api',
  status: 1,
  comment: '',
  ...overrides,
})

const queueChainList = (chains: ReturnType<typeof chainInfo>[]) => {
  harness.queueFetch(CHAINLIST_URL, { ok: true, json: () => ({ result: chains }) })
}

/** Queues a single enabled, mapped, mainnet chain — the common case most puppeteer/markup tests build on. */
const queueSingleMainnetChain = () => queueChainList([chainInfo()])

const rowWithTokenLink = (address: string, imgTag = '') =>
  `<tr><td><a href="/token/${address}">t</a>${imgTag}</td></tr>`

describe('etherscan collector: discover()', () => {
  it('registers the provider and a single top-tokens list under the all-chains network', async () => {
    const manifest = await etherscanCollector.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['etherscan'])
    expect(manifest).toEqual([{ providerKey: 'etherscan', lists: [{ listKey: 'top-tokens' }] }])
    expect(harness.state.lists[0]).toMatchObject({ key: 'top-tokens', default: true })
  })
})

describe('etherscan collector: chain list fetching and filtering', () => {
  it('throws when the chainlist API responds with a non-ok status', async () => {
    harness.queueFetch(CHAINLIST_URL, { ok: false, status: 503, statusText: 'Service Unavailable', json: () => ({}) })

    await expect(collect(new AbortController().signal)).rejects.toThrow(/HTTP 503/)
  })

  it('throws when the chainlist response has no result array', async () => {
    harness.queueFetch(CHAINLIST_URL, { ok: true, json: () => ({ nope: true }) })

    await expect(collect(new AbortController().signal)).rejects.toThrow(/Invalid response format/)
  })

  it('throws when every chain gets filtered out (testnets, blacklist, unmapped, inactive)', async () => {
    queueChainList([
      chainInfo({ chainname: 'Sepolia Testnet', chainid: '11155111' }),
      chainInfo({ chainname: 'OP Mainnet', chainid: '1101' }), // blacklisted
      chainInfo({ chainname: 'Some Unmapped Chain', chainid: '999999' }), // no viem mapping
      chainInfo({ chainname: 'Disabled Chain', chainid: '10', status: 0 }), // inactive
    ])

    await expect(collect(new AbortController().signal)).rejects.toThrow(
      /Failed to fetch supported chains from Etherscan API/,
    )
  })

  it('processes only the mapped, active, non-testnet, non-blacklisted chains', async () => {
    queueChainList([
      chainInfo({ chainname: 'Ethereum Mainnet', chainid: '1' }),
      chainInfo({ chainname: 'Sepolia Testnet', chainid: '11155111' }),
      chainInfo({ chainname: 'OP Mainnet', chainid: '1101' }),
      chainInfo({ chainname: 'Optimism', chainid: '10' }),
    ])
    harness.setPage(createFakePage('<html><body><table><tbody></tbody></table></body></html>'))

    await collect(new AbortController().signal)

    // Two rows of network state: mainnet (1) and optimism (10) — 1101/testnet are absent.
    const chainIds = [...harness.state.networks.values()].map((n) => n.chainId)
    expect(chainIds).toContain('eip155-1')
    expect(chainIds).toContain('eip155-10')
    expect(chainIds).not.toContain('eip155-1101')
    expect(chainIds).not.toContain('eip155-11155111')
  })
})

describe('etherscan collector: markup extraction', () => {
  it('extracts addresses and resolves logo URLs (absolute, relative, missing img, img without src), deduping repeats', async () => {
    queueSingleMainnetChain()
    const html = `<html><body><table><tbody>
      ${rowWithTokenLink(MAINNET_ADDRESS, '<img src="https://etherscan.io/images/token1.png"/>')}
      ${rowWithTokenLink(SECOND_ADDRESS, '<img src="/images/token2.png"/>')}
      ${rowWithTokenLink(THIRD_ADDRESS)}
      ${rowWithTokenLink(FOURTH_ADDRESS, '<img/>')}
      ${rowWithTokenLink(MAINNET_ADDRESS, '<img src="https://etherscan.io/images/duplicate.png"/>')}
      <tr><td>no token link in this row</td></tr>
    </tbody></table></body></html>`
    harness.setPage(createFakePage(html))
    for (const address of [MAINNET_ADDRESS, SECOND_ADDRESS, THIRD_ADDRESS, FOURTH_ADDRESS]) {
      harness.setErc20Metadata(address, [`Name ${address.slice(2, 6)}`, address.slice(2, 6).toUpperCase(), 18])
    }

    await collect(new AbortController().signal)

    const mainnetNetworkId = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-1')?.networkId
    if (!mainnetNetworkId) throw new Error('expected a mainnet network row to exist after collect()')
    const tokenFor = (address: string) => harness.state.tokens.get(`${mainnetNetworkId}:${address.toLowerCase()}`)
    expect(tokenFor(MAINNET_ADDRESS)).toBeDefined()
    expect(tokenFor(SECOND_ADDRESS)).toBeDefined()
    expect(tokenFor(THIRD_ADDRESS)).toBeDefined()
    expect(tokenFor(FOURTH_ADDRESS)).toBeDefined()
    // Only 4 tokens total: the second occurrence of MAINNET_ADDRESS was deduped
    // away before ever reaching token storage.
    expect(harness.state.tokens.size).toBe(4)

    const uris = harness.state.imageBatchCalls.map((call) => call.uri)
    expect(uris).toContain('https://etherscan.io/images/token1.png')
    expect(uris).toContain('https://etherscan.io/images/token2.png')
    // Rows with no <img> or an <img> lacking `src` never get queued for an image fetch.
    expect(harness.state.imageBatchCalls).toHaveLength(2)
  })

  it('reports "no tokens found" and stores nothing when the page has no matching rows (unexpected page shape)', async () => {
    queueSingleMainnetChain()
    harness.setPage(createFakePage('<html><body><div>Etherscan changed their markup entirely</div></body></html>'))

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.dbModule.insertTokenBatch).not.toHaveBeenCalled()
    expect(harness.gibsUtilsViemModule.erc20Read).not.toHaveBeenCalled()
  })

  it('slices to the first 100 unique tokens found on the page', async () => {
    queueSingleMainnetChain()
    const rows = Array.from({ length: 120 }, (_, i) => {
      const address = `0x${(i + 1).toString(16).padStart(40, '0')}`
      harness.setErc20Metadata(address, ['Name', 'SYM', 18])
      return rowWithTokenLink(address)
    }).join('\n')
    harness.setPage(createFakePage(`<html><body><table><tbody>${rows}</tbody></table></body></html>`))

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(100)
  })

  it('resolves a relative logo path with no leading slash against the explorer base URL', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS, '<img src="images/no-leading-slash.png"/>')}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])

    await collect(new AbortController().signal)

    expect(harness.state.imageBatchCalls[0]?.uri).toBe('https://etherscan.io/images/no-leading-slash.png')
  })

  it('reports "no valid tokens" and stores nothing when every extracted token fails its on-chain read', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, new Error('rpc down'))
    harness.setErc20Metadata(SECOND_ADDRESS, new Error('rpc down'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.dbModule.insertTokenBatch).not.toHaveBeenCalled()
  })

  it('skips a row whose href matches the loose selector but not the strict 40-hex-character address pattern', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>` +
          // Passes `a[href*="/token/0x"]` (contains the substring) but the
          // address is short, so `/\/token\/(0x[a-fA-F0-9]{40})/` fails to match.
          `<tr><td><a href="/token/0xshort">t</a></td></tr>` +
          `${rowWithTokenLink(MAINNET_ADDRESS)}` +
          `</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(1)
    const [[, token]] = harness.state.tokens
    expect(token.providedId).toBe(MAINNET_ADDRESS.toLowerCase())
  })
})

describe('etherscan collector: puppeteer failure modes', () => {
  it('records an error and returns no tokens when the fetched page content is empty', async () => {
    queueSingleMainnetChain()
    const page = createFakePage('')
    harness.setPage(page)

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.fsModule.promises.writeFile).not.toHaveBeenCalled()
  })

  it('recovers to an empty result set (without throwing) when page.goto fails', async () => {
    queueSingleMainnetChain()
    const page = createFakePage()
    page.goto.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
    harness.setPage(page)

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
    expect(page.close).toHaveBeenCalled()
  })

  it('recovers to an empty result set when browser.newPage() itself fails, without calling page.close', async () => {
    queueSingleMainnetChain()
    harness.failNewPage(new Error('target closed'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
  })

  it('waits out a Cloudflare interstitial that clears on the first retry', async () => {
    queueSingleMainnetChain()
    const page = createFakePage(
      `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`,
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    // First evaluate() sees the real Cloudflare interstitial markup, the
    // second (post-retry) sees the actual token page — exercises the real
    // detection callback (`document.title.includes('Just a moment')`) rather
    // than a canned boolean.
    page.queueDocumentState({ title: 'Just a moment...' })
    page.queueDocumentState({ innerHTML: '<table></table>' })
    harness.setPage(page)

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(1)
  })

  it('gives up after five Cloudflare retries and parses whatever the page eventually contains', async () => {
    queueSingleMainnetChain()
    const page = createFakePage('<html><body><table><tbody></tbody></table></body></html>')
    // Every evaluate() call sees the same persistent "DDoS protection" interstitial.
    page.queueDocumentState({ innerHTML: 'DDoS protection by example-cdn' })
    harness.setPage(page)

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
    // Initial check + 5 retries inside the while loop = 6 evaluate() calls.
    expect(page.evaluate).toHaveBeenCalledTimes(6)
  })

  it('connects to an external browser service instead of launching one when BROWSER_WS_ENDPOINT is set', async () => {
    process.env.BROWSER_WS_ENDPOINT = 'ws://browser-service:9222'
    queueSingleMainnetChain()
    harness.setPage(createFakePage('<html><body><table><tbody></tbody></table></body></html>'))

    await collect(new AbortController().signal)

    expect(harness.puppeteerCoreModule.connect).toHaveBeenCalledWith({ browserWSEndpoint: 'ws://browser-service:9222' })
    expect(harness.puppeteerModule.launch).not.toHaveBeenCalled()
    expect(harness.browser.disconnect).toHaveBeenCalled()
    expect(harness.browser.close).not.toHaveBeenCalled()
  })

  it('launches the shared browser only once and reuses it across multiple enabled chains', async () => {
    queueChainList([
      chainInfo({ chainname: 'Ethereum Mainnet', chainid: '1' }),
      chainInfo({ chainname: 'Optimism', chainid: '10' }),
    ])
    harness.setPage(createFakePage('<html><body><table><tbody></tbody></table></body></html>'))

    await collect(new AbortController().signal)

    expect(harness.puppeteerModule.launch).toHaveBeenCalledTimes(1)
    expect(harness.browser.newPage).toHaveBeenCalledTimes(2)
  })

  it('recovers to an empty result set when page.content() itself rejects', async () => {
    queueSingleMainnetChain()
    const page = createFakePage(
      `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`,
    )
    page.content.mockRejectedValueOnce(new Error('target crashed'))
    harness.setPage(page)

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
  })

  it('bails out before touching the browser when the signal is already aborted', async () => {
    queueSingleMainnetChain()
    const controller = new AbortController()
    controller.abort()

    await collect(controller.signal)

    expect(harness.browser.newPage).not.toHaveBeenCalled()
    // Only the sentinel "all networks" (chain id 0) upsert from collect()'s own
    // setup ran — the per-chain callback returned before calling processChainTokens.
    expect(harness.dbModule.insertNetworkFromChainId).toHaveBeenCalledTimes(1)
  })

  it('discards an in-flight page fetch when the signal aborts between chain setup and the browser call', async () => {
    queueSingleMainnetChain()
    harness.setPage(createFakePage('<html><body><table><tbody></tbody></table></body></html>'))
    const controller = new AbortController()
    const realInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    harness.dbModule.insertNetworkFromChainId
      .mockImplementationOnce(realInsertNetworkFromChainId) // the id-0 sentinel
      .mockImplementationOnce(async (...args: Parameters<typeof realInsertNetworkFromChainId>) => {
        const result = await realInsertNetworkFromChainId(...args)
        controller.abort()
        return result
      })

    await collect(controller.signal)

    expect(harness.browser.newPage).not.toHaveBeenCalled()
    expect(harness.state.tokens.size).toBe(0)
  })

  it('abandons the page fetch when the signal aborts during the post-navigation settle delay', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(`<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`),
    )
    const controller = new AbortController()
    // The real `delay()` *rejects* with the abort reason when the signal fires
    // mid-wait; this call site wraps it in `.catch(() => {})`, so the rejection
    // path needs modeling too, not just the resolved-instantly default.
    harness.delayModule.delay.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted mid-delay')
    })

    await collect(controller.signal)

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.gibsUtilsViemModule.erc20Read).not.toHaveBeenCalled()
  })

  it('abandons the page fetch when the signal aborts while waiting out a detected Cloudflare challenge', async () => {
    queueSingleMainnetChain()
    const page = createFakePage(
      `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`,
    )
    page.queueDocumentState({ innerHTML: 'Checking your browser before accessing example.com' })
    harness.setPage(page)
    const controller = new AbortController()
    // First delay() call is the fixed 3,000ms post-navigation settle; the second
    // is the Cloudflare-detected 3,000ms wait this test targets, and rejects
    // (swallowed by its own `.catch(() => {})`) rather than merely resolving.
    harness.delayModule.delay
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('aborted mid-delay')
      })

    await collect(controller.signal)

    expect(harness.state.tokens.size).toBe(0)
  })

  it('abandons the page fetch when the signal aborts during a Cloudflare retry backoff', async () => {
    queueSingleMainnetChain()
    const page = createFakePage(
      `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`,
    )
    page.queueDocumentState({ innerHTML: 'DDoS protection challenge in progress' })
    harness.setPage(page)
    const controller = new AbortController()
    // 1st delay(): fixed 3,000ms settle. 2nd: Cloudflare-detected 3,000ms wait.
    // 3rd: the first 10,000ms in-loop retry wait, which this test targets and
    // makes reject (swallowed by its own `.catch(() => {})`).
    harness.delayModule.delay
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        controller.abort()
        throw new Error('aborted mid-delay')
      })

    await collect(controller.signal)

    expect(harness.state.tokens.size).toBe(0)
    // Aborted mid-first-retry: only one of the up-to-five retries actually ran.
    expect(page.evaluate).toHaveBeenCalledTimes(2)
  })

  it('times out and gives up launching a browser that never responds', async () => {
    queueSingleMainnetChain()
    harness.puppeteerModule.launch.mockImplementationOnce(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const runPromise = collect(new AbortController().signal)
      await vi.advanceTimersByTimeAsync(15_000)
      await runPromise
    } finally {
      vi.useRealTimers()
    }

    expect(harness.state.tokens.size).toBe(0)
  })
})

describe('etherscan collector: per-chain token processing', () => {
  it('skips a token whose on-chain metadata read fails, without failing the rest of the chain', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, new Error('rpc timeout'))
    harness.setErc20Metadata(SECOND_ADDRESS, ['Good Token', 'GOOD', 18])

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(1)
    const [[, token]] = harness.state.tokens
    expect(token.providedId).toBe(SECOND_ADDRESS.toLowerCase())
  })

  it('logs and skips a token whose sequential processor slot rejects for real, instead of resolving null', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    // A rejection reason is not always an Error — a library that throws a
    // string or null still has to be survivable. `processToken` promises to
    // convert every rejection to `null`, and it can only keep that promise if
    // its own handler avoids dereferencing `.message` on a non-Error, which
    // would throw inside the handler and reject the promise it was protecting.
    harness.setErc20Metadata(MAINNET_ADDRESS, () => {
      throw null as unknown as Error
    })
    harness.setErc20Metadata(SECOND_ADDRESS, ['Good Token', 'GOOD', 18])

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    // The bad token is skipped and the rest of the chain still collects.
    expect(harness.state.tokens.size).toBe(1)
    const [[, token]] = harness.state.tokens
    expect(token.providedId).toBe(SECOND_ADDRESS.toLowerCase())
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'Failed to fetch metadata for token %o on chain %o: %o',
      MAINNET_ADDRESS,
      1,
      'null',
    )
  })

  it('records a chain-level error and skips the chain entirely when the batch insert fails', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(`<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    harness.dbModule.insertTokenBatch.mockRejectedValueOnce(new Error('constraint violation'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
  })

  it('continues past a single failed storeToken call, keeping other tokens in the chain', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    harness.setErc20Metadata(SECOND_ADDRESS, ['Name2', 'SYM2', 18])
    harness.dbModule.storeToken.mockRejectedValueOnce(new Error('list association failed'))

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(2)
    expect(harness.state.listTokens.size).toBe(1)
  })

  it('does not fail the chain when batch image fetching fails', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS, '<img src="https://etherscan.io/x.png"/>')}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    harness.failNextImageBatch(new Error('image storage unavailable'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(1)
  })

  it('records a chain-level error when a lower-level dependency (network upsert) throws', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(`<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`),
    )
    // The first call is `collect()`'s own "all networks" sentinel (chain id 0)
    // for the top-tokens list — let it through, and reject only the second
    // call, which is `processChainTokens`'s per-chain upsert for mainnet.
    const realInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    harness.dbModule.insertNetworkFromChainId
      .mockImplementationOnce(realInsertNetworkFromChainId)
      .mockRejectedValueOnce(new Error('network upsert failed'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
  })

  it('stops reading token metadata partway through the chain once the signal aborts mid-loop', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    const controller = new AbortController()
    // Aborting as a side effect of the *first* token's on-chain read means the
    // loop's own `if (signal.aborted) break` guard — checked before every
    // token, not just after a failure — stops it from ever reaching the second.
    harness.setErc20Metadata(MAINNET_ADDRESS, () => {
      controller.abort()
      return ['Name', 'SYM', 18] as const
    })
    harness.setErc20Metadata(SECOND_ADDRESS, ['Name2', 'SYM2', 18])

    await collect(controller.signal)

    expect(harness.state.tokens.size).toBe(1)
    expect(harness.gibsUtilsViemModule.erc20Read).toHaveBeenCalledTimes(1)
  })

  it('drops a token whose sequential-processor slot was already aborted by the time its turn came up', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(`<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}</tbody></table></body></html>`),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    const controller = new AbortController()
    // `SequentialRpcProcessor.processToken` re-checks `signal.aborted` itself,
    // independently of the caller's own per-token loop guard, once its queued
    // turn on the chain's processor chain actually comes up. Aborting from a
    // synchronous side effect of `counterId.token` — called immediately before
    // `fetchTokenMetadata`, in the same tick — lands the abort inside that
    // window, without ever tripping the loop's own (already-checked) guard.
    const realCounterIdToken = harness.utilsModule.counterId.token
    harness.utilsModule.counterId.token = (...args: Parameters<typeof realCounterIdToken>) => {
      controller.abort()
      return realCounterIdToken(...args)
    }

    try {
      await collect(controller.signal)
    } finally {
      harness.utilsModule.counterId.token = realCounterIdToken
    }

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.gibsUtilsViemModule.erc20Read).not.toHaveBeenCalled()
  })

  it('stops creating list associations partway through a batch once the signal aborts mid-loop', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    const controller = new AbortController()
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    harness.setErc20Metadata(SECOND_ADDRESS, ['Name2', 'SYM2', 18])
    // Both tokens pass their metadata read and land in the batch insert, but
    // the signal aborts as a side effect of storing the first list association,
    // so the second token is inserted (batch insert already ran) yet never
    // gets a `list_token` row.
    const realStoreToken = harness.dbModule.storeToken.getMockImplementation()!
    harness.dbModule.storeToken.mockImplementationOnce(async (...args: Parameters<typeof realStoreToken>) => {
      const result = await realStoreToken(...args)
      controller.abort()
      return result
    })

    await collect(controller.signal)

    expect(harness.state.tokens.size).toBe(2)
    expect(harness.state.listTokens.size).toBe(1)
  })

  it('rate-limits sequential reads on the same chain, waiting out the inter-request delay even when it rejects', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, ['Name', 'SYM', 18])
    harness.setErc20Metadata(SECOND_ADDRESS, ['Name2', 'SYM2', 18])
    // The processor's own inter-request pacing delay rejects (as the real
    // `delay()` does when a signal aborts mid-wait) — it must be swallowed
    // without breaking the token that already resolved successfully. The
    // first delay() call overall is the fixed 3,000ms post-navigation settle
    // (let it through); the pacing delay this test targets comes after.
    harness.delayModule.delay
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('aborted mid-delay')
      })

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(2)
  })

  it('rate-limits even after a failed on-chain read, waiting out the delay before the next token', async () => {
    queueSingleMainnetChain()
    harness.setPage(
      createFakePage(
        `<html><body><table><tbody>${rowWithTokenLink(MAINNET_ADDRESS)}${rowWithTokenLink(SECOND_ADDRESS)}</tbody></table></body></html>`,
      ),
    )
    harness.setErc20Metadata(MAINNET_ADDRESS, new Error('rpc timeout'))
    harness.setErc20Metadata(SECOND_ADDRESS, ['Name2', 'SYM2', 18])
    // The pacing delay after a *failed* read also rejects; that failure path
    // has to swallow it too instead of letting it surface as an unhandled
    // rejection. First delay() call is again the fixed 3,000ms settle.
    harness.delayModule.delay
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error('aborted mid-delay')
      })

    await collect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(1)
  })
})

describe('etherscan collector: default export', () => {
  it('the default-exported collector instance runs the same collect() logic', async () => {
    queueSingleMainnetChain()
    harness.setPage(createFakePage('<html><body><table><tbody></tbody></table></body></html>'))

    await expect(etherscanCollector.collect(new AbortController().signal)).resolves.toBeUndefined()
  })
})
