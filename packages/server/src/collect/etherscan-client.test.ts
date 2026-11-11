import { describe, expect, it, vi } from 'vitest'
import {
  backoffMilliseconds,
  buildRequestUrl,
  createEtherscanClient,
  ETHERSCAN_API_URL,
  MAXIMUM_RATE_LIMIT_RETRIES,
  redactKey,
} from './etherscan-client'

const KEY = 'SECRETKEY123'
const ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const request = { chainId: 1, endpoint: 'tokeninfo', address: ADDRESS } as const

const answer = (body: unknown, status = 200) => ({ status, json: async () => body }) as Response
const okBody = { status: '1', message: 'OK', result: [{ symbol: 'USDC' }] }
const rateBody = {
  status: '0',
  message: 'NOTOK',
  result: 'Max rate limit reached, please use API Key for higher rate limit',
}

/** A fake clock whose sleep advances it, so spacing and backoff can be read as numbers. */
const fakeClock = () => {
  let time = 1_000_000
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => time,
    sleep: vi.fn(async (milliseconds: number) => {
      sleeps.push(milliseconds)
      time += milliseconds
    }),
  }
}

describe('request address', () => {
  it('names the V2 host, the chain, the endpoint, the token and the key', () => {
    const url = new URL(buildRequestUrl({ ...request, apiKey: KEY }))
    expect(`${url.origin}${url.pathname}`).toBe(ETHERSCAN_API_URL)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      chainid: '1',
      module: 'token',
      action: 'tokeninfo',
      contractaddress: ADDRESS,
      apikey: KEY,
    })
  })
})

describe('redactKey', () => {
  it('replaces every copy of the key', () => {
    expect(redactKey(`fail ${KEY} then ${KEY}`, KEY)).toBe('fail [key] then [key]')
  })
})

describe('backoffMilliseconds', () => {
  it('doubles from one second and stops at eight', () => {
    expect([0, 1, 2, 3, 4, 10].map(backoffMilliseconds)).toEqual([1000, 2000, 4000, 8000, 8000, 8000])
  })
})

