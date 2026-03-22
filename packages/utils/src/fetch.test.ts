import { describe, it, expect, vi, beforeEach } from 'vitest'
import { responseToBuffer, urlToPossibleLocations, retry, cacheResult, limitByTime } from './fetch'

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
