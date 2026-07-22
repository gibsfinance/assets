import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Chain } from 'viem'

// ---------------------------------------------------------------------------
// Viem mock
// We mock the whole 'viem' module so that no real RPC calls are made.
// `http` returns a programmable fake transport whose per-request behavior is
// driven by `rpcRegistry` (keyed by URL) — this lets the loadBalance tests
// exercise real round-robin and failover logic without any network access.
// `createTransport` and `shouldThrow` remain the real implementations (from
// `...actual`) so loadBalance's rotation and error discrimination are tested
// as they run in production.
// ---------------------------------------------------------------------------
const { rpcRegistry } = vi.hoisted(() => ({
  rpcRegistry: new Map<string, (args: { method: string; params?: unknown }) => Promise<unknown>>(),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    http: vi.fn((url: string) => (_params: unknown) => ({
      config: { key: 'http', url },
      request: async (args: { method: string; params?: unknown }) => {
        const behavior = rpcRegistry.get(url)
        return behavior ? behavior(args) : { url, method: args.method }
      },
      value: {},
    })),
    createPublicClient: vi.fn((config: unknown) => ({ type: 'publicClient', config })),
    getContract: vi.fn(),
    encodeFunctionData: vi.fn(),
    decodeFunctionResult: vi.fn(),
    fromHex: vi.fn((hex: string, _encoding: string) => hex),
  }
})

