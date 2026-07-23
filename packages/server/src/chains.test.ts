import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pulsechainV4 as viemPulsechainV4 } from 'viem/chains'

const collect = vi.fn()
vi.mock('./args', () => ({ collect: () => collect() }))

const RPC_ENV_KEYS = ['RPC_56', 'RPC_11155111', 'RPC_943'] as const
const originalEnv: Record<string, string | undefined> = {}

describe('chains (default export)', () => {
  beforeEach(() => {
    vi.resetModules()
    collect.mockReset()
    for (const key of RPC_ENV_KEYS) {
      originalEnv[key] = process.env[key]
      Reflect.deleteProperty(process.env, key)
    }
  })

  afterEach(() => {
    for (const key of RPC_ENV_KEYS) {
      if (originalEnv[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = originalEnv[key]
    }
  })

  it('resolves rpc urls from CLI args, then the per-chain env var, then the viem default', async () => {
    // mainnet/pulsechain read straight off the CLI-args arrays, and rpc1's
    // weight suffix must be stripped before it ever reaches a chain config.
    collect.mockReturnValue({
      rpc1: ['https://mainnet-cli.example|3'],
      rpc369: ['https://pulsechain-cli.example'],
      // bsc: args non-empty, so it must win over any env var entirely.
      rpc56: ['https://bsc-cli-a.example', 'https://bsc-cli-b.example'],
      // sepolia: args empty, so the env var is consulted and must be split on commas.
      rpc11155111: [],
      // pulsechainV4: args empty AND env var unset, so it must fall through to
      // viem's own bundled default rather than an empty rpc list.
      rpc943: [],
    })
    process.env.RPC_56 = 'https://bsc-env-should-be-ignored.example'
    process.env.RPC_11155111 = 'https://sepolia-env-a.example,https://sepolia-env-b.example'

    const buildChains = (await import('./chains')).default
    const chains = buildChains()

    expect(chains.mainnet.rpcUrls.default.http).toEqual(['https://mainnet-cli.example'])
    expect(chains.pulsechain.rpcUrls.default.http).toEqual(['https://pulsechain-cli.example'])
    expect(chains.bsc.rpcUrls.default.http).toEqual(['https://bsc-cli-a.example', 'https://bsc-cli-b.example'])
    expect(chains.sepolia.rpcUrls.default.http).toEqual([
      'https://sepolia-env-a.example',
      'https://sepolia-env-b.example',
    ])
    expect(chains.pulsechainV4.rpcUrls.default.http).toEqual(viemPulsechainV4.rpcUrls.default.http)

    // Still real viem chain objects, not fabricated stand-ins.
    expect(chains.mainnet.id).toBe(1)
    expect(chains.pulsechainV4.id).toBe(viemPulsechainV4.id)
  })

  it('memoizes so the CLI/env configuration is only read once per process', async () => {
    collect.mockReturnValue({ rpc1: [], rpc369: [], rpc56: [], rpc11155111: [], rpc943: [] })

    const buildChains = (await import('./chains')).default
    const first = buildChains()
    const second = buildChains()

    expect(second).toBe(first)
    expect(collect).toHaveBeenCalledTimes(1)
  })
})
