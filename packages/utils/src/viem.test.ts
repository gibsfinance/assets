import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Chain } from 'viem'

// ---------------------------------------------------------------------------
// Viem mock
// We mock the whole 'viem' module so that no real RPC calls are made.
// The mocks return simple sentinel values that let us assert which
// transport-building path was taken (single http vs. fallback).
// ---------------------------------------------------------------------------
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    http: vi.fn((url: string) => ({ type: 'http', url })),
    fallback: vi.fn((transports: unknown[], opts: unknown) => ({ type: 'fallback', transports, opts })),
    createPublicClient: vi.fn((config: unknown) => ({ type: 'publicClient', config })),
    getContract: vi.fn(),
    encodeFunctionData: vi.fn(),
    decodeFunctionResult: vi.fn(),
    fromHex: vi.fn((hex: string, _encoding: string) => hex),
  }
})

import { http, fallback, createPublicClient, getContract, encodeFunctionData, decodeFunctionResult, fromHex } from 'viem'
import { buildTransport, createChainClient, multicallRead, erc20Read } from './viem'

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
const chainWithMultipleRpcs = makeChain(999, [
  'https://rpc1.example.com',
  'https://rpc2.example.com',
])

const chainWithSingleRpc = makeChain(998, ['https://single.example.com'])

// Chain ID that has hardcoded overrides inside buildTransport (chain 1 = Ethereum mainnet).
const mainnetChain = makeChain(1, ['https://chain-default.example.com'])

// ---------------------------------------------------------------------------

describe('buildTransport', () => {
  beforeEach(() => {
    vi.mocked(http).mockClear()
    vi.mocked(fallback).mockClear()
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
    expect(http).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledWith('https://single.example.com', expect.objectContaining({ timeout: expect.any(Number) }))
    expect(fallback).not.toHaveBeenCalled()
  })

  it('returns a fallback transport when the resolved URL list has multiple entries', () => {
    buildTransport(chainWithMultipleRpcs)
    expect(fallback).toHaveBeenCalledTimes(1)
    // fallback receives an array of http transports, one per URL
    const [transports] = vi.mocked(fallback).mock.calls[0]
    expect(transports).toHaveLength(2)
    expect(http).toHaveBeenCalledTimes(2)
  })

  it('uses RPC_{chainId} env var (single URL) over chain defaults', () => {
    process.env['RPC_998'] = 'https://env-single.example.com'
    buildTransport(chainWithSingleRpc)
    expect(http).toHaveBeenCalledWith('https://env-single.example.com', expect.any(Object))
    expect(fallback).not.toHaveBeenCalled()
  })

  it('uses RPC_{chainId} env var (comma-separated) and builds a fallback transport', () => {
    process.env['RPC_998'] = 'https://env-a.example.com,https://env-b.example.com'
    buildTransport(chainWithSingleRpc)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledTimes(2)
    expect(http).toHaveBeenCalledWith('https://env-a.example.com', expect.any(Object))
    expect(http).toHaveBeenCalledWith('https://env-b.example.com', expect.any(Object))
  })

  it('falls back to hardcoded overrides when no env var is set (chain 1)', () => {
    // Chain 1 has 3 hardcoded override URLs; no env var set.
    buildTransport(mainnetChain)
    expect(fallback).toHaveBeenCalledTimes(1)
    const [transports] = vi.mocked(fallback).mock.calls[0]
    expect(transports).toHaveLength(3)
  })

  it('passes { rank: false } to the fallback transport', () => {
    buildTransport(chainWithMultipleRpcs)
    const [, opts] = vi.mocked(fallback).mock.calls[0]
    expect(opts).toEqual({ rank: false })
  })

  it('ignores empty segments in comma-separated env var', () => {
    process.env['RPC_998'] = 'https://only.example.com,'
    buildTransport(chainWithSingleRpc)
    // One non-empty URL → single http transport
    expect(http).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })
})

describe('createChainClient', () => {
  beforeEach(() => {
    vi.mocked(createPublicClient).mockClear()
    vi.mocked(http).mockClear()
    vi.mocked(fallback).mockClear()
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
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<typeof getContract>)
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
    const calls = [
      { functionName: 'name' },
      { functionName: 'symbol' },
    ]
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
    const calls = [
      { functionName: 'name' },
      { functionName: 'totalSupply', abi: perCallAbi },
    ]
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
    const calls = [
      { functionName: 'name' },
      { functionName: 'symbol', target: perCallTarget },
    ]
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
    const calls = [
      { functionName: 'name' },
      { functionName: 'symbol', allowFailure: true },
    ]
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
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<typeof getContract>)
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
    vi.mocked(getContract).mockReturnValue({ read: { aggregate3: aggregate3Mock } } as unknown as ReturnType<typeof getContract>)
    // decodeFunctionResult returns successive values based on call index
    vi.mocked(decodeFunctionResult).mockImplementation(({ functionName }) => {
      const idx = ['name', 'symbol', 'decimals'].indexOf(functionName as string)
      return values[idx] as unknown as never
    })
    vi.mocked(encodeFunctionData).mockReturnValue('0xcalldata')
  }

  it('returns [name, symbol, decimals] when standard erc20Abi succeeds', async () => {
    wireAggregate3(['TokenName', 'TKN', '18'])

    const result = await erc20Read(
      multicallChain,
      stubClient,
      '0xTokenAddress',
    )

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
          aggregate3: vi.fn().mockResolvedValue([
            { returnData: '0xname' },
            { returnData: '0xsymbol' },
            { returnData: '0x12' },
          ]),
        },
      } as unknown as ReturnType<typeof getContract>
    })

    // decodeFunctionResult for the bytes32 call returns hex strings + decimals
    vi.mocked(decodeFunctionResult).mockImplementation(({ functionName }) => {
      if (functionName === 'name') return '0x546f6b656e4e616d650000000000000000000000000000000000000000000000' as unknown as never
      if (functionName === 'symbol') return '0x544b4e0000000000000000000000000000000000000000000000000000000000' as unknown as never
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

    await expect(
      erc20Read(multicallChain, stubClient, '0xTokenAddress', { mustExist: true }),
    ).rejects.toThrow('unable to read token')
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
    await expect(
      erc20Read(chain, client, target, { signal: controller.signal }),
    ).rejects.toThrow('test abort')
  })
})