import { http, createPublicClient, getContract, encodeFunctionData, decodeFunctionResult, fromHex } from 'viem'
import {
  buildTransport,
  loadBalance,
  parseRpcEndpoint,
  parseRpcEndpoints,
  rpcEndpointUrls,
  createChainClient,
  multicallRead,
  erc20Read,
} from './viem'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal chain fixture with a single default RPC URL. */
const makeChain = (id: number, rpcUrls: string[]): Chain =>
  ({
    id,
    name: `test-chain-${id}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: rpcUrls },
    },
  }) as unknown as Chain

/** Chain fixture that also carries a multicall3 contract address. */
const makeChainWithMulticall = (id: number, rpcUrls: string[]): Chain =>
  ({
    ...makeChain(id, rpcUrls),
    contracts: {
      multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
    },
  }) as unknown as Chain

/** Minimal chain fixture with multiple default RPC URLs. */
const chainWithMultipleRpcs = makeChain(999, ['https://rpc1.example.com', 'https://rpc2.example.com'])

const chainWithSingleRpc = makeChain(998, ['https://single.example.com'])

// Chain ID that has hardcoded overrides inside buildTransport (chain 1 = Ethereum mainnet).
const mainnetChain = makeChain(1, ['https://chain-default.example.com'])

// ---------------------------------------------------------------------------

describe('buildTransport', () => {
  beforeEach(() => {
    vi.mocked(http).mockClear()
    rpcRegistry.clear()
    delete process.env['RPC_998']
    delete process.env['RPC_999']
    delete process.env['RPC_1']
    delete process.env['RPC_1234']
  })

  afterEach(() => {
    delete process.env['RPC_998']
    delete process.env['RPC_999']
    delete process.env['RPC_1']
    delete process.env['RPC_1234']
  })

  it('returns an http transport when the resolved URL list has a single entry', () => {
    buildTransport(chainWithSingleRpc)
    // Single URL → one http transport, no load balancer wrapping.
    expect(http).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledWith(
      'https://single.example.com',
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
  })

  it('builds a load-balanced transport across every URL when the list has multiple entries', () => {
    // The load balancer is a lazy transport factory — instantiate it (as viem's
    // createPublicClient would) so the per-URL http transports are created.
    buildTransport(chainWithMultipleRpcs)({ retryCount: 0 })
    expect(http).toHaveBeenCalledTimes(2)
    expect(http).toHaveBeenCalledWith('https://rpc1.example.com', expect.objectContaining({ retryCount: 0 }))
    expect(http).toHaveBeenCalledWith('https://rpc2.example.com', expect.objectContaining({ retryCount: 0 }))
  })

  it('uses RPC_{chainId} env var (single URL) over chain defaults', () => {
    process.env['RPC_998'] = 'https://env-single.example.com'
    buildTransport(chainWithSingleRpc)
    expect(http).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledWith('https://env-single.example.com', expect.any(Object))
  })

  it('uses RPC_{chainId} env var (comma-separated) and load-balances across each URL', () => {
    process.env['RPC_998'] = 'https://env-a.example.com,https://env-b.example.com'
    buildTransport(chainWithSingleRpc)({ retryCount: 0 })
    expect(http).toHaveBeenCalledTimes(2)
    expect(http).toHaveBeenCalledWith('https://env-a.example.com', expect.any(Object))
    expect(http).toHaveBeenCalledWith('https://env-b.example.com', expect.any(Object))
  })

  it('falls back to hardcoded overrides when no env var is set (chain 1)', () => {
    // Chain 1 has 3 hardcoded override URLs; no env var set.
    buildTransport(mainnetChain)({ retryCount: 0 })
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('strips |<weight> suffixes before handing URLs to the http transport', () => {
    process.env['RPC_998'] = 'https://heavy.example.com|3,https://light.example.com'
    buildTransport(chainWithSingleRpc)({ retryCount: 0 })
    expect(http).toHaveBeenCalledTimes(2)
    expect(http).toHaveBeenCalledWith('https://heavy.example.com', expect.any(Object))
    expect(http).toHaveBeenCalledWith('https://light.example.com', expect.any(Object))
  })

  it('ignores a weight on a lone endpoint and uses a plain http transport', () => {
    process.env['RPC_998'] = 'https://only.example.com|5'
    buildTransport(chainWithSingleRpc)
    expect(http).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledWith('https://only.example.com', expect.any(Object))
  })

  it('ignores empty segments in comma-separated env var', () => {
    process.env['RPC_998'] = 'https://only.example.com,'
    buildTransport(chainWithSingleRpc)
    // One non-empty URL → single http transport
    expect(http).toHaveBeenCalledTimes(1)
  })
})

describe('parseRpcEndpoint', () => {
  it('defaults an unsuffixed URL to weight 1 so existing config is unchanged', () => {
    expect(parseRpcEndpoint('https://a.example.com')).toEqual({ url: 'https://a.example.com', weight: 1 })
  })

  it('reads a weight from the |<weight> suffix', () => {
    expect(parseRpcEndpoint('https://a.example.com|3')).toEqual({ url: 'https://a.example.com', weight: 3 })
  })

  it('accepts a fractional weight', () => {
    expect(parseRpcEndpoint('https://a.example.com|0.5')).toEqual({ url: 'https://a.example.com', weight: 0.5 })
  })

  it('keeps a URL that carries a query string intact', () => {
    expect(parseRpcEndpoint('https://a.example.com/v1?key=abc|2')).toEqual({
      url: 'https://a.example.com/v1?key=abc',
      weight: 2,
    })
  })

  it('trims surrounding whitespace around URL and weight', () => {
    expect(parseRpcEndpoint('  https://a.example.com | 4 ')).toEqual({ url: 'https://a.example.com', weight: 4 })
  })

  it.each(['https://a.example.com|abc', 'https://a.example.com|0', 'https://a.example.com|-2'])(
    'throws on a malformed weight rather than silently using 1 (%s)',
    (spec) => {
      // A silently-ignored weight looks like it applied while doing nothing.
      expect(() => parseRpcEndpoint(spec)).toThrow(/invalid RPC endpoint weight/)
    },
  )

  it('parses a whole list', () => {
    expect(parseRpcEndpoints(['https://a.example.com|2', 'https://b.example.com'])).toEqual([
      { url: 'https://a.example.com', weight: 2 },
      { url: 'https://b.example.com', weight: 1 },
    ])
  })

  it('strips weights back to plain URLs for chain configs', () => {
    // chain.rpcUrls.default.http holds URLs only — a leaked suffix would be a
    // malformed endpoint by the time viem tried to call it.
    expect(rpcEndpointUrls(['https://a.example.com|2', 'https://b.example.com'])).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })
})

describe('loadBalance', () => {
  beforeEach(() => {
    vi.mocked(http).mockClear()
    rpcRegistry.clear()
  })

  const urls = ['https://a.example.com', 'https://b.example.com', 'https://c.example.com']

  /** Instantiate the transport with no outer retries so each request picks exactly once. */
  const instantiate = (endpoints: string[], weights?: number[]) =>
    loadBalance(
      endpoints.map((url, index) => ({ url, weight: weights?.[index] ?? 1 })),
      { timeout: 1_000 },
    )({ retryCount: 0 })

  it('round-robins consecutive requests across every endpoint in order', async () => {
    urls.forEach((url) => rpcRegistry.set(url, async () => url))
    const transport = instantiate(urls)

    const first = await transport.request({ method: 'eth_blockNumber' })
    const second = await transport.request({ method: 'eth_blockNumber' })
    const third = await transport.request({ method: 'eth_blockNumber' })
    const fourth = await transport.request({ method: 'eth_blockNumber' })

    // Three endpoints, four calls → the fourth wraps back to the first.
    expect([first, second, third, fourth]).toEqual([urls[0], urls[1], urls[2], urls[0]])
  })

  it('gives a heavier endpoint proportionally more requests', async () => {
    const [a, b] = urls
    rpcRegistry.set(a, async () => a)
    rpcRegistry.set(b, async () => b)
    const transport = instantiate([a, b], [3, 1])

    const served = []
    for (let i = 0; i < 8; i++) served.push(await transport.request({ method: 'eth_blockNumber' }))

    // A 3:1 weighting over 8 requests must land 6 on A and 2 on B.
    expect(served.filter((url) => url === a)).toHaveLength(6)
    expect(served.filter((url) => url === b)).toHaveLength(2)
  })

  it('interleaves the heavier endpoint rather than clustering it', async () => {
    const [a, b] = urls
    rpcRegistry.set(a, async () => a)
    rpcRegistry.set(b, async () => b)
    const transport = instantiate([a, b], [3, 1])

    const served = []
    for (let i = 0; i < 4; i++) served.push(await transport.request({ method: 'eth_blockNumber' }))

    // Smooth weighted round-robin spreads the light endpoint through the cycle
    // (A,A,B,A) instead of draining the heavy one first (A,A,A,B), so bursts
    // keep hitting more than one provider.
    expect(served).toEqual([a, a, b, a])
  })

  it('treats equal weights as plain round-robin', async () => {
    urls.forEach((url) => rpcRegistry.set(url, async () => url))
    const transport = instantiate(urls, [2, 2, 2])

    const served = []
    for (let i = 0; i < 3; i++) served.push(await transport.request({ method: 'eth_blockNumber' }))

    expect(served).toEqual(urls)
  })

  it('fails over past a heavier endpoint that is down', async () => {
    const [a, b] = urls
    rpcRegistry.set(a, async () => {
      throw new Error('fetch failed')
    })
    rpcRegistry.set(b, async () => b)
    const transport = instantiate([a, b], [5, 1])

    // Weighting decides who is tried FIRST, never who is reachable — a dead
    // heavyweight must still hand off rather than absorb the whole rotation.
    const result = await transport.request({ method: 'eth_blockNumber' })
    expect(result).toBe(b)
  })

  it('fails over to the next endpoint when one raises a connection error', async () => {
    rpcRegistry.set(urls[0], async () => {
      throw new Error('fetch failed')
    })
    rpcRegistry.set(urls[1], async () => urls[1])
    const transport = instantiate(urls)

    // Starts at endpoint 0 (connection error → not shouldThrow), rotates to endpoint 1.
    const result = await transport.request({ method: 'eth_blockNumber' })
    expect(result).toBe(urls[1])
  })

  it('spreads load off a rate-limited endpoint (429 fails over)', async () => {
    rpcRegistry.set(urls[0], async () => {
      throw Object.assign(new Error('too many requests'), { code: 429 })
    })
    rpcRegistry.set(urls[1], async () => urls[1])
    const transport = instantiate(urls)

    const result = await transport.request({ method: 'eth_call' })
    expect(result).toBe(urls[1])
  })

  it('propagates an execution revert immediately without trying other endpoints', async () => {
    const secondEndpoint = vi.fn(async () => urls[1])
    rpcRegistry.set(urls[0], async () => {
      throw Object.assign(new Error('execution reverted: insufficient balance'), { code: 3 })
    })
    rpcRegistry.set(urls[1], secondEndpoint)
    const transport = instantiate(urls)

    // A revert is a real node answer — it must surface, not fan out across endpoints.
    await expect(transport.request({ method: 'eth_call' })).rejects.toThrow('execution reverted')
    expect(secondEndpoint).not.toHaveBeenCalled()
  })

  it('throws the last error when every endpoint fails to connect', async () => {
    urls.forEach((url, index) =>
      rpcRegistry.set(url, async () => {
        throw new Error(`down-${index}`)
      }),
    )
    const transport = instantiate(urls)

    // Rotation exhausts all three endpoints, then surfaces the final failure.
    await expect(transport.request({ method: 'eth_blockNumber' })).rejects.toThrow(/down-/)
  })
})

describe('createChainClient', () => {
  beforeEach(() => {
    vi.mocked(createPublicClient).mockClear()
    vi.mocked(http).mockClear()
    rpcRegistry.clear()
    delete process.env['RPC_998']
  })

  it('calls createPublicClient and returns the result', () => {
    const client = createChainClient(chainWithSingleRpc)
    expect(createPublicClient).toHaveBeenCalledTimes(1)
    expect(client).toBeDefined()
  })

  it('passes the chain to createPublicClient', () => {
    createChainClient(chainWithSingleRpc)
    const [config] = vi.mocked(createPublicClient).mock.calls[0]
    expect((config as { chain: Chain }).chain).toBe(chainWithSingleRpc)
  })

  it('passes batch multicall settings to createPublicClient', () => {
    createChainClient(chainWithSingleRpc)
    const [config] = vi.mocked(createPublicClient).mock.calls[0]
    expect((config as { batch: unknown }).batch).toMatchObject({
      multicall: {
        batchSize: expect.any(Number),
        wait: expect.any(Number),
      },
    })
  })

  it('passes a transport built from buildTransport to createPublicClient', () => {
    createChainClient(chainWithSingleRpc)
    const [config] = vi.mocked(createPublicClient).mock.calls[0]
    expect((config as { transport: unknown }).transport).toBeDefined()
    // buildTransport called http once for the single-URL chain
    expect(http).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// multicallRead tests
// ---------------------------------------------------------------------------

const multicallChain = makeChainWithMulticall(42, ['https://rpc.example.com'])
const stubAbi = [{ name: 'balanceOf', type: 'function' }] as const
const stubClient = { type: 'publicClient' } as unknown as import('viem').PublicClient

describe('multicallRead', () => {
  let aggregate3Mock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    aggregate3Mock = vi.fn()
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<
      typeof getContract
    >)
    vi.mocked(encodeFunctionData).mockReturnValue('0xdeadbeef')
    vi.mocked(decodeFunctionResult).mockReturnValue('decoded-value' as unknown as never)
    aggregate3Mock.mockResolvedValue([{ returnData: '0xabc' }, { returnData: '0xdef' }])
  })

  afterEach(() => {
    vi.mocked(getContract).mockReset()
    vi.mocked(encodeFunctionData).mockReset()
    vi.mocked(decodeFunctionResult).mockReset()
  })

  it('encodes each call and returns decoded results', async () => {
    const calls = [{ functionName: 'name' }, { functionName: 'symbol' }]
    const result = await multicallRead({
      chain: multicallChain,
      client: stubClient,
      abi: stubAbi as unknown as import('viem').Abi,
      calls,
      target: '0xTokenAddress',
    })

    expect(encodeFunctionData).toHaveBeenCalledTimes(2)
    expect(decodeFunctionResult).toHaveBeenCalledTimes(2)
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[])[0]).toBe('decoded-value')
    expect((result as unknown[])[1]).toBe('decoded-value')
  })

  it('uses call.abi when provided, falling back to passed abi', async () => {
    const perCallAbi = [{ name: 'totalSupply', type: 'function' }] as unknown as import('viem').Abi
    const calls = [{ functionName: 'name' }, { functionName: 'totalSupply', abi: perCallAbi }]
    aggregate3Mock.mockResolvedValue([{ returnData: '0x01' }, { returnData: '0x02' }])

    await multicallRead({
      chain: multicallChain,
      client: stubClient,
      abi: stubAbi as unknown as import('viem').Abi,
      calls,
      target: '0xTokenAddress',
    })

    // First call: no per-call abi → uses stubAbi
    expect(vi.mocked(encodeFunctionData).mock.calls[0][0].abi).toBe(stubAbi)
    // Second call: has per-call abi → uses perCallAbi
    expect(vi.mocked(encodeFunctionData).mock.calls[1][0].abi).toBe(perCallAbi)
  })

  it('uses call.target when provided, falling back to passed target', async () => {
    const perCallTarget = '0xPerCallTarget' as import('viem').Hex
    const calls = [{ functionName: 'name' }, { functionName: 'symbol', target: perCallTarget }]
    aggregate3Mock.mockResolvedValue([{ returnData: '0x01' }, { returnData: '0x02' }])

    await multicallRead({
      chain: multicallChain,
      client: stubClient,
      abi: stubAbi as unknown as import('viem').Abi,
      calls,
      target: '0xFallbackTarget' as import('viem').Hex,
    })

    // aggregate3 is called as aggregate3([arg]), so mock.calls[0] = [[argArray]]
    const [[arg]] = aggregate3Mock.mock.calls[0] as [Array<{ target: string; allowFailure: boolean }>][]
    expect(arg[0].target).toBe('0xFallbackTarget')
    expect(arg[1].target).toBe(perCallTarget)
  })

  it('passes allowFailure from each call, defaulting to false', async () => {
    const calls = [{ functionName: 'name' }, { functionName: 'symbol', allowFailure: true }]
    aggregate3Mock.mockResolvedValue([{ returnData: '0x01' }, { returnData: '0x02' }])

    await multicallRead({
      chain: multicallChain,
      client: stubClient,
      abi: stubAbi as unknown as import('viem').Abi,
      calls,
      target: '0xTokenAddress',
    })

    // aggregate3 is called as aggregate3([arg]), so mock.calls[0] = [[argArray]]
    const [[arg]] = aggregate3Mock.mock.calls[0] as [Array<{ allowFailure: boolean }>][]
    expect(arg[0].allowFailure).toBe(false)
    expect(arg[1].allowFailure).toBe(true)
  })

  it('initialises getContract with multicall3Abi and the chain multicall3 address', async () => {
    const calls = [{ functionName: 'name' }]
    aggregate3Mock.mockResolvedValue([{ returnData: '0x01' }])

    await multicallRead({
      chain: multicallChain,
      client: stubClient,
      abi: stubAbi as unknown as import('viem').Abi,
      calls,
      target: '0xTokenAddress',
    })

    expect(getContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: multicallChain.contracts!.multicall3!.address,
        client: stubClient,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// erc20Read tests
// ---------------------------------------------------------------------------

describe('erc20Read', () => {
  beforeEach(() => {
    // Default: getContract returns an aggregate3 mock that is configured per-test
    const aggregate3Mock = vi.fn()
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<
      typeof getContract
    >)
  })

  afterEach(() => {
    vi.mocked(getContract).mockReset()
    vi.mocked(encodeFunctionData).mockReset()
    vi.mocked(decodeFunctionResult).mockReset()
    vi.mocked(fromHex).mockReset()
  })

  /** Helper: wire aggregate3 to resolve with fixed returnData for each field. */
  const wireAggregate3 = (values: string[]) => {
    const aggregate3Mock = vi.fn().mockResolvedValue(values.map((v) => ({ returnData: v })))
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<
      typeof getContract
    >)
    // decodeFunctionResult returns successive values based on call index
    vi.mocked(decodeFunctionResult).mockImplementation(({ functionName }) => {
      const idx = ['name', 'symbol', 'decimals'].indexOf(functionName as string)
      return values[idx] as unknown as never
    })
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
  }

  it('returns [name, symbol, decimals] when standard erc20Abi succeeds', async () => {
    wireAggregate3(['TokenName', 'TKN', '18'])

    const result = await erc20Read(multicallChain, stubClient, '0xTokenAddress')

    expect(result).toEqual(['TokenName', 'TKN', '18'])
  })

  it('falls back to erc20Abi_bytes32 when standard abi fails', async () => {
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')

    let callCount = 0
    vi.mocked(getContract).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First getContract call → standard erc20Abi → reject
        return {
          read: {
            aggregate3: vi.fn().mockRejectedValue(new Error('not standard erc20')),
          },
        } as unknown as ReturnType<typeof getContract>
      }
      // Second getContract call → bytes32 abi → resolve
      return {
        read: {
          aggregate3: vi
            .fn()
            .mockResolvedValue([{ returnData: '0xname' }, { returnData: '0xsymbol' }, { returnData: '0x12' }]),
        },
      } as unknown as ReturnType<typeof getContract>
    })

    // decodeFunctionResult for the bytes32 call returns hex strings + decimals
    vi.mocked(decodeFunctionResult).mockImplementation(({ functionName }) => {
      if (functionName === 'name')
        return '0x546f6b656e4e616d650000000000000000000000000000000000000000000000' as unknown as never
      if (functionName === 'symbol')
        return '0x544b4e0000000000000000000000000000000000000000000000000000000000' as unknown as never
      return 18 as unknown as never
    })

    // fromHex strips null bytes
    vi.mocked(fromHex).mockImplementation((hex: string) => {
      if (hex.includes('546f6b656e')) return 'TokenName\x00\x00'
      return 'TKN\x00\x00'
    })

    const result = await erc20Read(multicallChain, stubClient, '0xTokenAddress')

    // Null bytes are stripped by split('\x00').join('')
    expect(result[0]).toBe('TokenName')
    expect(result[1]).toBe('TKN')
    expect(result[2]).toBe(18)
  })

  it('skips bytes32 fallback when skipBytes32=true and rethrows (mustExist=true)', async () => {
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
    vi.mocked(getContract).mockReturnValue({
      read: {
        aggregate3: vi.fn().mockRejectedValue(new Error('standard failed')),
      },
    } as unknown as ReturnType<typeof getContract>)

    // skipBytes32 skips the bytes32 retry, mustExist ensures the outer catch re-throws
    await expect(
      erc20Read(multicallChain, stubClient, '0xTokenAddress', { skipBytes32: true, mustExist: true }),
    ).rejects.toThrow('unable to read token')

    // getContract should have been called exactly once (no bytes32 retry)
    expect(getContract).toHaveBeenCalledTimes(1)
  })

  it('returns ["", "", 18] on total failure when mustExist=false (default)', async () => {
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
    vi.mocked(getContract).mockReturnValue({
      read: {
        aggregate3: vi.fn().mockRejectedValue(new Error('all failed')),
      },
    } as unknown as ReturnType<typeof getContract>)

    const result = await erc20Read(multicallChain, stubClient, '0xTokenAddress')
    expect(result).toEqual(['', '', 18])
  })

  it('throws "unable to read token" on total failure when mustExist=true', async () => {
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
    vi.mocked(getContract).mockReturnValue({
      read: {
        aggregate3: vi.fn().mockRejectedValue(new Error('all failed')),
      },
    } as unknown as ReturnType<typeof getContract>)

    await expect(erc20Read(multicallChain, stubClient, '0xTokenAddress', { mustExist: true })).rejects.toThrow(
      'unable to read token',
    )
  })

  it('rejects with timeout error if multicallRead never resolves', async () => {
    vi.useFakeTimers()

    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
    vi.mocked(getContract).mockReturnValue({
      read: {
        // Hangs forever
        aggregate3: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    } as unknown as ReturnType<typeof getContract>)

    const promise = erc20Read(multicallChain, stubClient, '0xTokenAddress')

    // Advance past the 15 s timeout
    vi.advanceTimersByTime(16_000)

    // mustExist=false → swallowed and returns fallback
    const result = await promise
    expect(result).toEqual(['', '', 18])

    vi.useRealTimers()
  })

  it('rejects when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('test abort'))
    const chain = { id: 1, contracts: { multicall3: { address: '0x0' } } } as any
    const client = {} as any
    const target = '0x0000000000000000000000000000000000000001' as `0x${string}`
    await expect(erc20Read(chain, client, target, { signal: controller.signal })).rejects.toThrow('test abort')
  })

  it('rejects with the abort reason when the signal aborts mid-flight', async () => {
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
    vi.mocked(getContract).mockReturnValue({
      read: {
        // Never settles, so the only way out is the abort listener.
        aggregate3: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    } as unknown as ReturnType<typeof getContract>)

    const controller = new AbortController()
    const promise = erc20Read(multicallChain, stubClient, '0xTokenAddress', { signal: controller.signal })

    // Distinct from the already-aborted case above: here the read is genuinely
    // in flight, so cancellation has to arrive through the abort listener —
    // which clears the timeout and rejects — rather than the entry guard. An
    // abort must surface even though mustExist is false, since a cancelled
    // read is not the same as a token that could not be read.
    controller.abort(new Error('aborted mid-flight'))

    await expect(promise).rejects.toThrow('aborted mid-flight')
  })
})
