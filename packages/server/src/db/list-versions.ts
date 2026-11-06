/**
 * @module db/list-versions
 *
 * Queries for collectors whose lists change membership between runs. A collector reads the
 * state of a list's versions, publishes a new version when the members changed, and trims
 * old versions afterwards. See `latestListVersionSql` in ./index for how readers pick a
 * version and why superseded versions stay in the database.
 */
import { and, desc, eq, sql as dsql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import * as s from './schema'

/** One stored version of a list. */
export type StoredListVersion = {
  listId: string
  networkId: string | null
  name: string | null
  major: number
  minor: number
  patch: number
}

/** What a collector needs to know about a list's versions before writing a new one. */
export type ListVersionSnapshot = {
  /** The highest version stored, published or not. New versions must number above it. */
  highest: StoredListVersion | null
  /** The newest version readers see (`tokens_collected_at` set), with the ids of its members. */
  published: (StoredListVersion & { providedIds: string[] }) | null
}

/**
 * Read the versions of one list.
 *
 * `highest` ignores publication on purpose: a run that stopped before it published leaves
 * an unpublished row, and the next version has to number above it or it would reuse the
 * row (and the partial members it holds). `published` is what readers currently see.
 */
export const getListVersionSnapshot = async ({
  providerId,
  listKey,
}: {
  providerId: string
  listKey: string
}): Promise<ListVersionSnapshot> => {
  const db = getDrizzle()
  const versions = await db
    .select({
      listId: s.list.listId,
      networkId: s.list.networkId,
      name: s.list.name,
      major: s.list.major,
      minor: s.list.minor,
      patch: s.list.patch,
      tokensCollectedAt: s.list.tokensCollectedAt,
    })
    .from(s.list)
    .where(and(eq(s.list.providerId, providerId), eq(s.list.key, listKey)))
    .orderBy(desc(s.list.major), desc(s.list.minor), desc(s.list.patch))
  const [highest] = versions
  if (!highest) return { highest: null, published: null }
  const { tokensCollectedAt: _highestMarker, ...highestVersion } = highest
  const newestPublished = versions.find((version) => version.tokensCollectedAt !== null)
  if (!newestPublished) return { highest: highestVersion, published: null }
  const { tokensCollectedAt: _publishedMarker, ...publishedVersion } = newestPublished
  const members = await db
    .select({ providedId: s.token.providedId })
    .from(s.listToken)
    .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .where(eq(s.listToken.listId, publishedVersion.listId))
  return {
    highest: highestVersion,
    published: { ...publishedVersion, providedIds: members.map((member) => member.providedId) },
  }
}

/** Every list key a provider has stored a version under. */
export const getProviderListKeys = async (providerId: string): Promise<string[]> => {
  const db = getDrizzle()
  const rows = await db.selectDistinct({ listKey: s.list.key }).from(s.list).where(eq(s.list.providerId, providerId))
  return rows.map((row) => row.listKey)
}

/**
 * Trim the `list_token` rows of versions older than the newest `keep` published ones,
 * without costing any token its icon.
 *
 * A superseded version is only kept so that `applyOrder` can still find an image for a
 * token its newer versions dropped. So a row is deleted only when that is safe:
 *   - the row carries no image, so it never served an icon; or
 *   - the same token has an imaged row somewhere that is not itself being trimmed.
 * A token that appears only in old versions keeps its rows, so growth is bounded by the
 * number of distinct tokens ever listed rather than by the number of runs. The `list`
 * rows themselves stay: they are tiny, and `latestListVersionSql` only compares them.
 *
 * Does nothing until a list has at least `keep` published versions. Returns the number of
 * `list_token` rows deleted.
 */
export const pruneSupersededListVersions = async ({
  providerId,
  listKey,
  keep,
}: {
  providerId: string
  listKey: string
  keep: number
}): Promise<number> => {
  const db = getDrizzle()
  const deleted = await db.execute<{ deleted: number }>(dsql`
    WITH cutoff AS (
      SELECT major, minor, patch FROM ${s.list}
      WHERE provider_id = ${providerId} AND key = ${listKey} AND tokens_collected_at IS NOT NULL
      ORDER BY major DESC, minor DESC, patch DESC
      OFFSET ${keep - 1} LIMIT 1
    )
    DELETE FROM ${s.listToken} doomed
    USING ${s.list} old_list, cutoff
    WHERE doomed.list_id = old_list.list_id
      AND old_list.provider_id = ${providerId}
      AND old_list.key = ${listKey}
      AND (old_list.major, old_list.minor, old_list.patch) < (cutoff.major, cutoff.minor, cutoff.patch)
      AND (
        doomed.image_hash IS NULL
        OR EXISTS (
          SELECT 1 FROM ${s.listToken} other
          INNER JOIN ${s.list} other_list ON other_list.list_id = other.list_id
          WHERE other.token_id = doomed.token_id
            AND other.image_hash IS NOT NULL
            AND NOT (
              other_list.provider_id = ${providerId}
              AND other_list.key = ${listKey}
              AND (other_list.major, other_list.minor, other_list.patch) < (cutoff.major, cutoff.minor, cutoff.patch)
            )
        )
      )
    RETURNING 1 AS deleted
  `)
  return deleted.rows.length
}
