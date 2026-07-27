/**
 * @module db/publication
 *
 * Makes a list version's switchover atomic for every collector, not just the one that
 * remembered to ask for it.
 *
 * `list_id` hashes (provider_id, key, major, minor, patch), so bumping a version inserts
 * a brand-new empty row instead of updating the old one, and collection then fills that
 * row in over minutes to hours. `list.tokens_collected_at` is what tells readers the row
 * is finished — see latestListVersionSql in ./index for why an unfinished row must not be
 * allowed to supersede the complete one behind it.
 *
 * inmemory-tokenlist sets that marker itself, at the end of each list it walks. The dozen
 * other collectors that write `list` rows directly never did, which was survivable only
 * because they all pass a constant version: no second row ever existed for their
 * (provider, key) pairs, so there was nothing for a reader to be confused by. It was a
 * loaded gun pointed at whoever first gave one of them a real version — their lists would
 * have frozen on whatever was already published, silently and permanently.
 *
 * Rather than ask thirteen collectors to remember a call — and collector fourteen to
 * remember it too — publication is derived from what actually happened. Every
 * `list_token` write notes its list against the ambient run, and when a collector's
 * `collect()` returns without aborting, one statement publishes everything that run
 * wrote. A collector that throws publishes nothing further: its lists may be half-written
 * and there is no way from here to tell which, so readers keep the version they have.
 *
 * The scope is per collector run rather than global because providers collect
 * concurrently, and one provider's failure must not withhold another's lists.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { and, inArray, sql as dsql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import * as s from './schema'

/** List ids that received `list_token` writes during the current collector run. */
type WrittenLists = Set<string>

const storage = new AsyncLocalStorage<WrittenLists>()

/**
 * Record that a list received token rows. Called from the one place every `list_token`
 * insert funnels through, so no collector has to opt in.
 *
 * Outside a tracked run — a server request storing a submission, a test — there is no
 * ambient set and this does nothing.
 */
export const noteListTokensWritten = (listId: string | null | undefined) => {
  if (!listId) return
  storage.getStore()?.add(listId)
}

/** List ids written so far in the current run. Empty outside one. Exposed for tests. */
export const listsWrittenInRun = (): string[] => [...(storage.getStore() ?? [])]

/**
 * Publish the given list versions: stamp them as having finished collecting.
 *
 * The `EXISTS` guard is what makes this safe to drive from an in-memory ledger. A note is
 * taken when the insert resolves, but that insert may belong to a transaction that later
 * rolls back — the chunked write path in inmemory-tokenlist rolls one back whenever a
 * single entry is bad. A list whose rows all vanished that way has nothing to publish, and
 * this refuses to publish it, so the ledger can never manufacture an empty version that
 * supersedes a full one.
 *
 * A list that kept *some* rows is published, deliberately and consistently with
 * markListTokensCollected: individual token failures are logged and skipped, and
 * withholding on one bad token would strand a list on a stale version indefinitely.
 */
export const publishCollectedLists = async (listIds: string[]): Promise<number> => {
  if (listIds.length === 0) return 0
  const db = getDrizzle()
  const published = await db
    .update(s.list)
    .set({ tokensCollectedAt: dsql`CURRENT_TIMESTAMP` })
    .where(
      and(
        inArray(s.list.listId, listIds),
        dsql`EXISTS (SELECT 1 FROM ${s.listToken} WHERE ${s.listToken.listId} = ${s.list.listId})`,
      ),
    )
    .returning({ listId: s.list.listId })
  return published.length
}

/**
 * Run a collector's collect phase with publication tracking, then publish what it wrote.
 *
 * Skipped on abort even though `run` returned normally: collectors treat an abort as
 * "stop where you are and return", which is indistinguishable at this level from finishing,
 * and publishing a list abandoned partway is precisely the half-written version the marker
 * exists to hide.
 *
 * Skipped on throw as well — the rejection propagates untouched, so the orchestrator's
 * existing error handling is unchanged.
 *
 * A failure of the publish statement itself is deliberately left to propagate, and so gets
 * reported as a failed collection. That is the honest reading: the run gathered the data
 * but none of it became visible, and calling that a success would be a lie. Nothing is
 * lost either way — the lists stay on their previous version and the next run republishes.
 */
export const withListPublication = async <T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> => {
  const written: WrittenLists = new Set()
  const result = await storage.run(written, run)
  if (signal.aborted) return result
  await publishCollectedLists([...written])
  return result
}
