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
  }
})

import { http, fallback, createPublicClient } from 'viem'
import { buildTransport, createChainClient } from './viem'

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