describe('createEtherscanClient', () => {
  it('returns the classification and the raw result of an ok answer', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi.fn(async () => answer(okBody))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 3, fetchImplementation, ...clock })

    const call = await client.call(request)

    expect(call.classification.outcome).toBe('ok')
    expect(call.result).toEqual(okBody.result)
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('passes a plan refusal straight through and does not retry it', async () => {
    const clock = fakeClock()
    const body = {
      status: '0',
      message: 'NOTOK',
      result: 'Sorry, it looks like you are trying to access an API Pro endpoint.',
    }
    const fetchImplementation = vi.fn(async () => answer(body))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 3, fetchImplementation, ...clock })

    const call = await client.call(request)

    expect(call.classification.outcome).toBe('requires-pro')
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('treats a body with no result as a null result', async () => {
    const clock = fakeClock()
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 3,
      fetchImplementation: async () => answer({ status: '1' }),
      ...clock,
    })
    expect((await client.call(request)).result).toBeNull()
  })

  it('classifies a JSON null body as other', async () => {
    const clock = fakeClock()
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 3,
      fetchImplementation: async () => answer(null),
      ...clock,
    })
    const call = await client.call(request)
    expect(call.classification.outcome).toBe('other')
    expect(call.result).toBeNull()
  })

  it('backs off 1 s, 2 s, 4 s after rate messages and then succeeds', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(answer(rateBody))
      .mockResolvedValueOnce(answer(rateBody))
      .mockResolvedValueOnce(answer(rateBody))
      .mockResolvedValueOnce(answer(okBody))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 1000, fetchImplementation, ...clock })

    const call = await client.call(request)

    expect(call.classification.outcome).toBe('ok')
    expect(fetchImplementation).toHaveBeenCalledTimes(4)
    expect(clock.sleeps.filter((milliseconds) => milliseconds >= 1000)).toEqual([1000, 2000, 4000])
  })

  it('gives up with rate-limited after the retry limit, and asks no more than once plus the retries', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi.fn(async () => answer(rateBody))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 1000, fetchImplementation, ...clock })

    const call = await client.call(request)

    expect(call.classification.outcome).toBe('rate-limited')
    expect(fetchImplementation).toHaveBeenCalledTimes(1 + MAXIMUM_RATE_LIMIT_RETRIES)
  })

  it('reads HTTP 429 as rate-limited without parsing the body', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi.fn(async () => answer(null, 429))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 1000, fetchImplementation, ...clock })

    const call = await client.call(request)

    expect(call.classification).toEqual({ outcome: 'rate-limited', detail: 'HTTP 429 Too Many Requests' })
  })

  it('spaces calls to the plan rate', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi.fn(async () => answer(okBody))
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 5, fetchImplementation, ...clock })

    await client.call(request)
    await client.call(request)
    await client.call(request)

    // tokeninfo is capped at 2 per second, below this plan's 5, so the gap is 500 ms.
    expect(clock.sleeps).toEqual([500, 500])
  })

  it('spaces calls to the plan rate when it is lower than the endpoint cap', async () => {
    const clock = fakeClock()
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 1,
      fetchImplementation: async () => answer(okBody),
      ...clock,
    })

    await client.call(request)
    await client.call(request)

    expect(clock.sleeps).toEqual([1000])
  })

  it('gives each caller that starts together its own slot', async () => {
    // A clock that stands still, so the waits read as the slots each caller was given.
    const waits: number[] = []
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 2,
      fetchImplementation: async () => answer(okBody),
      now: () => 1_000_000,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
      },
    })

    await Promise.all([client.call(request), client.call(request), client.call(request)])

    expect(waits).toEqual([500, 1000])
  })

  it('reports a network fault as other, with the key removed from the text', async () => {
    const clock = fakeClock()
    const fetchImplementation = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://api.etherscan.io/v2/api?apikey=${KEY}`)
    })
    const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 3, fetchImplementation, ...clock })

    const { classification } = await client.call(request)

    expect(classification.outcome).toBe('other')
    expect(classification.detail).toContain('ECONNREFUSED')
    expect(classification.detail).not.toContain(KEY)
  })

  it('reports a thrown value that is not an error as other', async () => {
    const clock = fakeClock()
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 3,
      fetchImplementation: async () => Promise.reject('plain text'),
      ...clock,
    })
    expect((await client.call(request)).classification.detail).toBe('the request failed: plain text')
  })

  it('rejects when the signal aborts, rather than reporting a fault', async () => {
    const clock = fakeClock()
    const controller = new AbortController()
    const fetchImplementation = vi.fn(async () => {
      controller.abort(new Error('stopped'))
      throw new Error('aborted')
    })
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 3,
      fetchImplementation,
      signal: controller.signal,
      ...clock,
    })

    await expect(client.call(request)).rejects.toThrow('aborted')
  })

  it('uses the global fetch and a real timer by default', async () => {
    const globalFetch = vi.fn(async () => answer(okBody))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const client = createEtherscanClient({ apiKey: KEY, callsPerSecond: 1000 })
      expect((await client.call(request)).classification.outcome).toBe('ok')
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('waits on the real timer between spaced calls, and stops waiting when aborted', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const client = createEtherscanClient({
        apiKey: KEY,
        callsPerSecond: 2,
        fetchImplementation: async () => answer(okBody),
        signal: controller.signal,
      })
      await client.call(request)

      const spaced = client.call(request)
      await vi.advanceTimersByTimeAsync(500)
      expect((await spaced).classification.outcome).toBe('ok')

      const interrupted = client.call(request)
      const rejection = expect(interrupted).rejects.toThrow('stop')
      controller.abort(new Error('stop'))
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects at once when the signal was already aborted before a wait', async () => {
    const controller = new AbortController()
    const client = createEtherscanClient({
      apiKey: KEY,
      callsPerSecond: 1,
      fetchImplementation: async () => answer(okBody),
      signal: controller.signal,
    })
    await client.call(request)
    controller.abort(new Error('already'))

    await expect(client.call(request)).rejects.toThrow('already')
  })
})
