import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mock the Drizzle module with a chainable query builder.
 */
const chain: Record<string, any> = {}
chain.select = vi.fn().mockReturnValue(chain)
chain.from = vi.fn().mockReturnValue(chain)
chain.where = vi.fn().mockReturnValue(chain)
chain.orderBy = vi.fn().mockReturnValue(chain)
chain.update = vi.fn().mockReturnValue(chain)
chain.set = vi.fn().mockReturnValue(chain)
chain.limit = vi.fn().mockResolvedValue([])

vi.mock('../db/drizzle', () => ({
  getDrizzle: vi.fn(() => chain),
}))

// Mock schema
vi.mock('../db/schema', () => {
  const makeTable = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, prop) => `${name}.${String(prop)}`,
      },
    )
  return {
    listSubmission: makeTable('list_submission'),
  }
})

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => args),
    {
      raw: vi.fn((s: string) => s),
    },
  ),
}))

/**
 * Mock RemoteTokenListCollector
 */
vi.mock('./remote-tokenlist', () => ({
  RemoteTokenListCollector: vi.fn().mockImplementation(function (this: { key: string }, key: string) {
    this.key = key
  }),
}))

/**
 * Mock failureLog
 */
vi.mock('@gibs/utils', () => ({
  failureLog: vi.fn(),
}))

import { loadSubmissionCollectors, updateSubmissionStatus, bumpSubscriberCount } from './user-submissions'
import { RemoteTokenListCollector } from './remote-tokenlist'
import { failureLog } from '@gibs/utils'

describe('loadSubmissionCollectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.select.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
  })

  it('returns empty object when no approved submissions exist', async () => {
    // The final chain value resolves as an array when awaited
    chain.where.mockResolvedValueOnce([])

    const result = await loadSubmissionCollectors()

    expect(result).toEqual({})
  })

  it('creates RemoteTokenListCollector for each approved submission', async () => {
    const submissions = [
      {
        id: 'sub-1',
        url: 'https://example.com/list1.json',
        providerKey: 'user-alice',
        listKey: 'alice-list',
        imageMode: 'auto',
        lastContentHash: null,
        failCount: 0,
        status: 'approved',
      },
      {
        id: 'sub-2',
        url: 'https://example.com/list2.json',
        providerKey: 'user-bob',
        listKey: 'bob-list',
        imageMode: 'save',
        lastContentHash: 'abc123',
        failCount: 2,
        status: 'approved',
      },
    ]
    chain.where.mockResolvedValueOnce(submissions)

    const result = await loadSubmissionCollectors()

    expect(Object.keys(result)).toHaveLength(2)
    expect(result['user-alice']).toBeDefined()
    expect(result['user-bob']).toBeDefined()
    expect(RemoteTokenListCollector).toHaveBeenCalledTimes(2)
    expect(RemoteTokenListCollector).toHaveBeenCalledWith('user-alice', {
      providerKey: 'user-alice',
      listKey: 'alice-list',
      tokenList: 'https://example.com/list1.json',
    })
    expect(RemoteTokenListCollector).toHaveBeenCalledWith('user-bob', {
      providerKey: 'user-bob',
      listKey: 'bob-list',
      tokenList: 'https://example.com/list2.json',
    })
  })
})

describe('updateSubmissionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.select.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    chain.update.mockReturnValue(chain)
    chain.set.mockReturnValue(chain)
    chain.limit.mockResolvedValue([])
  })

  it('does nothing when no matching submission exists', async () => {
    chain.limit.mockResolvedValueOnce([])

    await updateSubmissionStatus('user-nonexistent', { success: true })

    expect(chain.update).not.toHaveBeenCalled()
  })

  it('resets failCount and sets lastFetchedAt on success', async () => {
    const sub = {
      id: 'sub-1',
      providerKey: 'user-alice',
      status: 'approved',
      failCount: 3,
    }
    chain.limit.mockResolvedValueOnce([sub])

    await updateSubmissionStatus('user-alice', { success: true })

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        failCount: 0,
        lastFetchedAt: expect.any(String),
      }),
    )
  })

  it('increments failCount on failure', async () => {
    const sub = {
      id: 'sub-1',
      providerKey: 'user-alice',
      status: 'approved',
      failCount: 2,
    }
    chain.limit.mockResolvedValueOnce([sub])

    await updateSubmissionStatus('user-alice', { success: false })

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        failCount: 3,
        lastFetchedAt: expect.any(String),
      }),
    )
  })

  it('marks submission as stale after 5 consecutive failures', async () => {
    const sub = {
      id: 'sub-1',
      providerKey: 'user-alice',
      status: 'approved',
      failCount: 4,
    }
    chain.limit.mockResolvedValueOnce([sub])

    await updateSubmissionStatus('user-alice', { success: false })

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        failCount: 5,
        status: 'stale',
      }),
    )
    expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('stale'), 'user-alice', 5)
  })
})

describe('bumpSubscriberCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.update.mockReturnValue(chain)
    chain.set.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
  })

  it('updates subscriber count and lastAccessedAt', async () => {
    await bumpSubscriberCount('user-alice')

    expect(chain.update).toHaveBeenCalled()
    expect(chain.set).toHaveBeenCalled()
    expect(chain.where).toHaveBeenCalled()
  })
})
