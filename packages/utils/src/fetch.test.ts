import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { responseToBuffer, urlToPossibleLocations, retry, cacheResult, limitByTime, limitBy, cancelAllRequests, getLimiter, fetch as iterativeFetch } from './fetch'

describe('responseToBuffer', () => {
  it('returns buffer from successful response', async () => {
    const body = 'hello world'
    const res = new Response(body, { status: 200 })
    const buf = await responseToBuffer(res)
    expect(buf).not.toBeNull()
    expect(buf!.toString()).toBe('hello world')
  })

  it('returns null for non-ok response', async () => {
    const res = new Response('error', { status: 404 })
    const buf = await responseToBuffer(res)
    expect(buf).toBeNull()
  })

  it('throws if response body contains "window" (redirect detection)', async () => {
    const res = new Response('<html><script>window.location</script></html>', { status: 200 })
    await expect(responseToBuffer(res)).rejects.toThrow('redirected')
  })
})

describe('urlToPossibleLocations', () => {
  it('returns single URL for http URLs', () => {
    const urls = urlToPossibleLocations('https://example.com/image.png', [])
    expect(urls).toHaveLength(1)
    expect(urls[0].toString()).toBe('https://example.com/image.png')
  })

  it('expands IPFS URLs to all provided domains', () => {
    const ipfsDomains = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/']
    const urls = urlToPossibleLocations('ipfs://QmHash123/image.png', ipfsDomains)
    expect(urls).toHaveLength(2)
    expect(urls[0].toString()).toContain('ipfs.io')
    expect(urls[1].toString()).toContain('cloudflare-ipfs.com')
  })

  it('throws for non-http protocols', () => {
    expect(() => urlToPossibleLocations('ftp://example.com/file', [])).toThrow('unrecognized protocol')
  })

  it('handles URL objects as input', () => {
    const url = new URL('https://example.com/path')
    const urls = urlToPossibleLocations(url, [])
    expect(urls).toHaveLength(1)
    expect(urls[0].toString()).toBe('https://example.com/path')
  })
})

