import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

/**
 * Mock the db module with a chainable knex-style query builder.
 * Each method returns the chain for fluent API support.
 */
const chain: Record<string, Mock> = {}
chain.select = vi.fn().mockReturnValue(chain)
chain.from = vi.fn().mockReturnValue(chain)
chain.where = vi.fn().mockReturnValue(chain)
chain.orderBy = vi.fn().mockReturnValue(chain)
chain.update = vi.fn().mockReturnValue(chain)
chain.increment = vi.fn().mockReturnValue(chain)
chain.first = vi.fn().mockResolvedValue(undefined)
chain.insert = vi.fn().mockReturnValue(chain)
chain.into = vi.fn().mockReturnValue(chain)

vi.mock('../db', () => ({
  getDB: vi.fn(() => chain),
}))

/**
 * Mock RemoteTokenListCollector — we only care that it gets instantiated
 * with the right arguments, not that it actually collects anything.
 */
vi.mock('./remote-tokenlist', () => ({
  RemoteTokenListCollector: vi.fn().mockImplementation(function (this: { key: string }, key: string) {
    this.key = key
  }),
}))

/**
 * Mock failureLog to suppress console output and allow assertion.
 */
vi.mock('@gibs/utils', () => ({
  failureLog: vi.fn(),
}))

import {
  loadSubmissionCollectors,
  updateSubmissionStatus,
  bumpSubscriberCount,
} from './user-submissions'
import { RemoteTokenListCollector } from './remote-tokenlist'
import { failureLog } from '@gibs/utils'

describe('loadSubmissionCollectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the chain resolution — by default return empty array
    // The chain ends when it's awaited after .where()
    chain.where.mockReturnValue(chain)
    // Make the chain itself thenable (resolves when awaited)
    chain[Symbol.toStringTag] = 'Promise'
  })

  it('returns empty object when no approved submissions exist', async () => {
    // The final chain value (after .where) resolves as an array
    chain.where.mockResolvedValueOnce([])

    const result = await loadSubmissionCollectors()

    expect(result).toEqual({})
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.from).toHaveBeenCalledWith('list_submission')
  })

  it('creates RemoteTokenListCollector for each approved submission', async () => {
    const submissions = [
      {
        id: 'sub-1',
        url: 'https://example.com/list1.json',
        provider_key: 'user-alice',
        list_key: 'alice-list',
        image_mode: 'auto',
        last_content_hash: null,
        fail_count: 0,
      },
      {
        id: 'sub-2',
        url: 'https://example.com/list2.json',
        provider_key: 'user-bob',
        list_key: 'bob-list',
        image_mode: 'save',
        last_content_hash: 'abc123',
        fail_count: 2,
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

  it('uses provider_key as the map key', async () => {
    const submissions = [
      {
        id: 'sub-1',
        url: 'https://example.com/list.json',
        provider_key: 'user-custom-key',
        list_key: 'my-list',
        image_mode: 'link',
        last_content_hash: null,
        fail_count: 0,
      },
    ]
    chain.where.mockResolvedValueOnce(submissions)

    const result = await loadSubmissionCollectors()

    expect('user-custom-key' in result).toBe(true)
  })
})

describe('updateSubmissionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.where.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.update.mockReturnValue(chain)
  })

  it('does nothing when no matching submission exists', async () => {
    chain.first.mockResolvedValueOnce(undefined)

    await updateSubmissionStatus('user-nonexistent', { success: true })

    // update should never be called if no submission found
    expect(chain.update).not.toHaveBeenCalled()
  })

  it('resets fail_count and sets last_fetched_at on success', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 3,
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: true })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fail_count: 0,
        last_fetched_at: expect.any(Date),
      }),
    )
    expect(chain.where).toHaveBeenCalledWith('id', 'sub-1')
  })

  it('updates content hash on success when provided', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 0,
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', {
      success: true,
      contentHash: 'newhash123',
    })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fail_count: 0,
        last_content_hash: 'newhash123',
      }),
    )
  })

  it('does not include content hash in update when not provided on success', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: 'oldhash',
      fail_count: 0,
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: true })

    const updateArg = (chain.update as Mock).mock.calls[0][0]
    expect(updateArg).not.toHaveProperty('last_content_hash')
  })

  it('increments fail_count on failure', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 2,
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: false })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fail_count: 3,
        last_fetched_at: expect.any(Date),
      }),
    )
  })

  it('marks submission as stale after 5 consecutive failures', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 4, // Will become 5
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: false })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        fail_count: 5,
        status: 'stale',
      }),
    )
    expect(failureLog).toHaveBeenCalledWith(
      expect.stringContaining('stale'),
      'user-alice',
      5,
    )
  })

  it('does not mark stale at exactly 4 failures', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 3, // Will become 4
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: false })

    const updateArg = (chain.update as Mock).mock.calls[0][0]
    expect(updateArg.fail_count).toBe(4)
    expect(updateArg).not.toHaveProperty('status')
  })

  it('marks stale when fail_count exceeds 5', async () => {
    const sub = {
      id: 'sub-1',
      url: 'https://example.com/list.json',
      provider_key: 'user-alice',
      list_key: 'my-list',
      image_mode: 'auto',
      last_content_hash: null,
      fail_count: 9, // Will become 10
    }
    chain.first.mockResolvedValueOnce(sub)

    await updateSubmissionStatus('user-alice', { success: false })

    const updateArg = (chain.update as Mock).mock.calls[0][0]
    expect(updateArg.fail_count).toBe(10)
    expect(updateArg.status).toBe('stale')
  })

  it('queries by provider_key and approved status', async () => {
    chain.first.mockResolvedValueOnce(undefined)

    await updateSubmissionStatus('user-test', { success: true })

    expect(chain.where).toHaveBeenCalledWith('provider_key', 'user-test')
    expect(chain.where).toHaveBeenCalledWith('status', 'approved')
  })
})

describe('bumpSubscriberCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.increment.mockReturnValue(chain)
    chain.update.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
  })

  it('increments subscriber_count by 1 and updates last_accessed_at', async () => {
    await bumpSubscriberCount('user-alice')

    expect(chain.increment).toHaveBeenCalledWith('subscriber_count', 1)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_accessed_at: expect.any(Date),
      }),
    )
    expect(chain.from).toHaveBeenCalledWith('list_submission')
    expect(chain.where).toHaveBeenCalledWith('provider_key', 'user-alice')
  })

  it('uses the correct provider_key in the where clause', async () => {
    await bumpSubscriberCount('user-bob-custom')

    expect(chain.where).toHaveBeenCalledWith('provider_key', 'user-bob-custom')
  })
})
