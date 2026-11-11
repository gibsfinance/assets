/**
 * @module collect/etherscan
 *
 * Token metadata and logos from the Etherscan API V2 (https://docs.etherscan.io), for the tokens
 * other providers already rank first. This replaces the retired page scraper that used a headless
 * browser; it reads the documented API only.
 *
 * Etherscan has no endpoint that ranks or lists tokens (the token module, per
 * https://docs.etherscan.io/endpoint-overview, only answers questions about a token you name). So
 * this collector does not discover tokens. It takes the first tokens of other providers' lists
 * from this database (`ETHERSCAN_SOURCE_LISTS`) and asks Etherscan's `tokeninfo` endpoint for
 * each: name, symbol, decimals and a logo address.
 *
 * `tokeninfo` is an API Pro endpoint, and the free plan covers only some chains. Nothing here
 * assumes what the key may do. Discovery probes first (see `./etherscan-capability`), and the
 * collector touches only the chains whose probe answered `ok`:
 *
 * - A chain or endpoint the key cannot use is skipped with one log line, is not a failure, and is
 *   not asked again in the run.
 * - With a free key every chain is skipped, and the run does nothing but log why.
 * - A refusal that arrives in the middle of a chain stops that chain at once and leaves its
 *   published list as it was; a half-walked chain never becomes a new version.
 *
 * Each chain publishes one list, `top-tokens-<chainId>`, with the same membership versioning as
 * Jupiter (see `./list-publication`). The provider key is `etherscan`, the key the retired
 * collector used, so its existing rows and list addresses stay valid.
 */
import { failureLog, limitBy } from '@gibs/utils'
import config from '../../config'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, type DiscoveryManifest } from './base-collector'
import {
  createCachedProbe,
  createClientFromSettings,
  NEEDED_ENDPOINTS,
  probeConfiguredKey,
  usableChains,
  type EtherscanCapabilityReport,
  type EtherscanChainCapability,
  type EtherscanClientOverrides,
} from './etherscan-capability'
import type { EtherscanClient } from './etherscan-client'
import { parseTokenInfo, type EtherscanClassification, type EtherscanTokenInfo } from './etherscan-response'
import { ETHERSCAN_PROVIDER_KEY } from './etherscan-settings'
import { publishWalkedList, resolveListVersion } from './list-publication'

const providerKey = ETHERSCAN_PROVIDER_KEY
const providerName = 'Etherscan'

/** Token lookups in flight at once. The client spaces their start times to the plan's rate. */
const LOOKUP_CONCURRENCY = 3
/** Logos stored at once. */
const STORE_CONCURRENCY = 8

/** The addresses that mean "the chain's own coin" in other providers' lists, which are not contracts. */
const NATIVE_COIN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
])

/**
 * Keep the addresses `tokeninfo` can be asked about: 20-byte hexadecimal contract addresses, not
 * the native coin placeholders, each once, in order.
 */
export const selectFetchableAddresses = (addresses: readonly string[]): string[] => {
  const fetchable = addresses
    .map((address) => address.toLowerCase())
    .filter((address) => /^0x[0-9a-f]{40}$/.test(address) && !NATIVE_COIN_ADDRESSES.has(address))
  return [...new Set(fetchable)]
}

/** The list key for a chain. */
export const listKeyForChain = (chainId: number): string => `top-tokens-${chainId}`

/** One chain ready to collect: its network, and the addresses to ask about. */
type PreparedChain = {
  chain: EtherscanChainCapability
  providerId: string
  networkId: string
  addresses: string[]
}

/** What asking about a chain's tokens produced. */
export type ChainLookup = {
  /** The tokens Etherscan described, in source order. */
  tokens: EtherscanTokenInfo[]
  /** Addresses Etherscan had no usable ERC-20 record for. */
  unreadable: number
  /** The refusal that stopped the walk, or null when every address was asked. */
  stoppedBy: EtherscanClassification | null
}

/**
 * Ask `tokeninfo` about each address on one chain.
 *
 * An answer of `ok` is read; an `other` answer (no record, a collection instead of a token, a network
 * fault) counts the address as unreadable and goes on. Any other answer says something about the key
 * or the plan, not about the token, so the walk stops there and no further calls are made.
 */
export const lookupChainTokens = async ({
  client,
  chainId,
  addresses,
  signal,
}: {
  client: EtherscanClient
  chainId: number
  addresses: string[]
  signal: AbortSignal
}): Promise<ChainLookup> => {
  const progress: { stoppedBy: EtherscanClassification | null; unreadable: number } = { stoppedBy: null, unreadable: 0 }
  const limit = limitBy<string>(`${providerKey}-lookup`, LOOKUP_CONCURRENCY)
  const found = await limit.map(addresses, async (address) => {
    if (signal.aborted || progress.stoppedBy) return null
    const { classification, result } = await client.call({ chainId, endpoint: 'tokeninfo', address })
    if (classification.outcome === 'ok') {
      const token = parseTokenInfo(result)
      if (!token) progress.unreadable += 1
      return token
    }
    if (classification.outcome === 'other') {
      progress.unreadable += 1
      return null
    }
    progress.stoppedBy ??= classification
    return null
  })
  return { tokens: found.filter((token): token is EtherscanTokenInfo => token !== null), ...progress }
}

/** Log one line for each chain and endpoint the key cannot use. */
const logSkippedChains = (report: EtherscanCapabilityReport): void => {
  for (const chain of report.chains) {
    for (const endpoint of NEEDED_ENDPOINTS) {
      const { outcome, detail } = chain.endpoints[endpoint]
      if (outcome === 'ok') continue
      failureLog(
        'provider=%o chain=%o endpoint=%o skipped: %o (%o)',
        providerKey,
        chain.chainId,
        endpoint,
        outcome,
        detail,
      )
    }
  }
}