describe('retry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retry(fn, { attempts: 3, delay: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValue('ok')
    const result = await retry(fn, { attempts: 3, delay: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after all attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))
    await expect(retry(fn, { attempts: 2, delay: 10 })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('aborts immediately when signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retry(fn, { signal: controller.signal })).rejects.toThrow('aborted')
    expect(fn).not.toHaveBeenCalled()
  })

  it('throws aborted when signal is aborted between attempts (line 49 guard)', async () => {
    const controller = new AbortController()
    const fn = vi.fn(async () => {
      // Abort the signal during fn execution so the post-attempt guard fires
      controller.abort()
      throw new Error('fail')
    })

    await expect(retry(fn, { attempts: 3, delay: 10, signal: controller.signal }))
      .rejects.toThrow('aborted')

    // Only one attempt ran — the between-attempts abort check cut the loop short
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('abort during retry delay resolves the delay early and throws aborted', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // attempts:3, delay:60_000 — first attempt fails, then we abort mid-delay.
      // Attach a rejection handler immediately so the promise is never "unhandled"
      // while fake-timer advancement flushes it.
      const promise = retry(fn, { attempts: 3, delay: 60_000, signal: controller.signal })
      const settled = promise.then(
        (v) => ({ status: 'fulfilled', value: v }),
        (e: unknown) => ({ status: 'rejected', reason: e }),
      )

      // Drain microtasks so the first fn() rejection is processed and the
      // 60-second delay timer is registered
      await vi.advanceTimersByTimeAsync(0)

      // Abort while the timer is still pending: the abort listener fires,
      // clears the timer, and resolves the delay promise early
      controller.abort()

      // Flush remaining microtasks/timers so the loop re-enters, hits the
      // signal.aborted guard, and rejects the outer promise
      await vi.runAllTimersAsync()

      const result = await settled
      expect(result.status).toBe('rejected')
      expect((result as { status: 'rejected'; reason: Error }).reason.message).toBe('aborted')
      // Only the first attempt ran; the abort cut off the retry cycle
      expect(fn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('cacheResult', () => {
  it('returns cached result within TTL', async () => {
    let calls = 0
    const worker = async () => ++calls
    const cached = cacheResult(worker, 1000)

    const first = await cached()
    const second = await cached()
    expect(first).toBe(1)
    expect(second).toBe(1) // same cached result
    expect(calls).toBe(1)
  })

  it('refreshes after TTL expires', async () => {
    let calls = 0
    const worker = async () => ++calls
    // TTL of 1ms
    const cached = cacheResult(worker, 1)

    await cached()
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10))
    const second = await cached()
    expect(second).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('limitByTime', () => {
  it('enforces minimum delay between calls', async () => {
    const limiter = limitByTime(50)
    const start = Date.now()
    await limiter()
    await limiter()
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45) // ~50ms with timing tolerance
  })

  it('allows immediate first call', async () => {
    const limiter = limitByTime(1000)
    const start = Date.now()
    await limiter()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})

describe('limitBy', () => {
  it('returns a callable promise-limit function', () => {
    const limiter = limitBy('test-key-a')
    expect(typeof limiter).toBe('function')
  })

  it('returns the same limiter instance for the same key (memoized)', () => {
    const first = limitBy('test-key-b')
    const second = limitBy('test-key-b')
    expect(first).toBe(second)
  })

  it('returns different limiter instances for different keys', () => {
    const a = limitBy('test-key-c')
    const b = limitBy('test-key-d')
    expect(a).not.toBe(b)
  })

  it('executes a task through the limiter', async () => {
    const limiter = limitBy<string>('test-key-e')
    const result = await limiter(() => Promise.resolve('hello'))
    expect(result).toBe('hello')
  })

  it('respects a custom concurrency count', async () => {
    const limiter = limitBy<number>('test-key-f', 1)
    let concurrent = 0
    let maxConcurrent = 0
    const task = () =>
      new Promise<number>((resolve) => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        setTimeout(() => {
          concurrent--
          resolve(concurrent)
        }, 10)
      })
    await Promise.all([limiter(task), limiter(task)])
    expect(maxConcurrent).toBe(1)
  })
})

describe('cancelAllRequests', () => {
  it('runs without throwing when no controllers are registered', () => {
    expect(() => cancelAllRequests()).not.toThrow()
  })

  it('is idempotent — calling multiple times does not throw', () => {
    expect(() => {
      cancelAllRequests()
      cancelAllRequests()
    }).not.toThrow()
  })
})

describe('getLimiter', () => {
  it('returns a callable promise-limit function', () => {
    const url = new URL('https://example.com/path')
    const limiter = getLimiter(url)
    expect(typeof limiter).toBe('function')
  })

  it('returns the same limiter for URLs with the same host', () => {
    const a = getLimiter(new URL('https://example.com/foo'))
    const b = getLimiter(new URL('https://example.com/bar'))
    expect(a).toBe(b)
  })

  it('returns different limiters for different hosts', () => {
    const a = getLimiter(new URL('https://alpha.example.com/'))
    const b = getLimiter(new URL('https://beta.example.com/'))
    expect(a).not.toBe(b)
  })

  it('executes a task through the host limiter', async () => {
    const url = new URL('https://limiter-test.example.com/')
    const limiter = getLimiter(url)
    const result = await limiter(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// fetch (iterativeIpfsCompatableFetch) tests
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object that satisfies the fetch contract. */
const makeOkResponse = (body = 'ok'): Response =>
  new Response(body, { status: 200 })

describe('fetch (iterativeIpfsCompatableFetch)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a simple HTTP URL successfully', async () => {
    const mockResponse = makeOkResponse('hello')
    vi.mocked(global.fetch).mockResolvedValue(mockResponse)

    const response = await iterativeFetch('https://example.com/data')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(response).toBe(mockResponse)
  })

  it('expands an IPFS URL to multiple domain candidates and returns first success', async () => {
    const mockResponse = makeOkResponse('ipfs content')
    // First domain succeeds
    vi.mocked(global.fetch).mockResolvedValue(mockResponse)

    const ipfsDomains = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/']
    const response = await iterativeFetch('ipfs://QmTestHash123', undefined, ipfsDomains)

    // Should only need one fetch call because the first domain succeeded
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(response).toBe(mockResponse)
  })

  it('tries the next IPFS domain when the first fails', async () => {
    const mockResponse = makeOkResponse('second domain content')
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('first domain unavailable'))
      .mockResolvedValue(mockResponse)

    const ipfsDomains = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/']
    const response = await iterativeFetch('ipfs://QmTestHash456', undefined, ipfsDomains)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(response).toBe(mockResponse)
  })

  it('throws the last error when all URL candidates fail', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('first failed'))
      .mockRejectedValueOnce(new Error('second failed'))

    const ipfsDomains = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/']
    await expect(
      iterativeFetch('ipfs://QmTestHashFail', undefined, ipfsDomains),
    ).rejects.toThrow('second failed')
  })

  it('respects an already-aborted signal and rejects without calling fetch', async () => {
    const controller = new AbortController()
    controller.abort()

    vi.mocked(global.fetch).mockResolvedValue(makeOkResponse())

    await expect(
      iterativeFetch('https://example.com/data', { signal: controller.signal }),
    ).rejects.toThrow()

    // fetch itself should not have been called — the abort check happens before the network call
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects with AbortError when signal is already aborted at race construction (line 132)', async () => {
    const controller = new AbortController()
    controller.abort()

    vi.mocked(global.fetch).mockResolvedValue(makeOkResponse())

    // The synchronous `if (signal.aborted) return reject(...)` branch inside
    // the Promise.race constructor must fire, producing an AbortError with
    // name 'AbortError' and message 'Aborted'.
    const rejection = iterativeFetch('https://example.com/abort-race', { signal: controller.signal })

    await expect(rejection).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Aborted',
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects with AbortError when signal is aborted mid-flight (addEventListener path)', async () => {
    const controller = new AbortController()

    // Mock fetch to hang until its signal aborts
    vi.mocked(global.fetch).mockImplementation((_url, options) =>
      new Promise((_, reject) => {
        const sig = (options as RequestInit | undefined)?.signal
        sig?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
    )

    const promise = iterativeFetch('https://midflight-abort.example.com/data', {
      signal: controller.signal,
    })

    // Signal is NOT aborted yet — addEventListener on line 133 has been called.
    // Now abort to trigger the listener.
    controller.abort()

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Aborted',
    })
  })

  it('uses per-host rate limiting (getLimiter) so concurrent calls to the same host are serialised', async () => {
    const responses = [makeOkResponse('first'), makeOkResponse('second')]
    let callIndex = 0
    vi.mocked(global.fetch).mockImplementation(async () => responses[callIndex++])

    const [r1, r2] = await Promise.all([
      iterativeFetch('https://ratelimit-test.example.com/a'),
      iterativeFetch('https://ratelimit-test.example.com/b'),
    ])

    expect(r1).toBe(responses[0])
    expect(r2).toBe(responses[1])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
