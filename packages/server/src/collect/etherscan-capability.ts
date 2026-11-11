/**
 * @module collect/etherscan-capability
 *
 * Finds out what the configured Etherscan key may do, by asking. Etherscan sells access by plan
 * and by chain, and nothing in the key itself says which. So the probe calls each endpoint the
 * collector needs once per chain, with a known token, and records how Etherscan answered.
 *
 * The collector reads the report and touches only the chain and endpoint pairs that answered `ok`.
 * The `etherscan check` command prints the same report.
 *
 * The report never holds the key. It holds chain ids, endpoint names, outcomes and Etherscan's own
 * refusal text.
 */
import { selectChains, type EtherscanChain } from './etherscan-chains'
import {
  createEtherscanClient,
  ETHERSCAN_ENDPOINTS,
  type EtherscanClient,
  type EtherscanClientOptions,
  type EtherscanEndpointName,
} from './etherscan-client'
import type { EtherscanClassification } from './etherscan-response'
import type { EtherscanSettings } from './etherscan-settings'

/** The parts of a client the settings do not decide: fetch, clock, sleep and the abort signal. */
export type EtherscanClientOverrides = Partial<Omit<EtherscanClientOptions, 'apiKey' | 'callsPerSecond'>>

/** The endpoints the collector cannot work without. A chain is used only when all of them answered `ok`. */
export const NEEDED_ENDPOINTS: readonly EtherscanEndpointName[] = ['tokeninfo']

/** How Etherscan answered for each endpoint on one chain. */
export type EtherscanChainCapability = {
  chainId: number
  name: string
  endpoints: Record<EtherscanEndpointName, EtherscanClassification>
}

/** What a key may do. */
export type EtherscanCapabilityReport = {
  /** False when no key is set; then no call was made and every outcome is `invalid-key`. */
  keyConfigured: boolean
  chains: EtherscanChainCapability[]
}

const endpointNames = Object.keys(ETHERSCAN_ENDPOINTS) as EtherscanEndpointName[]

const refusedWithoutCalling = (detail: string): Record<EtherscanEndpointName, EtherscanClassification> =>
  Object.fromEntries(endpointNames.map((name) => [name, { outcome: 'invalid-key', detail }])) as Record<
    EtherscanEndpointName,
    EtherscanClassification
  >

/**
 * Ask Etherscan what the key may do on each chain.
 *
 * Calls run one after another, which the client spaces to the plan's rate. Each chain and endpoint
 * is asked once and never again, whatever the answer. When Etherscan says the key is invalid, the
 * remaining chains are not asked: more calls with a refused key only earn a temporary block
 * ("Too many invalid api key attempts", https://docs.etherscan.io/common-error-messages).
 *
 * @param options.client A client bound to the key, or null when no key is set.
 * @param options.chains The chains to ask about.
 */
export const probeCapabilities = async ({
  client,
  chains,
}: {
  client: EtherscanClient | null
  chains: readonly EtherscanChain[]
}): Promise<EtherscanCapabilityReport> => {
  if (client === null) {
    const detail = 'ETHERSCAN_API_KEY is not set'
    return {
      keyConfigured: false,
      chains: chains.map(({ chainId, name }) => ({ chainId, name, endpoints: refusedWithoutCalling(detail) })),
    }
  }
  const capabilities: EtherscanChainCapability[] = []
  let keyRefusal: string | null = null
  for (const { chainId, name, knownToken } of chains) {
    if (keyRefusal !== null) {
      capabilities.push({ chainId, name, endpoints: refusedWithoutCalling(`not asked: ${keyRefusal}`) })
      continue
    }
    const endpoints = {} as Record<EtherscanEndpointName, EtherscanClassification>
    for (const endpoint of endpointNames) {
      const { classification } = await client.call({ chainId, endpoint, address: knownToken })
      endpoints[endpoint] = classification
      if (classification.outcome === 'invalid-key') keyRefusal = classification.detail
    }
    capabilities.push({ chainId, name, endpoints })
  }
  return { keyConfigured: true, chains: capabilities }
}

/**
 * A client for the key in the settings, or null when none is set.
 *
 * @param settings The Etherscan settings.
 * @param clientOptions Replaceable fetch, clock, sleep and abort signal.
 */
export const createClientFromSettings = (
  settings: EtherscanSettings,
  clientOptions: EtherscanClientOverrides = {},
): EtherscanClient | null => {
  const { apiKey, callsPerSecond } = settings
  return apiKey ? createEtherscanClient({ apiKey, callsPerSecond, ...clientOptions }) : null
}

/**
 * Probe the chains the settings select with the given client. The collector and the
 * `etherscan check` command both call this, so both see the same thing.
 *
 * @param options.settings The Etherscan settings, which choose the chains.
 * @param options.client A client from {@link createClientFromSettings}.
 */
export const probeConfiguredKey = ({
  settings,
  client,
}: {
  settings: EtherscanSettings
  client: EtherscanClient | null
}): Promise<EtherscanCapabilityReport> => probeCapabilities({ client, chains: selectChains(settings.chainIds) })

/**
 * Run a probe once and give the same report to every later caller. The report is for the run:
 * what a key may do does not change in minutes, and asking again spends calls from the daily
 * allowance for nothing.
 */
export const createCachedProbe = (
  probe: () => Promise<EtherscanCapabilityReport>,
): (() => Promise<EtherscanCapabilityReport>) => {
  let cached: Promise<EtherscanCapabilityReport> | null = null
  return () => {
    cached ??= probe()
    return cached
  }
}

/** The chains where every endpoint in `needed` answered `ok`. */
export const usableChains = (
  report: EtherscanCapabilityReport,
  needed: readonly EtherscanEndpointName[],
): EtherscanChainCapability[] =>
  report.chains.filter((chain) => needed.every((endpoint) => chain.endpoints[endpoint].outcome === 'ok'))

/**
 * Render a report as lines of text for an operator.
 *
 * Shows one row per chain and endpoint with the outcome and Etherscan's own words, then a verdict.
 * Holds no key: the report has none to print.
 *
 * @param report What the probe found.
 * @param needed The endpoints the collector needs; a chain is usable when all of them answered `ok`.
 */
export const formatCapabilityReport = (
  report: EtherscanCapabilityReport,
  needed: readonly EtherscanEndpointName[],
): string[] => {
  const lines = [`Etherscan API V2 key check (key ${report.keyConfigured ? 'set' : 'not set'})`, '']
  for (const chain of report.chains) {
    for (const endpoint of endpointNames) {
      const { outcome, detail } = chain.endpoints[endpoint]
      lines.push(
        `${`${chain.name} (${chain.chainId})`.padEnd(26)} ${endpoint.padEnd(10)} ${outcome.padEnd(18)} ${detail}`,
      )
    }
  }
  const usable = usableChains(report, needed)
  lines.push('')
  if (usable.length === 0) {
    lines.push(`Usable chains: none. The collector needs ${needed.join(', ')} and will collect nothing.`)
    return lines
  }
  lines.push(`Usable chains: ${usable.map((chain) => `${chain.name} (${chain.chainId})`).join(', ')}`)
  return lines
}
