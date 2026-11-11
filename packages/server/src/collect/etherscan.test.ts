import { beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './__testing__/collector-harness'
import { CHAIN_REFUSAL, PRO_REFUSAL, refusalBody } from './__testing__/etherscan-fixtures'
import { ETHERSCAN_CHAINS } from './etherscan-chains'

const { settings, getTopTokenAddresses } = vi.hoisted(() => ({
  settings: {
    apiKey: undefined as string | undefined,
    callsPerSecond: 3,
    tokensPerChain: 100,
    sourceLists: [{ providerKey: 'coingecko', listKeyPrefix: 'top-tokens' }],
    chainIds: null as number[] | null,
  },
  getTopTokenAddresses: vi.fn(),
}))

vi.mock('../../config', () => ({ default: { etherscan: settings } }))
vi.mock('../db', () => ({ ...harness.dbModule, getTopTokenAddresses }))
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

import defaultCollector, { collect, EtherscanCollector, listKeyForChain, selectFetchableAddresses } from './etherscan'

const KEY = 'SECRETKEY123'
const logged = () => harness.gibsUtilsModule.failureLog.mock.calls.map((call) => call.map(String).join(' '))

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const C = '0x3333333333333333333333333333333333333333'

type Responder = (request: { chainId: number; address: string; isProbe: boolean }) => unknown

/** A fetch that answers from `respond` and records every call. */
const stubFetch = (respond: Responder) => {
  const probeTokens = new Set(ETHERSCAN_CHAINS.map((chain) => chain.knownToken))
  const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const address = url.searchParams.get('contractaddress') ?? ''
    const body = await respond({
      chainId: Number(url.searchParams.get('chainid')),
      address,
      isProbe: probeTokens.has(address),
    })
    return { status: 200, json: async () => body } as Response
  })
  return fetchImplementation
}

const tokenBody = (address: string, overrides: Record<string, unknown> = {}) => ({
  status: '1',
  message: 'OK',
  result: [
    {
      contractAddress: address,
      tokenName: `Token ${address.slice(2, 6)}`,
      symbol: `T${address.slice(2, 4)}`,
      divisor: '18',
      tokenType: 'ERC20',
      image: `https://etherscan.io/token/images/${address.slice(2, 6)}.png`,
      ...overrides,
    },
  ],
})

const instant = { now: () => 0, sleep: async () => undefined }

const useProKey = (chainIds: number[] = [1]) => {
  settings.apiKey = KEY
  settings.chainIds = chainIds
}

const sourceTokens = (byNetwork: Record<string, string[]>) =>
  getTopTokenAddresses.mockImplementation(async ({ networkId }: { networkId: string }) => byNetwork[networkId] ?? [])

const run = async (collector: EtherscanCollector, signal = new AbortController().signal) => {
  const manifest = await collector.discover(signal)
  await collector.collect(signal)
  return manifest
}

beforeEach(() => {
  harness.reset()
  getTopTokenAddresses.mockReset()
  settings.apiKey = undefined
  settings.chainIds = null
  settings.tokensPerChain = 100
  vi.unstubAllGlobals()
})

