import { describe, it, expect, vi } from 'vitest'
import { createConcurrencyGate } from './concurrency-gate'
import {
  createRemoteImageLoader,
  REMOTE_IMAGE_CACHE_TTL_MS,
  REMOTE_IMAGE_MAX_BYTES,
  type RemoteImageLoaderOptions,
} from './remote-image'

const bytesOf = (text: string) => new Uint8Array(Buffer.from(text))

/** A loader whose network answers `body`, whose sanitizer marks what it touched, and whose clock a test moves. */
function setup(options: RemoteImageLoaderOptions & { body?: () => Response } = {}) {
  const { body = () => new Response(bytesOf('logo')), ...rest } = options
  let at = 1_000_000
  const fetchImpl = vi.fn(async () => body()) as unknown as typeof fetch
  const sanitize = vi.fn(async (bytes: Buffer, ext: string) => Buffer.from(`${ext}:${bytes.toString()}`))
  const loader = createRemoteImageLoader({ fetchImpl, sanitize, now: () => at, ...rest })
  return { loader, fetchImpl: vi.mocked(fetchImpl), sanitize, advance: (ms: number) => (at += ms) }
}

describe('createRemoteImageLoader', () => {
  it('returns the sanitized bytes, not the bytes that were fetched', async () => {
    const { loader, sanitize } = setup()
    const bytes = await loader.load({ uri: 'https://cdn.example/a.svg', ext: '.svg' })
    expect(bytes?.toString()).toBe('.svg:logo')
    expect(sanitize).toHaveBeenCalledTimes(1)
  })

  // The real sanitizer refuses a vector file it cannot parse by throwing. The loader must
  // turn that into "cannot be read", which the plate path answers with the plain response,
  // never pass the unparsed bytes on and never fail the request.
  it('answers null when the real sanitizer refuses the fetched file, and remembers the failure', async () => {
    const malformed = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</svg>'
    const fetchImpl = vi.fn(async () => new Response(bytesOf(malformed))) as unknown as typeof fetch
    const loader = createRemoteImageLoader({ fetchImpl, now: () => 1 })
    const request = { uri: 'https://cdn.example/bad.svg', ext: '.svg' }
    expect(await loader.load(request)).toBeNull()
    expect(await loader.load(request)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('names a stored vector extension the sanitizer knows', async () => {
    const { loader } = setup()
    expect((await loader.load({ uri: 'https://cdn.example/a', ext: '.svg+xml' }))?.toString()).toBe('.svg:logo')
  })

  it('fetches an address once while its bytes are kept, and again after they expire', async () => {
    const { loader, fetchImpl, advance } = setup()
    const request = { uri: 'https://cdn.example/a.png', ext: '.png' }
    await loader.load(request)
    await loader.load(request)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loader.size).toBe(1)
    advance(REMOTE_IMAGE_CACHE_TTL_MS + 1)
    await loader.load(request)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps one answer per extension, because the sanitizer depends on it', async () => {
    const { loader, fetchImpl } = setup()
    await loader.load({ uri: 'https://cdn.example/a', ext: '.png' })
    await loader.load({ uri: 'https://cdn.example/a', ext: '.svg' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one download between requests that arrive together', async () => {
    const { loader, fetchImpl } = setup()
    const request = { uri: 'https://cdn.example/a.png', ext: '.png' }
    const answers = await Promise.all([loader.load(request), loader.load(request), loader.load(request)])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(new Set(answers.map((bytes) => bytes?.toString())).size).toBe(1)
  })

  it('forgets the oldest address when it holds more than its entry limit', async () => {
    const { loader, fetchImpl } = setup({ maxEntries: 2 })
    for (const name of ['a', 'b', 'c']) await loader.load({ uri: `https://cdn.example/${name}`, ext: '.png' })
    expect(loader.size).toBe(2)
    await loader.load({ uri: 'https://cdn.example/c', ext: '.png' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    await loader.load({ uri: 'https://cdn.example/a', ext: '.png' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('forgets the oldest address when it holds more bytes than its byte limit', async () => {
    // Each cached answer is ".png:logo", nine bytes; two fit in eighteen, three do not.
    const { loader } = setup({ maxTotalBytes: 18 })
    for (const name of ['a', 'b', 'c']) await loader.load({ uri: `https://cdn.example/${name}`, ext: '.png' })
    expect(loader.size).toBe(2)
  })

  it('refuses a body that declares itself larger than the cap, without reading it', async () => {
    const cancel = vi.fn()
    const body = () =>
      new Response(
        new ReadableStream({
          pull: (controller) => controller.enqueue(bytesOf('x')),
          cancel,
        }),
        { headers: { 'content-length': String(REMOTE_IMAGE_MAX_BYTES + 1) } },
      )
    const { loader, sanitize } = setup({ body })
    expect(await loader.load({ uri: 'https://cdn.example/big', ext: '.png' })).toBeNull()
    expect(cancel).toHaveBeenCalled()
    expect(sanitize).not.toHaveBeenCalled()
  })

  it('stops reading a body that never declares its length once it passes the cap', async () => {
    let chunks = 0
    const cancel = vi.fn()
    const body = () =>
      new Response(
        new ReadableStream({
          pull: (controller) => {
            chunks += 1
            controller.enqueue(new Uint8Array(1024))
          },
          cancel,
        }),
      )
    const { loader } = setup({ body, maxBytes: 4096 })
    expect(await loader.load({ uri: 'https://cdn.example/endless', ext: '.png' })).toBeNull()
    expect(cancel).toHaveBeenCalled()
    // It read a few chunks past the cap, not an endless stream.
    expect(chunks).toBeLessThan(10)
  })

  it('accepts a body exactly as large as the cap', async () => {
    const body = () => new Response(new Uint8Array(4096))
    const { loader } = setup({ body, maxBytes: 4096, sanitize: async (bytes) => bytes })
    expect((await loader.load({ uri: 'https://cdn.example/exact', ext: '.png' }))?.length).toBe(4096)
  })

  it.each([
    ['an answer that is not ok', () => new Response('nope', { status: 404 })],
    ['an empty body', () => new Response(new Uint8Array(0))],
    ['an answer with no body', () => new Response(null)],
  ])('answers null for %s', async (_label, body) => {
    const { loader } = setup({ body })
    expect(await loader.load({ uri: 'https://cdn.example/x', ext: '.png' })).toBeNull()
  })

  it('answers null when the network fails or the sanitizer throws', async () => {
    const down = createRemoteImageLoader({
      fetchImpl: (async () => {
        throw new Error('down')
      }) as unknown as typeof fetch,
    })
    expect(await down.load({ uri: 'https://cdn.example/x', ext: '.png' })).toBeNull()
    const { loader } = setup({
      sanitize: async () => {
        throw new Error('cannot sanitize')
      },
    })
    expect(await loader.load({ uri: 'https://cdn.example/y', ext: '.png' })).toBeNull()
  })

  it('remembers a failure for a minute, so a dead link is not tried on every request', async () => {
    const { loader, fetchImpl, advance } = setup({ body: () => new Response('nope', { status: 500 }) })
    const request = { uri: 'https://cdn.example/dead', ext: '.png' }
    await loader.load(request)
    await loader.load(request)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    advance(REMOTE_IMAGE_CACHE_TTL_MS + 1)
    await loader.load(request)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('answers null, and does not fetch, when too many downloads are running or waiting', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 0 })
    let release = () => {}
    const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const { loader, fetchImpl } = setup({ gate })
    expect(await loader.load({ uri: 'https://cdn.example/busy', ext: '.png' })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    release()
    await holding
    // A refusal for load is not a failure of the address: it is tried again.
    expect((await loader.load({ uri: 'https://cdn.example/busy', ext: '.png' }))?.toString()).toBe('.png:logo')
  })

  it('limits how many downloads run at once', async () => {
    let running = 0
    let most = 0
    const body = () => new Response(bytesOf('logo'))
    const slowFetch = (async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return body()
    }) as unknown as typeof fetch
    const loader = createRemoteImageLoader({
      fetchImpl: slowFetch,
      sanitize: async (bytes) => bytes,
      gate: createConcurrencyGate({ limit: 2, maxQueue: 10 }),
    })
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => loader.load({ uri: `https://cdn.example/${index}`, ext: '.png' })),
    )
    expect(most).toBe(2)
  })

  it('passes a timeout signal to the network call', async () => {
    const { loader, fetchImpl } = setup()
    await loader.load({ uri: 'https://cdn.example/a.png', ext: '.png' })
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example/a.png', { signal: expect.any(AbortSignal) })
  })

  it('forgets everything on reset', async () => {
    const { loader, fetchImpl } = setup()
    const request = { uri: 'https://cdn.example/a.png', ext: '.png' }
    await loader.load(request)
    loader.reset()
    expect(loader.size).toBe(0)
    await loader.load(request)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uses the global network call and the real sanitizer when none are given', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png))),
    )
    try {
      const loader = createRemoteImageLoader()
      const bytes = await loader.load({ uri: 'https://cdn.example/one.png', ext: '.png' })
      // Re-encoded by the real sanitizer: still a png.
      expect(bytes?.subarray(1, 4).toString()).toBe('PNG')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
