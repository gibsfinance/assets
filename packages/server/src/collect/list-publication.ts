/**
 * @module collect/list-publication
 *
 * The two database steps every collector that versions its lists by membership takes: choose the
 * version a list's members belong under, and publish the version once its members are stored.
 * Jupiter and Etherscan share them. The pure rules are in `./list-membership`.
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
 * A list's members are the tokens its source returned in this run, and nothing else. Rows are
 * only ever added to a version, so a token that left the source can leave the list only if
 * the list moves to a new version that does not contain it. Readers take the newest
 * published version, so the new version shows the current members while the old version's
 * rows stay behind for the by-address image route, which ranks superseded versions below
 * current ones but still uses them.
 *
 * - Same members as the published version: reuse it. An unchanged source adds no version.
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
 * Publish a list version once its whole source has been walked, then trim old versions.
 *
 * Publishing is what switches readers to the new version, so it waits for the walk to end
 * and is skipped after an abort (the version is half written). A version with no stored
 * token is not published either: it would hide a complete older version behind an empty
 * one. Individual token failures do not withhold it; the next run sees the shortfall as a
 * membership change and files the list again.
 *
 * A failed trim is logged and ignored. It only leaves old rows in place.
 */
export const publishWalkedList = async ({
  providerKey,
  providerId,
  listKey,
  listId,
  stored,
  signal,
}: {
  providerKey: string
  providerId: string
  listKey: string
  listId: string
  stored: number
  signal: AbortSignal
}): Promise<void> => {
  if (signal.aborted || stored === 0) return
  await db.markListTokensCollected(listId)
  try {
    await db.pruneSupersededListVersions({ providerId, listKey, keep: RETAINED_LIST_VERSIONS })
  } catch (err) {
    failureLog('provider=%o list=%o prune failed: %o', providerKey, listKey, (err as Error).message)
  }
}
