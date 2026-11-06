import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))

import { getListVersionSnapshot, getProviderListKeys, pruneSupersededListVersions } from './list-versions'

beforeEach(() => {
  harness.reset()
})

const version = (patch: number, tokensCollectedAt: string | null) => ({
  listId: `list-${patch}`,
  networkId: 'solana-501',
  name: 'Jupiter: recently listed',
  major: 0,
  minor: 0,
  patch,
  tokensCollectedAt,
})

describe('getListVersionSnapshot', () => {
  it('reports nothing for a list that has no stored version', async () => {
    harness.queueResult([])

    expect(await getListVersionSnapshot({ providerId: 'p', listKey: 'recent' })).toEqual({
      highest: null,
      published: null,
    })
    expect(harness.queries).toHaveLength(1)
  })

  it('reports the highest version but no members while nothing has published', async () => {
    harness.queueResult([version(1, null), version(0, null)])

    const snapshot = await getListVersionSnapshot({ providerId: 'p', listKey: 'recent' })

    expect(snapshot.highest?.listId).toBe('list-1')
    expect(snapshot.published).toBeNull()
    expect(harness.queries).toHaveLength(1)
  })

  it('reads members from the newest published version, not from a higher unpublished one', async () => {
    harness.queueResult([version(2, null), version(1, '2026-11-06T00:00:00Z'), version(0, '2026-11-05T00:00:00Z')])
    harness.queueResult([{ providedId: 'MintA' }, { providedId: 'MintB' }])

    const snapshot = await getListVersionSnapshot({ providerId: 'p', listKey: 'recent' })

    expect(snapshot.highest?.listId).toBe('list-2')
    expect(snapshot.published?.listId).toBe('list-1')
    expect(snapshot.published?.providedIds).toEqual(['MintA', 'MintB'])
    const memberQuery = harness.queries[1]
    const where = memberQuery.steps.find((step) => step.method === 'where')
    expect(sqlParams(where?.args[0])).toEqual(['list-1'])
  })

  it('does not leak the publish marker into the returned versions', async () => {
    harness.queueResult([version(0, '2026-11-05T00:00:00Z')])
    harness.queueResult([])

    const snapshot = await getListVersionSnapshot({ providerId: 'p', listKey: 'recent' })

    expect(snapshot.highest).not.toHaveProperty('tokensCollectedAt')
    expect(snapshot.published).not.toHaveProperty('tokensCollectedAt')
    expect(snapshot.published?.providedIds).toEqual([])
  })
})

describe('getProviderListKeys', () => {
  it('returns each distinct key once', async () => {
    harness.queueResult([{ listKey: 'recent' }, { listKey: 'tag-lst' }])

    expect(await getProviderListKeys('p')).toEqual(['recent', 'tag-lst'])
    expect(harness.queries[0].root).toBe('selectDistinct')
  })
})

describe('pruneSupersededListVersions', () => {
  it('reports how many rows the delete returned', async () => {
    harness.queueResult({ rows: [{ deleted: 1 }, { deleted: 1 }] })

    expect(await pruneSupersededListVersions({ providerId: 'p', listKey: 'recent', keep: 3 })).toBe(2)
  })

  it('cuts off below the newest `keep` published versions', async () => {
    harness.queueResult({ rows: [] })

    await pruneSupersededListVersions({ providerId: 'p', listKey: 'recent', keep: 3 })

    const statement = harness.queries[0].steps[0].args[0]
    expect(renderSql(statement)).toMatch(/tokens_collected_at IS NOT NULL/)
    expect(renderSql(statement)).toMatch(/OFFSET \$\d+ LIMIT 1/)
    // keep - 1 rows are skipped, so the row at the offset is the oldest one kept.
    expect(sqlParams(statement)).toContain(2)
  })

  it('deletes a row only when it never served an icon or another imaged row covers its token', async () => {
    harness.queueResult({ rows: [] })

    await pruneSupersededListVersions({ providerId: 'p', listKey: 'recent', keep: 3 })

    const text = renderSql(harness.queries[0].steps[0].args[0]).replace(/\s+/g, ' ')
    expect(text).toMatch(/doomed\.image_hash IS NULL OR EXISTS/)
    expect(text).toMatch(/other\.image_hash IS NOT NULL/)
    // The covering row must itself survive: not one of the versions being trimmed.
    expect(text).toMatch(/AND NOT \( other_list\.provider_id = \$\d+ AND other_list\.key = \$\d+/)
  })
})
