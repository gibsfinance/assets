import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeTerminalRowProxy } from './__testing__/collector-harness'

vi.mock('../utils', () => ({
  controller: new AbortController(),
  terminalRow: createFakeTerminalRowProxy(),
}))

vi.mock('../collect/collectables', () => ({
  collectables: vi.fn(),
}))

vi.mock('./user-submissions', () => ({
  loadSubmissionCollectors: vi.fn(async () => ({})),
  updateSubmissionStatus: vi.fn(async () => undefined),
}))

vi.mock('../db/sync-order', () => ({
  syncDefaultOrder: vi.fn(async () => undefined),
  startPeriodicRefresh: vi.fn(() => vi.fn()),
}))

vi.mock('../db/drizzle', () => ({
  getDrizzle: vi.fn(() => ({ execute: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock('@gibs/utils', () => ({
  failureLog: vi.fn(),
}))

vi.mock('../log/App', () => ({
  forceRerender: vi.fn(),
}))

import * as utils from '../utils'
import { collectables } from '../collect/collectables'
import { loadSubmissionCollectors, updateSubmissionStatus } from './user-submissions'
import { syncDefaultOrder, startPeriodicRefresh } from '../db/sync-order'
import { getDrizzle } from '../db/drizzle'
import { failureLog } from '@gibs/utils'
import { main } from './index'

/** Builds a minimal `BaseCollector`-shaped fake, discover/collect independently overridable. */
const createFakeCollector = (overrides: { discover?: () => Promise<unknown>; collect?: () => Promise<void> } = {}) => ({
  key: 'fake',
  discover: vi.fn(overrides.discover ?? (async () => [{ providerKey: 'fake', lists: [{ listKey: 'default' }] }])),
  collect: vi.fn(overrides.collect ?? (async () => undefined)),
})

const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
  vi.clearAllMocks()
  consoleLogSpy.mockImplementation(() => undefined)
  consoleErrorSpy.mockImplementation(() => undefined)
  // `AbortController.abort()` is irreversible, and one test per describe block
  // deliberately aborts the shared controller — swap in a fresh one so that
  // does not bleed into every later test.
  ;(utils as unknown as { controller: AbortController }).controller = new AbortController()
  vi.mocked(loadSubmissionCollectors).mockResolvedValue({})
  vi.mocked(updateSubmissionStatus).mockResolvedValue(undefined)
  vi.mocked(syncDefaultOrder).mockResolvedValue(undefined)
  vi.mocked(startPeriodicRefresh).mockReturnValue(vi.fn())
  vi.mocked(getDrizzle).mockReturnValue({ execute: vi.fn(async () => ({ rows: [] })) } as never)
})

describe('main — raw logger (sequential)', () => {
  it('discovers then collects every provider, syncing order between and after', async () => {
    const providerA = createFakeCollector()
    const providerB = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: providerA, b: providerB } as never)

    await main(['a', 'b'] as never, 'raw')

    expect(providerA.discover).toHaveBeenCalledTimes(1)
    expect(providerB.discover).toHaveBeenCalledTimes(1)
    expect(providerA.collect).toHaveBeenCalledTimes(1)
    expect(providerB.collect).toHaveBeenCalledTimes(1)
    expect(syncDefaultOrder).toHaveBeenCalledTimes(2)
    expect(startPeriodicRefresh).toHaveBeenCalledTimes(1)
    expect(vi.mocked(startPeriodicRefresh).mock.results[0]?.value).toHaveBeenCalledTimes(1)
  })

  it('skips a provider with no registered collector, for both phases', async () => {
    vi.mocked(collectables).mockReturnValue({} as never)

    await main(['missing'] as never, 'raw')

    expect(syncDefaultOrder).toHaveBeenCalled()
  })

  it('stops discovering and collecting once the shared signal is aborted', async () => {
    utils.controller.abort()
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never, 'raw')

    expect(provider.discover).not.toHaveBeenCalled()
    expect(provider.collect).not.toHaveBeenCalled()
  })

  it('logs and continues past a discover() failure, still reaching collect()', async () => {
    const provider = createFakeCollector({
      discover: async () => {
        throw new Error('discover boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never, 'raw')

    expect(provider.collect).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('logs and continues past a collect() failure', async () => {
    const provider = createFakeCollector({
      collect: async () => {
        throw new Error('collect boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never, 'raw')

    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(failureLog).toHaveBeenCalled()
  })

  it('marks a user-submitted list successful after it collects cleanly', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ 'user-alice': provider } as never)

    await main(['user-alice'] as never, 'raw')

    expect(updateSubmissionStatus).toHaveBeenCalledWith('user-alice', { success: true })
  })

  it('marks a user-submitted list failed when it throws', async () => {
    const provider = createFakeCollector({
      collect: async () => {
        throw new Error('boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ 'user-bob': provider } as never)

    await main(['user-bob'] as never, 'raw')

    expect(updateSubmissionStatus).toHaveBeenCalledWith('user-bob', { success: false })
  })

  it('logs pg_stat_activity rows still open after a provider finishes', async () => {
    vi.mocked(getDrizzle).mockReturnValue({
      execute: vi.fn(async () => ({
        rows: [{ pid: 1, state: 'active', query: 'select 1', xact_duration: '00:00:01' }],
      })),
    } as never)
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never, 'raw')

    expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('outstanding after'), 'a', expect.anything())
  })

  it('order-syncs the array as extended by newly loaded submission collectors', async () => {
    const provider = createFakeCollector()
    const submitted = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(loadSubmissionCollectors).mockResolvedValue({ 'user-carol': submitted } as never)

    const providers = ['a'] as never as string[]
    await main(providers as never, 'raw')

    expect(providers).toContain('user-carol')
    expect(submitted.discover).toHaveBeenCalledTimes(1)
    expect(submitted.collect).toHaveBeenCalledTimes(1)
  })

  it('does not re-register a submission collector whose key already exists', async () => {
    const provider = createFakeCollector()
    const submitted = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(loadSubmissionCollectors).mockResolvedValue({ a: submitted } as never)

    const providers = ['a'] as never as string[]
    await main(providers as never, 'raw')

    expect(providers).toEqual(['a'])
    expect(submitted.discover).not.toHaveBeenCalled()
  })

  it('continues without submission collectors when loading them throws', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(loadSubmissionCollectors).mockRejectedValue(new Error('db down'))

    await main(['a'] as never, 'raw')

    expect(provider.discover).toHaveBeenCalledTimes(1)
    expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), expect.anything())
  })

  it('logs and continues when the mid-run order sync fails', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(syncDefaultOrder).mockRejectedValueOnce(new Error('sync boom'))

    await main(['a'] as never, 'raw')

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to sync default order:', expect.any(Error))
    expect(provider.collect).toHaveBeenCalledTimes(1)
  })

  it('logs and continues when the final order sync fails', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(syncDefaultOrder).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('final sync boom'))

    await main(['a'] as never, 'raw')

    expect(consoleErrorSpy).toHaveBeenCalledWith('Final order sync failed:', expect.any(Error))
  })
})

describe('main — terminal logger (concurrent, default)', () => {
  it('discovers then collects every provider through the concurrent path', async () => {
    const providerA = createFakeCollector()
    const providerB = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: providerA, b: providerB } as never)

    await main(['a', 'b'] as never)

    expect(providerA.discover).toHaveBeenCalledTimes(1)
    expect(providerB.collect).toHaveBeenCalledTimes(1)
    expect(syncDefaultOrder).toHaveBeenCalledTimes(2)
  })

  it('skips a provider with no registered collector, incrementing the skipped counter', async () => {
    vi.mocked(collectables).mockReturnValue({} as never)

    await main(['missing'] as never)

    expect(utils.terminalRow.increment).toHaveBeenCalledWith('skipped', 'missing')
  })

  it('stops discovering and collecting once the shared signal is aborted', async () => {
    utils.controller.abort()
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never)

    expect(provider.discover).not.toHaveBeenCalled()
    expect(provider.collect).not.toHaveBeenCalled()
  })

  it('logs and continues past a discover() failure', async () => {
    const provider = createFakeCollector({
      discover: async () => {
        throw new Error('discover boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never)

    expect(provider.collect).toHaveBeenCalledTimes(1)
    expect(failureLog).toHaveBeenCalled()
  })

  it('logs and continues past a collect() failure, marking the terminal row erred', async () => {
    const provider = createFakeCollector({
      collect: async () => {
        throw new Error('collect boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)

    await main(['a'] as never)

    expect(utils.terminalRow.increment).toHaveBeenCalledWith('eror', 'a')
  })

  it('marks a user-submitted list successful after it collects cleanly', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ 'user-alice': provider } as never)

    await main(['user-alice'] as never)

    expect(updateSubmissionStatus).toHaveBeenCalledWith('user-alice', { success: true })
  })

  it('marks a user-submitted list failed when it throws', async () => {
    const provider = createFakeCollector({
      collect: async () => {
        throw new Error('boom')
      },
    })
    vi.mocked(collectables).mockReturnValue({ 'user-bob': provider } as never)

    await main(['user-bob'] as never)

    expect(updateSubmissionStatus).toHaveBeenCalledWith('user-bob', { success: false })
  })

  it('checks for outstanding connections per-provider only at concurrency 1', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    const execute = vi.fn(async () => ({ rows: [] }))
    vi.mocked(getDrizzle).mockReturnValue({ execute } as never)

    await main(['a'] as never, 'terminal', 1)

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not check for outstanding connections when concurrency is above 1', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    const execute = vi.fn(async () => ({ rows: [] }))
    vi.mocked(getDrizzle).mockReturnValue({ execute } as never)

    await main(['a'] as never, 'terminal', 4)

    expect(execute).not.toHaveBeenCalled()
  })

  it('logs and continues when order sync fails at any point', async () => {
    const provider = createFakeCollector()
    vi.mocked(collectables).mockReturnValue({ a: provider } as never)
    vi.mocked(syncDefaultOrder).mockRejectedValue(new Error('sync boom'))

    await main(['a'] as never)

    expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('order sync error'), expect.anything())
    expect(failureLog).toHaveBeenCalledWith(expect.stringContaining('final order sync error'), expect.anything())
  })
})
