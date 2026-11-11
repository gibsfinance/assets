import { describe, expect, it, vi } from 'vitest'
import { ETHERSCAN_CHAINS, selectChains } from './etherscan-chains'
import type { EtherscanCallRequest, EtherscanClient } from './etherscan-client'
import {
  createCachedProbe,
  createClientFromSettings,
  formatCapabilityReport,
  NEEDED_ENDPOINTS,
  probeCapabilities,
  probeConfiguredKey,
  usableChains,
  type EtherscanCapabilityReport,
} from './etherscan-capability'
import { readEtherscanSettings } from './etherscan-settings'
import { CHAIN_REFUSAL, PRO_REFUSAL } from './__testing__/etherscan-fixtures'

const KEY = 'SECRETKEY123'
const okCall = { classification: { outcome: 'ok', detail: 'OK' }, result: [] } as const

/** What the free key answered on 2026-11-11, extended to the chains it was not measured on. */
const FREE_KEY_PAID_CHAINS = new Set(['10', '56', '100', '8453', '43114'])

/** A fetch that answers as a free key does: Pro refusal on free chains, chain refusal on paid chains. */
const freeKeyFetch = () =>
  vi.fn(async (input: string | URL | Request) => {
    const chainId = new URL(String(input)).searchParams.get('chainid') ?? ''
    const result = FREE_KEY_PAID_CHAINS.has(chainId) ? CHAIN_REFUSAL : PRO_REFUSAL
    return { status: 200, json: async () => ({ status: '0', message: 'NOTOK', result }) } as Response
  })

const instant = { now: () => 0, sleep: async () => undefined }

describe('selectChains', () => {
  it('returns every known chain when no ids are given', () => {
    expect(selectChains(null)).toEqual(ETHERSCAN_CHAINS)
  })

  it('returns only the listed chains and ignores ids it has no probe token for', () => {
    expect(selectChains([137, 1, 999_999]).map((chain) => chain.chainId)).toEqual([1, 137])
  })

  it('knows each chain once, with a hexadecimal probe token', () => {
    const ids = ETHERSCAN_CHAINS.map((chain) => chain.chainId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const chain of ETHERSCAN_CHAINS) expect(chain.knownToken).toMatch(/^0x[0-9a-f]{40}$/)
  })
})

describe('probeCapabilities', () => {
  it("asks each endpoint once per chain, with that chain's known token", async () => {
    const call = vi.fn(async (_request: EtherscanCallRequest) => okCall)
    const client: EtherscanClient = { call }

    const report = await probeCapabilities({ client, chains: selectChains([1, 137]) })

    expect(call.mock.calls.map(([request]) => request)).toEqual([
      { chainId: 1, endpoint: 'tokeninfo', address: ETHERSCAN_CHAINS[0].knownToken },
      {
        chainId: 137,
        endpoint: 'tokeninfo',
        address: ETHERSCAN_CHAINS.find((chain) => chain.chainId === 137)?.knownToken,
      },
    ])
    expect(report.keyConfigured).toBe(true)
    expect(usableChains(report, NEEDED_ENDPOINTS).map((chain) => chain.chainId)).toEqual([1, 137])
  })

  it('makes no call and reports every chain as refused when there is no key', async () => {
    const report = await probeCapabilities({ client: null, chains: selectChains([1]) })

    expect(report).toEqual({
      keyConfigured: false,
      chains: [
        {
          chainId: 1,
          name: 'Ethereum',
          endpoints: { tokeninfo: { outcome: 'invalid-key', detail: 'ETHERSCAN_API_KEY is not set' } },
        },
      ],
    })
  })

  it('stops asking once Etherscan refuses the key, so a bad key is not hammered', async () => {
    const call = vi.fn(async () => ({
      classification: { outcome: 'invalid-key', detail: 'Invalid API Key' },
      result: null,
    }))

    const report = await probeCapabilities({ client: { call } as EtherscanClient, chains: selectChains([1, 10, 137]) })

    expect(call).toHaveBeenCalledTimes(1)
    expect(report.chains.map((chain) => chain.endpoints.tokeninfo)).toEqual([
      { outcome: 'invalid-key', detail: 'Invalid API Key' },
      { outcome: 'invalid-key', detail: 'not asked: Invalid API Key' },
      { outcome: 'invalid-key', detail: 'not asked: Invalid API Key' },
    ])
  })

  it('records a mix of answers per chain and keeps asking after a plan refusal', async () => {
    const call = vi.fn(async ({ chainId }: { chainId: number }) =>
      chainId === 1
        ? okCall
        : { classification: { outcome: 'chain-not-on-plan', detail: CHAIN_REFUSAL }, result: null },
    )

    const report = await probeCapabilities({ client: { call } as EtherscanClient, chains: selectChains([1, 56, 137]) })

    expect(call).toHaveBeenCalledTimes(3)
    expect(usableChains(report, NEEDED_ENDPOINTS).map((chain) => chain.chainId)).toEqual([1])
  })
})