/**
 * The Etherscan collector. The constructor takes replacement fetch, clock and sleep for tests;
 * production uses the default instance, which takes none.
 */
export class EtherscanCollector extends BaseCollector {
  readonly key = providerKey

  private readonly clientOverrides: EtherscanClientOverrides

  private client: EtherscanClient | null = null
  private prepared: PreparedChain[] = []
  private readReport: (() => Promise<EtherscanCapabilityReport>) | null = null

  constructor(clientOverrides: EtherscanClientOverrides = {}) {
    super()
    this.clientOverrides = clientOverrides
  }

  /**
   * The capability report, asked for once per run. The cache lives as long as this collector, and
   * a process runs the collector once.
   */
  private report(signal: AbortSignal): Promise<EtherscanCapabilityReport> {
    if (!this.readReport) {
      const settings = config.etherscan
      this.client = createClientFromSettings(settings, { ...this.clientOverrides, signal })
      const client = this.client
      this.readReport = createCachedProbe(() => probeConfiguredKey({ settings, client }))
    }
    return this.readReport()
  }

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    this.prepared = []
    const settings = config.etherscan
    if (!settings.apiKey) {
      failureLog('provider=%o skipped: ETHERSCAN_API_KEY is not set', providerKey)
      return []
    }
    const report = await this.report(signal)
    if (signal.aborted) return []
    logSkippedChains(report)
    const usable = usableChains(report, NEEDED_ENDPOINTS)
    if (usable.length === 0) {
      failureLog(
        'provider=%o collects nothing: no chain can use %o with this key (run `etherscan check` for the detail)',
        providerKey,
        NEEDED_ENDPOINTS.join(', '),
      )
      return []
    }

    const [provider] = await db.insertProvider({ key: providerKey, name: providerName })
    for (const chain of usable) {
      const network = await db.insertNetworkFromChainId(chain.chainId, 'evm')
      const addresses = selectFetchableAddresses(
        await db.getTopTokenAddresses({
          networkId: network.networkId,
          sources: settings.sourceLists,
          limit: settings.tokensPerChain,
        }),
      )
      if (addresses.length === 0) {
        failureLog(
          'provider=%o chain=%o skipped: no source list names a token on this chain yet',
          providerKey,
          chain.chainId,
        )
        continue
      }
      this.prepared.push({ chain, providerId: provider.providerId, networkId: network.networkId, addresses })
    }
    return [{ providerKey, lists: this.prepared.map(({ chain }) => ({ listKey: listKeyForChain(chain.chainId) })) }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const client = this.client
    if (!client || this.prepared.length === 0) return
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      for (const prepared of this.prepared) {
        if (signal.aborted) return
        await this.collectChain({ prepared, client, row, signal })
      }
    } finally {
      row.complete()
    }
  }

  /**
   * Look up one chain's tokens, then file and publish them as a list. Nothing is written until the
   * whole chain has been asked about, so a refusal part way leaves the published list untouched.
   */
  private async collectChain({
    prepared,
    client,
    row,
    signal,
  }: {
    prepared: PreparedChain
    client: EtherscanClient
    row: ReturnType<typeof utils.terminal.issue>
    signal: AbortSignal
  }): Promise<void> {
    const { chain, providerId, networkId, addresses } = prepared
    const listKey = listKeyForChain(chain.chainId)
    const lookup = await lookupChainTokens({ client, chainId: chain.chainId, addresses, signal })
    if (signal.aborted) return
    if (lookup.stoppedBy) {
      failureLog(
        'provider=%o chain=%o stopped: %o (%o); the published list is left as it was',
        providerKey,
        chain.chainId,
        lookup.stoppedBy.outcome,
        lookup.stoppedBy.detail,
      )
      return
    }
    if (lookup.tokens.length === 0) {
      failureLog(
        'provider=%o chain=%o skipped: no token had a record (%d unreadable)',
        providerKey,
        chain.chainId,
        lookup.unreadable,
      )
      return
    }

    const [list] = await db.insertList({
      providerId,
      providerKey,
      networkId,
      key: listKey,
      name: `Etherscan: top tokens (${chain.name})`,
      ...(await resolveListVersion({ providerId, listKey, addresses: lookup.tokens.map(({ address }) => address) })),
    })
    row.createCounter(terminalCounterTypes.TOKEN)
    row.incrementTotal(terminalCounterTypes.TOKEN, new Set(lookup.tokens.map(({ address }) => `${listKey}:${address}`)))
    let stored = 0
    const limit = limitBy<EtherscanTokenInfo & { orderIdx: number }>(`${providerKey}-insert`, STORE_CONCURRENCY)
    await limit.map(
      lookup.tokens.map((token, orderIdx) => ({ ...token, orderIdx })),
      async (token) => {
        if (signal.aborted) return
        const counterId = `${listKey}:${token.address}`
        try {
          await db.fetchImageAndStoreForToken({
            listId: list.listId,
            listTokenOrderId: token.orderIdx,
            uri: token.logoURI,
            originalUri: token.logoURI,
            providerKey,
            listLicense: list.license,
            signal,
            token: {
              name: token.name,
              symbol: token.symbol,
              decimals: token.decimals,
              networkId,
              providedId: token.address,
            },
          })
          stored += 1
          row.increment(terminalCounterTypes.TOKEN, counterId)
        } catch (err) {
          row.increment('erred', counterId)
          failureLog('token %o/%o/%o failed: %o', providerKey, listKey, token.address, (err as Error).message)
        }
      },
    )
    await publishWalkedList({ providerKey, providerId, listKey, listId: list.listId, stored, signal })
  }
}

const instance = new EtherscanCollector()
export default instance

/** Standalone entry point that runs both phases, mirroring the other collectors' convenience export. */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
