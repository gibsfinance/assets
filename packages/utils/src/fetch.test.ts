import { describe, it, expect, vi, beforeEach } from 'vitest'
import { responseToBuffer, urlToPossibleLocations, retry, cacheResult, limitByTime, limitBy, cancelAllRequests, getLimiter } from './fetch'

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
