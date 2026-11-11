/**
 * @module collect/versioned-lists
 *
 * Database-backed steps shared by collectors whose lists change membership between runs
 * (Jupiter, CoinGecko top tokens): choose the version a list's members are filed under,
 * retire lists a feed no longer produces, and publish a list once it has been walked.
 * The pure rules live in ./list-membership.
 */
import { failureLog } from '@gibs/utils'

import * as db from '../db'
import { nextListVersion, sameMembership, type ListVersionNumbers } from './list-membership'

/**
 * How many published versions of each list keep their full set of members. Older versions
 * are trimmed to the tokens that would otherwise lose their only icon (see
 * `pruneSupersededListVersions`). Three covers the current version, the one before it, and
 * one spare in case the newest is later found wrong.
 */
export const RETAINED_LIST_VERSIONS = 3

/**
 * Choose the version a list's members should be filed under.
 *
 * A list's members are the tokens its feed returned in this run, and nothing else. Rows are
 * only ever added to a version, so a token that left the feed can leave the list only if
 * the list moves to a new version that does not contain it. Readers take the newest
 * published version, so the new version shows the current members while the old version's
 * rows stay behind for the by-address image route, which ranks superseded versions below
 * current ones but still uses them.
 *
 * - Same members as the published version: reuse it. An unchanged feed adds no version.
 * - Different members: the next number above the highest stored version, published or not,
 *   so a run that stopped before publishing never has its partial rows reused.
 * - No version stored yet: the database default (0.0.0).
 */
export const resolveListVersion = async ({
  providerId,
  listKey,
  addresses,
}: {
  providerId: string
  listKey: string
  addresses: string[]
}): Promise<Partial<ListVersionNumbers>> => {
  const { highest, published } = await db.getListVersionSnapshot({ providerId, listKey })
  if (published && sameMembership(published.providedIds, addresses)) {
    return { major: published.major, minor: published.minor, patch: published.patch }
  }
  if (!highest) return {}
  return nextListVersion(highest)
}

/**
 * Stop listing members for every Jupiter list this run did not produce.
 *
 * A list is stale when it is stored but absent from `liveKeys`: a tag that fell below
 * MIN_LIST_SIZE or that Jupiter retired (`yield`), or a list the collector no longer
 * defines. Lists in `unreliableKeys` are skipped because their feed failed or came back
 * empty, which says nothing about their members.
 *
 * Retiring publishes a new, empty version, which the list readers serve in place of the
 * older versions (see `getLists`). That is the same mechanism a membership change uses, so
 * the old rows stay available to the image route. A list already empty is left alone, so
 * a retired list costs one version, once.
 */
export const retireStaleLists = async ({
  providerId,
  providerKey: ownerKey,
  liveKeys,
  unreliableKeys,
}: {
  providerId: string
  providerKey: string
  liveKeys: Set<string>
  unreliableKeys: Set<string>
}): Promise<void> => {
  const storedKeys = await db.getProviderListKeys(providerId)
  for (const listKey of storedKeys) {
    if (liveKeys.has(listKey) || unreliableKeys.has(listKey)) continue
    const { highest, published } = await db.getListVersionSnapshot({ providerId, listKey })
    if (!highest || !published || published.providedIds.length === 0) continue
    const [emptied] = await db.insertList({
      providerId,
      providerKey: ownerKey,
      networkId: published.networkId,
      key: listKey,
      name: published.name,
      ...nextListVersion(highest),
    })
    await db.markListTokensCollected(emptied.listId)
    failureLog('provider=%o list=%o retired: no longer produced by the feed', ownerKey, listKey)
  }
}

/**
 * Publish a list version once its whole feed has been walked, then trim old versions.
 *
 * Publishing is what switches readers to the new version, so it waits for the walk to end
 * and is skipped after an abort (the version is half written). A version with no stored
 * token is not published either: it would hide a complete older version behind an empty
 * one. Individual token failures do not withhold it; the next run sees the shortfall as a
 * membership change and files the list again.
 *
 * A failed trim is logged and ignored. It only leaves old rows in place, which is the
 * state before this code existed.
 */
export const publishWalkedList = async ({
  providerKey,
  list,
  stored,
  signal,
}: {
  /** The collector's provider key, named in the log line when a trim fails. */
  providerKey: string
  list: { providerId: string; listKey: string; listId: string }
  stored: number
  signal: AbortSignal
}): Promise<void> => {
  if (signal.aborted || stored === 0) return
  await db.markListTokensCollected(list.listId)
  try {
    await db.pruneSupersededListVersions({
      providerId: list.providerId,
      listKey: list.listKey,
      keep: RETAINED_LIST_VERSIONS,
    })
  } catch (err) {
    failureLog('provider=%o list=%o prune failed: %o', providerKey, list.listKey, (err as Error).message)
  }
}
