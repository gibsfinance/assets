import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAXIMUM_RETRIES,
  RATE_LIMIT_WAIT_MS,
  SERVER_ERROR_WAIT_STEP_MS,
  buildUrl,
  createCoinGeckoClient,
  isRetryableStatus,
  retryAfterMilliseconds,
} from './coingecko-client'

const settings = { baseUrl: 'https://api.example.test/v3', headers: { 'x-cg-demo-api-key': 'secret' } }

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init)

/** A client whose requests answer from `responses` in order; an Error is thrown instead of returned. */
const setup = (responses: (Response | Error)[]) => {
  const queue = [...responses]
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift()!
    if (next instanceof Error) throw next
    return next
  })
  const wait = vi.fn(async (_milliseconds: number) => {})
  const waitForTurn = vi.fn(async () => {})
  const log = vi.fn()
  const client = createCoinGeckoClient({ settings, waitForTurn, fetchImpl: fetchImpl as never, wait, log })
  return { client, fetchImpl, wait, waitForTurn, log }
}

const signal = () => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildUrl', () => {
  it('appends the query and leaves undefined values out', () => {
    expect(buildUrl('https://h/v3', '/coins/list', { include_platform: true, page: 2, skip: undefined })).toBe(
      'https://h/v3/coins/list?include_platform=true&page=2',
    )
  })

  it('adds no question mark for an empty query', () => {
    expect(buildUrl('https://h/v3', '/asset_platforms', {})).toBe('https://h/v3/asset_platforms')
  })
})

describe('retryAfterMilliseconds', () => {
  it('turns seconds into milliseconds', () => {
    expect(retryAfterMilliseconds('2')).toBe(2000)
    expect(retryAfterMilliseconds('0')).toBe(0)
  })

  it.each([null, 'soon', '-1'])('is null for %o', (header) => {
    expect(retryAfterMilliseconds(header)).toBeNull()
  })
})

describe('isRetryableStatus', () => {
  it('retries 429 and 5xx only', () => {
    expect([429, 500, 503].every(isRetryableStatus)).toBe(true)
    expect([400, 401, 404, 499].some(isRetryableStatus)).toBe(false)
  })
})

describe('createCoinGeckoClient', () => {
  it('waits for its turn, sends the key and returns the body', async () => {
    const { client, fetchImpl, waitForTurn } = setup([json([{ id: 'a' }])])

    const body = await client.getJson('/coins/list', { include_platform: true }, signal())

    expect(body).toEqual([{ id: 'a' }])
    expect(waitForTurn).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/v3/coins/list?include_platform=true',
      expect.objectContaining({ headers: { accept: 'application/json', 'x-cg-demo-api-key': 'secret' } }),
    )
  })

  it('does not retry a client error', async () => {
    const { client, fetchImpl, wait, log } = setup([json({ error: 'nope' }, { status: 404 })])

    expect(await client.getJson('/x', {}, signal())).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('/x answered 404; giving up')
  })

  it('waits the retry-after on a 429, or a minute without one', async () => {
    const { client, wait } = setup([
      json({}, { status: 429, headers: { 'retry-after': '3' } }),
      json({}, { status: 429 }),
      json(['ok']),
    ])

    expect(await client.getJson('/x', {}, signal())).toEqual(['ok'])
    expect(wait.mock.calls.map((call) => call[0])).toEqual([3000, RATE_LIMIT_WAIT_MS])
  })

  it('waits longer after each server error, dropped connection or unreadable body', async () => {
    const { client, wait, waitForTurn } = setup([
      json({}, { status: 502 }),
      new Error('socket hang up'),
      new Response('{not json', { status: 200 }),
      json(['ok']),
    ])

    expect(await client.getJson('/x', {}, signal())).toEqual(['ok'])
    expect(wait.mock.calls.map((call) => call[0])).toEqual([
      SERVER_ERROR_WAIT_STEP_MS,
      SERVER_ERROR_WAIT_STEP_MS * 2,
      SERVER_ERROR_WAIT_STEP_MS * 3,
    ])
    // Every attempt, failed or not, takes its turn: CoinGecko counts them all.
    expect(waitForTurn).toHaveBeenCalledTimes(4)
  })

  it('gives up after the most retries and answers null', async () => {
    const { client, fetchImpl, wait, log } = setup(
      Array.from({ length: MAXIMUM_RETRIES + 1 }, () => json({}, { status: 500 })),
    )

    expect(await client.getJson('/x', {}, signal())).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(MAXIMUM_RETRIES + 1)
    expect(wait).toHaveBeenCalledTimes(MAXIMUM_RETRIES)
    expect(log).toHaveBeenLastCalledWith(`/x still failing after ${MAXIMUM_RETRIES} retries; giving up`)
  })

  it('does nothing when the signal is already aborted', async () => {
    const { client, fetchImpl } = setup([])
    const controller = new AbortController()
    controller.abort()

    expect(await client.getJson('/x', {}, controller.signal)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('answers null without retrying when the request fails because of an abort', async () => {
    const controller = new AbortController()
    const wait = vi.fn(async () => {})
    const client = createCoinGeckoClient({
      settings,
      waitForTurn: async () => {},
      fetchImpl: (async () => {
        controller.abort()
        throw new Error('aborted')
      }) as never,
      wait,
    })

    expect(await client.getJson('/x', {}, controller.signal)).toBeNull()
    expect(wait).not.toHaveBeenCalled()
  })

  it('answers null when the pause between retries is cut short by an abort', async () => {
    const wait = vi.fn(async () => {
      throw new Error('aborted')
    })
    const client = createCoinGeckoClient({
      settings,
      waitForTurn: async () => {},
      fetchImpl: (async () => json({}, { status: 500 })) as never,
      wait,
    })

    expect(await client.getJson('/x', {}, signal())).toBeNull()
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('falls back to the global fetch, the real pause and a silent log', async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(json({ ok: true }))
    vi.stubGlobal('fetch', globalFetch)
    const client = createCoinGeckoClient({ settings, waitForTurn: async () => {} })

    expect(await client.getJson('/x', {}, signal())).toEqual({ ok: true })
    expect(globalFetch).toHaveBeenCalledTimes(2)
  })
})
