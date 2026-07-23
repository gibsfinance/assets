import * as path from 'path'
import * as fs from 'fs'
import { failureLog, limitBy } from '@gibs/utils'
import _ from 'lodash'

import * as db from '../db'
import * as types from '../types'
import * as utils from '../utils'
import * as paths from '../paths'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { terminalLogTypes, terminalRowTypes, TerminalRowProxy } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { NETWORK_MAPPING, parseTokenRecord } from './ethereum-lists-parse'

const providerKey = 'ethereum-lists'
const providerName = 'Ethereum Lists'
const tokensRoot = path.join(paths.submodules, 'ethereum-lists-tokens', 'tokens')

/** A folder under `tokens/` that resolved to a mapped chain and was read off disk. */
type IncludedNetwork = {
  slug: string
  chainId: number
  listKey: string
  tokenList: types.TokenList
  discovered: inmemoryTokenlist.DiscoveredState
}

/**
 * Read a single token file and narrow it to a token-list entry, incrementing the
 * skip counter for any file that fails to parse or fails validation. One bad file
 * must never abort the folder, so every failure resolves to null rather than throwing.
 * @param filePath Absolute path to the token file.
 * @param chainId The numeric chain id resolved from the folder slug.
 * @param row The terminal row that tracks skipped files.
 */
const readTokenFile = async (
  filePath: string,
  chainId: number,
  row: TerminalRowProxy,
): Promise<types.TokenEntry | null> => {
  const contents = await fs.promises.readFile(filePath, 'utf8').catch(() => null)
  if (contents === null) {
    row.increment('skipped', filePath)
    return null
  }
  const parsed = parseJson(contents)
  const entry = parsed === undefined ? null : parseTokenRecord(parsed, chainId)
  if (!entry) {
    row.increment('skipped', filePath)
    return null
  }
  return entry
}

/**
 * Parse a token file's contents, returning undefined on malformed JSON. External
 * input is never trusted to be valid, so a parse failure is a skip, not a throw.
 * @param contents The raw file contents.
 */
const parseJson = (contents: string): unknown => {
  try {
    return JSON.parse(contents) as unknown
  } catch {
    return undefined
  }
}

/**
 * Build an in-memory token list for one network folder by reading and validating
 * every token file it contains. The resulting list is handed to inmemory-tokenlist
 * discover/collect, exactly as remote-tokenlist delegates its parsed JSON.
 * @param slug The folder name under `tokens/`.
 * @param chainId The numeric chain id the slug maps to.
 * @param row The terminal row that tracks skipped files.
 */
const readNetworkTokenList = async (slug: string, chainId: number, row: TerminalRowProxy): Promise<types.TokenList> => {
  const folder = path.join(tokensRoot, slug)
  const entries = utils.removedUndesirable(await fs.promises.readdir(folder)).filter((name) => name.endsWith('.json'))
  const limit = limitBy<string>(`${providerKey}-${slug}`, 16)
  const parsed = await limit.map(entries, (name) => readTokenFile(path.join(folder, name), chainId, row))
  return {
    name: `Ethereum Lists: ${slug}`,
    timestamp: new Date().toISOString(),
    version: { major: 1, minor: 0, patch: 0 },
    tokens: _.compact(parsed),
  }
}

/** A folder slug present on disk, paired with the chain id it is already known to resolve to. */
type ResolvedSlug = {
  slug: string
  chainId: number
}

/**
 * The slugs actually present on disk that also appear in the authoritative map,
 * each paired with its already-resolved chain id and preserving the map's
 * declared order for stable ranking. Resolving here, once, means every entry
 * this returns is guaranteed included — the caller never has to re-check a
 * resolution status that disk presence has already settled.
 */
const includedSlugsOnDisk = async (): Promise<ResolvedSlug[]> => {
  const present = new Set(utils.removedUndesirable(await fs.promises.readdir(tokensRoot)))
  return Object.entries(NETWORK_MAPPING)
    .filter(([slug]) => present.has(slug))
    .map(([slug, chainId]) => ({ slug, chainId }))
}

/**
 * Two-phase collector for the ethereum-lists/tokens submodule.
 * Phase 1 (discover): reads every token file off disk, builds a per-network token
 *   list, and registers provider, per-network lists, and networks via inmemory-tokenlist.
 * Phase 2 (collect): upserts tokens and fetches their remote logos via inmemory-tokenlist.
 */
class EthereumListsCollector extends BaseCollector {
  readonly key = providerKey

  private networks: IncludedNetwork[] = []

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })
    // Insert the provider with its name first: inmemory-tokenlist inserts the same
    // provider by key alone, and the upsert leaves an existing name untouched, so
    // establishing the name here keeps it from ever being left null.
    await db.insertProvider({
      key: providerKey,
      name: providerName,
    })

    const slugs = await includedSlugsOnDisk()
    const networks: IncludedNetwork[] = []
    for (const { slug, chainId } of slugs) {
      const network = await this.discoverNetwork(slug, chainId, row, signal)
      if (network) {
        networks.push(network)
      }
    }
    this.networks = networks
    row.complete()

    return [
      {
        providerKey,
        lists: networks.map((network) => ({ listKey: network.listKey, listId: network.discovered.list.listId })),
      },
    ]
  }

  /**
   * Read one folder and register its network + list. A folder whose chain cannot be
   * created (some of these chains are unknown to the registry) is logged and skipped
   * so one bad network never aborts the run.
   */
  private async discoverNetwork(
    slug: string,
    chainId: number,
    row: TerminalRowProxy,
    signal: AbortSignal,
  ): Promise<IncludedNetwork | null> {
    const listKey = `tokens-${slug}`
    try {
      const tokenList = await readNetworkTokenList(slug, chainId, row)
      const discovered = await inmemoryTokenlist.discover({
        providerKey,
        listKey,
        tokenList,
        signal,
      })
      if (!discovered) {
        return null
      }
      return { slug, chainId, listKey, tokenList, discovered }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      failureLog('provider=%o folder=%o error=%o', providerKey, slug, errorMessage)
      row.increment(terminalLogTypes.EROR, `${providerKey}-${slug}`)
      return null
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })
    try {
      for (const network of this.networks) {
        if (signal.aborted) {
          return
        }
        await this.collectNetwork(network, row, signal)
      }
    } finally {
      row.complete()
    }
  }

  /**
   * Collect one folder's tokens and logos through inmemory-tokenlist, reusing the
   * state discover() already created. A failure here is logged and skipped so one
   * bad network never aborts the run.
   */
  private async collectNetwork(network: IncludedNetwork, row: TerminalRowProxy, signal: AbortSignal): Promise<void> {
    try {
      await inmemoryTokenlist.collect({
        providerKey,
        listKey: network.listKey,
        tokenList: network.tokenList,
        discovered: network.discovered,
        signal,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      failureLog('provider=%o folder=%o error=%o', providerKey, network.slug, errorMessage)
      row.increment(terminalLogTypes.EROR, `${providerKey}-${network.slug}`)
    }
  }
}

const instance = new EthereumListsCollector()
export default instance

/**
 * Standalone entry point that runs both phases, mirroring the other collectors'
 * convenience export.
 */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
