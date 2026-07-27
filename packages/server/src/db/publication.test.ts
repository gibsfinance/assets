import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))

import { noteListTokensWritten, listsWrittenInRun, publishCollectedLists, withListPublication } from './publication'

beforeEach(() => harness.reset())

/** The single UPDATE the publish step issues, if it issued one. */
const publishQuery = () => harness.queries.find((query) => query.root === 'update')

/** The WHERE predicate of that UPDATE, as the SQL text Postgres would receive. */
const publishPredicate = () => renderSql(publishQuery()?.steps.find((step) => step.method === 'where')?.args[0])

describe('noteListTokensWritten', () => {
  it('collects the list ids written inside a run', async () => {
    harness.queueResult([{ listId: 'list-a' }, { listId: 'list-b' }])

    await withListPublication(new AbortController().signal, async () => {
      noteListTokensWritten('list-a')
      noteListTokensWritten('list-b')
      expect(listsWrittenInRun().sort()).toEqual(['list-a', 'list-b'])
    })
  })

  it('deduplicates repeat writes to the same list', async () => {
    harness.queueResult([{ listId: 'list-a' }])

    await withListPublication(new AbortController().signal, async () => {
      noteListTokensWritten('list-a')
      noteListTokensWritten('list-a')
      noteListTokensWritten('list-a')
      expect(listsWrittenInRun()).toEqual(['list-a'])
    })
  })

  it('ignores a null or empty list id rather than enlisting a bogus row', async () => {
    await withListPublication(new AbortController().signal, async () => {
      noteListTokensWritten(null)
      noteListTokensWritten(undefined)
      noteListTokensWritten('')
      expect(listsWrittenInRun()).toEqual([])
    })

    expect(publishQuery()).toBeUndefined()
  })

  // Storing a token from a server request — a submission, a backfill script — must not
  // enlist anything: there is no collection run to finish, so nothing would ever publish
  // it, and a stray id would sit in a set that is never drained.
  it('does nothing outside a run', () => {
    noteListTokensWritten('list-a')
    expect(listsWrittenInRun()).toEqual([])
  })

  // Providers collect concurrently. A single shared ledger would let one provider's
  // failure withhold another's lists, and would let a provider that finished cleanly
  // publish half-written lists belonging to a provider still running.
  it('keeps concurrent runs from seeing each other', async () => {
    harness.queueResult([])
    harness.queueResult([])
    const signal = new AbortController().signal
    const seen: string[] = []
    const run = (id: string) =>
      withListPublication(signal, async () => {
        noteListTokensWritten(id)
        await new Promise((resolve) => setTimeout(resolve, 0))
        noteListTokensWritten(`${id}-second`)
        seen.push(listsWrittenInRun().sort().join(','))
      })

    await Promise.all([run('alpha'), run('beta')])

    expect(seen.sort()).toEqual(['alpha,alpha-second', 'beta,beta-second'])
  })
})

describe('publishCollectedLists', () => {
  it('issues no statement at all when nothing was written', async () => {
    expect(await publishCollectedLists([])).toBe(0)
    expect(harness.queries).toEqual([])
  })

  it('stamps every given list in one statement', async () => {
    harness.queueResult([{ listId: 'list-a' }, { listId: 'list-b' }])

    expect(await publishCollectedLists(['list-a', 'list-b'])).toBe(2)

    // One statement, not one per list — the whole point is a single cut over.
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(1)
    expect(sqlParams(publishQuery()?.steps.find((step) => step.method === 'where')?.args[0])).toEqual([
      'list-a',
      'list-b',
    ])
  })

  it('sets the publish marker to the database clock, not one read in this process', async () => {
    harness.queueResult([])

    await publishCollectedLists(['list-a'])

    const set = publishQuery()?.steps.find((step) => step.method === 'set')?.args[0] as { tokensCollectedAt: unknown }
    expect(renderSql(set.tokensCollectedAt)).toContain('CURRENT_TIMESTAMP')
  })

  // A list is noted when its insert resolves, but that insert may belong to a transaction
  // that later rolls back — the chunked write path in inmemory-tokenlist rolls one back
  // whenever a single entry is bad. Without this guard the ledger could publish a version
  // holding nothing, which would then supersede the complete older one: exactly the bug
  // the marker exists to close, reintroduced through the back door.
  it('refuses to publish a list that holds no tokens', async () => {
    harness.queueResult([])

    await publishCollectedLists(['list-a'])

    expect(publishPredicate()).toContain(
      'EXISTS (SELECT 1 FROM "list_token" WHERE "list_token"."list_id" = "list"."list_id")',
    )
  })

  it('reports how many lists it actually published, not how many it was offered', async () => {
    // Two offered, one holding tokens — the other rolled back.
    harness.queueResult([{ listId: 'list-a' }])

    expect(await publishCollectedLists(['list-a', 'list-b'])).toBe(1)
  })
})

describe('withListPublication', () => {
  it('publishes what the run wrote, once the run finishes', async () => {
    harness.queueResult([{ listId: 'list-a' }])

    await withListPublication(new AbortController().signal, async () => {
      noteListTokensWritten('list-a')
    })

    expect(sqlParams(publishQuery()?.steps.find((step) => step.method === 'where')?.args[0])).toEqual(['list-a'])
  })

  it('returns the run result untouched', async () => {
    const result = await withListPublication(new AbortController().signal, async () => 'done')
    expect(result).toBe('done')
  })

  // A collector that throws may have left any of its lists half-written, and there is no
  // way from here to tell which. Readers keep the version they already have; the next
  // successful run publishes.
  it('publishes nothing when the run throws, and rethrows', async () => {
    const failing = withListPublication(new AbortController().signal, async () => {
      noteListTokensWritten('list-a')
      throw new Error('collector boom')
    })

    await expect(failing).rejects.toThrow('collector boom')
    expect(publishQuery()).toBeUndefined()
  })

  // Collectors treat an abort as "stop where you are and return", which is
  // indistinguishable from finishing by the time control reaches here. Publishing a list
  // abandoned partway would reintroduce the half-written version the marker exists to hide.
  it('publishes nothing when the signal aborted, even though the run returned', async () => {
    const controller = new AbortController()

    await withListPublication(controller.signal, async () => {
      noteListTokensWritten('list-a')
      controller.abort()
    })

    expect(publishQuery()).toBeUndefined()
  })

  it('issues no statement when the run wrote no tokens', async () => {
    await withListPublication(new AbortController().signal, async () => undefined)
    expect(harness.queries).toEqual([])
  })
})