describe('probeConfiguredKey and createClientFromSettings', () => {
  it('creates no client without a key', () => {
    expect(createClientFromSettings(readEtherscanSettings({}))).toBeNull()
  })

  it('probes the chains the settings select with the client it is given', async () => {
    const settings = readEtherscanSettings({ ETHERSCAN_API_KEY: KEY, ETHERSCAN_CHAIN_IDS: '1,56' })
    const fetchImplementation = freeKeyFetch()
    const client = createClientFromSettings(settings, { fetchImplementation, ...instant })

    const report = await probeConfiguredKey({ settings, client })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(report.chains.map((chain) => chain.endpoints.tokeninfo.outcome)).toEqual([
      'requires-pro',
      'chain-not-on-plan',
    ])
  })
})

describe('createCachedProbe', () => {
  it('runs the probe once and gives every caller the same report', async () => {
    const report: EtherscanCapabilityReport = { keyConfigured: true, chains: [] }
    const probe = vi.fn(async () => report)
    const cached = createCachedProbe(probe)

    expect(await cached()).toBe(report)
    expect(await cached()).toBe(report)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe('formatCapabilityReport with a free key', () => {
  it("prints one row per chain, Etherscan's own words, and the verdict, and never the key", async () => {
    const settings = readEtherscanSettings({ ETHERSCAN_API_KEY: KEY })
    const client = createClientFromSettings(settings, { fetchImplementation: freeKeyFetch(), ...instant })
    const report = await probeConfiguredKey({ settings, client })

    const lines = formatCapabilityReport(report, NEEDED_ENDPOINTS)

    expect(lines.join('\n')).not.toContain(KEY)
    expect(lines).toEqual([
      'Etherscan API V2 key check (key set)',
      '',
      `Ethereum (1)               tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      `OP Mainnet (10)            tokeninfo  chain-not-on-plan  ${CHAIN_REFUSAL}`,
      `BNB Smart Chain (56)       tokeninfo  chain-not-on-plan  ${CHAIN_REFUSAL}`,
      `Gnosis (100)               tokeninfo  chain-not-on-plan  ${CHAIN_REFUSAL}`,
      `Polygon (137)              tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      `Mantle (5000)              tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      `Base (8453)                tokeninfo  chain-not-on-plan  ${CHAIN_REFUSAL}`,
      `Arbitrum One (42161)       tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      `Celo (42220)               tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      `Avalanche C-Chain (43114)  tokeninfo  chain-not-on-plan  ${CHAIN_REFUSAL}`,
      `Linea (59144)              tokeninfo  requires-pro       ${PRO_REFUSAL}`,
      '',
      'Usable chains: none. The collector needs tokeninfo and will collect nothing.',
    ])
  })
})

describe('formatCapabilityReport with a Pro key', () => {
  it('lists the usable chains', async () => {
    const report = await probeCapabilities({
      client: { call: async () => okCall } as EtherscanClient,
      chains: selectChains([1, 137]),
    })

    expect(formatCapabilityReport(report, NEEDED_ENDPOINTS).at(-1)).toBe('Usable chains: Ethereum (1), Polygon (137)')
  })

  it('says the key is not set when it is not', async () => {
    const report = await probeCapabilities({ client: null, chains: selectChains([1]) })
    expect(formatCapabilityReport(report, NEEDED_ENDPOINTS)[0]).toBe('Etherscan API V2 key check (key not set)')
  })
})