describe('selectFetchableAddresses', () => {
  it('keeps contract addresses once, lower case, and drops placeholders and junk', () => {
    expect(
      selectFetchableAddresses([
        '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0x0000000000000000000000000000000000000000',
        '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeeEEeE',
        'So11111111111111111111111111111111111111112',
        '0x123',
      ]),
    ).toEqual(['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
  })
})

describe('without a key', () => {
  it('logs why, makes no call and writes nothing', async () => {
    const fetchImplementation = stubFetch(() => ({}))
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    expect(await run(collector)).toEqual([])

    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(logged().some((line) => line.includes('ETHERSCAN_API_KEY is not set'))).toBe(true)
    expect(harness.dbModule.insertProvider).not.toHaveBeenCalled()
  })
})

describe('with a free key', () => {
  const freeKeyResponder: Responder = ({ chainId }) =>
    refusalBody([10, 56, 100, 8453, 43114].includes(chainId) ? CHAIN_REFUSAL : PRO_REFUSAL)

  it('does nothing but log that tokeninfo needs API Pro, and asks each chain once', async () => {
    settings.apiKey = KEY
    const fetchImplementation = stubFetch(freeKeyResponder)
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    expect(await run(collector)).toEqual([])

    // One probe per chain, never repeated, and no tokeninfo call for any token.
    expect(fetchImplementation).toHaveBeenCalledTimes(ETHERSCAN_CHAINS.length)
    const lines = logged()
    const proLines = lines.filter((line) => line.includes('requires-pro'))
    expect(proLines).toHaveLength(6)
    for (const line of proLines) {
      expect(line).toContain('tokeninfo')
      expect(line).toContain(PRO_REFUSAL)
    }
    expect(lines.filter((line) => line.includes('chain-not-on-plan'))).toHaveLength(5)
    expect(lines.filter((line) => line.includes('collects nothing'))).toHaveLength(1)
    expect(lines.join('\n')).not.toContain(KEY)
    expect(harness.dbModule.insertProvider).not.toHaveBeenCalled()
    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
    expect(harness.dbModule.fetchImageAndStoreForToken).not.toHaveBeenCalled()
    expect(getTopTokenAddresses).not.toHaveBeenCalled()
  })

  it('asks Etherscan only once even when discovery runs again', async () => {
    settings.apiKey = KEY
    const fetchImplementation = stubFetch(freeKeyResponder)
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    await collector.discover(new AbortController().signal)
    await collector.discover(new AbortController().signal)

    expect(fetchImplementation).toHaveBeenCalledTimes(ETHERSCAN_CHAINS.length)
  })

  it('does nothing when collect runs before any usable discovery', async () => {
    settings.apiKey = KEY
    await new EtherscanCollector({ fetchImplementation: stubFetch(freeKeyResponder), ...instant }).collect(
      new AbortController().signal,
    )
    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
  })
})

describe('with a key that can call tokeninfo', () => {
  it('files one list per usable chain, stores each token with its logo, and publishes it', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A, B] })
    const fetchImplementation = stubFetch(({ address }) => tokenBody(address))
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    const manifest = await run(collector)

    expect(manifest).toEqual([{ providerKey: 'etherscan', lists: [{ listKey: 'top-tokens-1' }] }])
    expect(getTopTokenAddresses).toHaveBeenCalledWith({
      networkId: 'network:eip155-1',
      sources: settings.sourceLists,
      limit: 100,
    })
    expect(harness.state.lists).toHaveLength(1)
    expect(harness.state.lists[0]).toMatchObject({
      key: listKeyForChain(1),
      name: 'Etherscan: top tokens (Ethereum)',
      networkId: 'network:eip155-1',
    })
    expect(harness.state.lists[0].tokensCollectedAt).not.toBeNull()
    expect(harness.state.tokenImages.map((image) => image.token.providedId)).toEqual([A, B])
    expect(harness.state.tokenImages[0]).toMatchObject({
      providerKey: 'etherscan',
      listTokenOrderId: 0,
      uri: 'https://etherscan.io/token/images/1111.png',
      originalUri: 'https://etherscan.io/token/images/1111.png',
      token: { name: 'Token 1111', symbol: 'T11', decimals: 18, networkId: 'network:eip155-1' },
    })
    // 1 probe + 2 tokens.
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })

  it('files a token that has no logo with no address', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A] })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address, { image: '' })),
      ...instant,
    })

    await run(collector)

    expect(harness.state.tokenImages[0].uri).toBeNull()
  })

  it('collects only the usable chains of a mixed answer and logs each skipped chain once', async () => {
    useProKey([1, 56, 137])
    sourceTokens({ 'network:eip155-1': [A], 'network:eip155-137': [B] })
    const fetchImplementation = stubFetch(({ chainId, address }) => {
      if (chainId === 56) return refusalBody(CHAIN_REFUSAL)
      if (chainId === 137) return refusalBody(PRO_REFUSAL)
      return tokenBody(address)
    })
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    const manifest = await run(collector)

    expect(manifest[0].lists).toEqual([{ listKey: 'top-tokens-1' }])
    expect(harness.state.lists.map((list) => list.key)).toEqual(['top-tokens-1'])
    const skips = logged().filter((line) => line.includes('skipped'))
    expect(skips.filter((line) => line.includes('chain-not-on-plan'))).toHaveLength(1)
    expect(skips.filter((line) => line.includes('requires-pro'))).toHaveLength(1)
    // Probes for 3 chains, and tokeninfo calls only on chain 1.
    expect(fetchImplementation).toHaveBeenCalledTimes(4)
  })

  it('skips a usable chain that no source list names a token on, and says so', async () => {
    useProKey([1, 137])
    sourceTokens({ 'network:eip155-1': [A], 'network:eip155-137': [] })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    const manifest = await run(collector)

    expect(manifest[0].lists).toEqual([{ listKey: 'top-tokens-1' }])
    expect(logged().some((line) => line.includes('no source list names a token'))).toBe(true)
  })

  it('drops placeholders from the source tokens before asking about them', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': ['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', A] })
    const fetchImplementation = stubFetch(({ address }) => tokenBody(address))

    await run(new EtherscanCollector({ fetchImplementation, ...instant }))

    expect(harness.state.tokenImages.map((image) => image.token.providedId)).toEqual([A])
  })

  it('skips tokens Etherscan has no usable record for, and files the rest', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A, B, C] })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => {
        if (address === B) return { status: '0', message: 'No record found', result: [] }
        if (address === C) return tokenBody(address, { tokenType: 'ERC721' })
        return tokenBody(address)
      }),
      ...instant,
    })

    await run(collector)

    expect(harness.state.tokenImages.map((image) => image.token.providedId)).toEqual([A])
    expect(harness.state.lists[0].tokensCollectedAt).not.toBeNull()
  })

  it('writes nothing when no token has a record', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A] })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address, isProbe }) =>
        isProbe ? tokenBody(address) : { status: '0', message: 'No record found', result: [] },
      ),
      ...instant,
    })

    await run(collector)

    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
    expect(logged().some((line) => line.includes('no token had a record'))).toBe(true)
  })

  it('stops a chain at a plan refusal part way, leaves its list alone, and never retries', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A, B, C] })
    const fetchImplementation = stubFetch(({ address, isProbe }) => {
      if (isProbe || address === A) return tokenBody(address)
      return refusalBody(PRO_REFUSAL)
    })
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    await run(collector)

    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
    expect(logged().some((line) => line.includes('stopped') && line.includes('requires-pro'))).toBe(true)
    // 1 probe, then A, B and C at most once each; none repeated.
    expect(fetchImplementation.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('backs off on the rate message and still collects the chain', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A] })
    const sleeps: number[] = []
    let tokenCalls = 0
    const fetchImplementation = stubFetch(({ address, isProbe }) => {
      if (isProbe) return tokenBody(address)
      tokenCalls += 1
      return tokenCalls < 3 ? refusalBody('Max calls per sec rate limit reached (3/sec)') : tokenBody(address)
    })
    let time = 0
    const collector = new EtherscanCollector({
      fetchImplementation,
      now: () => time,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        time += milliseconds
      },
    })

    await run(collector)

    expect(sleeps.filter((milliseconds) => milliseconds >= 1000)).toEqual([1000, 2000])
    expect(harness.state.tokenImages.map((image) => image.token.providedId)).toEqual([A])
  })

  it('stops the chain when the rate limit does not lift, and leaves its list alone', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A, B] })
    const fetchImplementation = stubFetch(({ address, isProbe }) =>
      isProbe ? tokenBody(address) : refusalBody('Max rate limit reached, please use API Key for higher rate limit'),
    )
    const collector = new EtherscanCollector({ fetchImplementation, ...instant })

    await run(collector)

    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
    expect(logged().some((line) => line.includes('stopped') && line.includes('rate-limited'))).toBe(true)
  })

  it('files a new version when the members change and reuses it when they do not', async () => {
    useProKey([1])
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    sourceTokens({ 'network:eip155-1': [A, B] })
    await run(collector)
    sourceTokens({ 'network:eip155-1': [B, A] })
    await run(collector)
    sourceTokens({ 'network:eip155-1': [A] })
    await run(collector)

    const versions = harness.state.lists.map((list) => `${list.major}.${list.minor}.${list.patch}`)
    expect(versions).toEqual(['0.0.0', '0.0.1'])
  })

  it('logs a token whose storage fails, keeps the others, and publishes', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A, B] })
    harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
      throw new Error('store full')
    })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    await run(collector)

    expect(logged().some((line) => line.includes('store full'))).toBe(true)
    expect(harness.state.lists[0].tokensCollectedAt).not.toBeNull()
  })

  it('does not publish when every token fails to store', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A] })
    harness.dbModule.fetchImageAndStoreForToken.mockRejectedValue(new Error('store full'))
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    await run(collector)

    expect(harness.state.lists[0].tokensCollectedAt).toBeNull()
  })

  it('stops quietly when aborted before collecting', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [A] })
    const controller = new AbortController()
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    await collector.discover(controller.signal)
    controller.abort()
    await collector.collect(controller.signal)

    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
  })

  it('writes nothing, and asks about no further token, when aborted during the lookups', async () => {
    useProKey([1])
    sourceTokens({
      'network:eip155-1': [
        A,
        B,
        C,
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
      ],
    })
    const controller = new AbortController()
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address, isProbe }) => {
        if (!isProbe) controller.abort()
        return tokenBody(address)
      }),
      ...instant,
    })

    await collector.discover(controller.signal)
    await collector.collect(controller.signal)

    expect(harness.dbModule.insertList).not.toHaveBeenCalled()
  })

  it('stops after discovery when aborted during the probe', async () => {
    useProKey([1])
    const controller = new AbortController()
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => {
        controller.abort()
        return tokenBody(address)
      }),
      ...instant,
    })

    expect(await collector.discover(controller.signal)).toEqual([])
    expect(harness.dbModule.insertProvider).not.toHaveBeenCalled()
  })

  it('stops filing chains when aborted between chains', async () => {
    useProKey([1, 137])
    sourceTokens({ 'network:eip155-1': [A], 'network:eip155-137': [B] })
    const controller = new AbortController()
    harness.dbModule.insertList.mockImplementationOnce(async (list: { key: string }) => {
      controller.abort()
      return [{ listId: `id-${list.key}`, license: null }]
    })
    const collector = new EtherscanCollector({
      fetchImplementation: stubFetch(({ address }) => tokenBody(address)),
      ...instant,
    })

    await collector.discover(controller.signal)
    await collector.collect(controller.signal)

    expect(harness.dbModule.insertList).toHaveBeenCalledTimes(1)
  })
})

describe('the default instance', () => {
  it('is registered under the etherscan key and runs both phases through collect()', async () => {
    expect(defaultCollector.key).toBe('etherscan')
    await collect(new AbortController().signal)
    expect(logged().some((line) => line.includes('ETHERSCAN_API_KEY is not set'))).toBe(true)
  })

  it('reaches Etherscan through the global fetch when none is injected', async () => {
    useProKey([1])
    sourceTokens({ 'network:eip155-1': [] })
    const globalFetch = stubFetch(({ address }) => tokenBody(address))
    vi.stubGlobal('fetch', globalFetch)

    await new EtherscanCollector({ ...instant }).discover(new AbortController().signal)

    expect(globalFetch).toHaveBeenCalledTimes(1)
  })
})
