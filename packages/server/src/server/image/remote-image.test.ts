import { describe, it, expect, vi, type Mock } from 'vitest'
import sharp from 'sharp'
import { createConcurrencyGate } from './concurrency-gate'
import { createSanitizerPool, type SanitizeAttempt, type SanitizerRunner } from './sanitizer-pool'
import {
  createRemoteImageLoader,
  REMOTE_IMAGE_CACHE_TTL_MS,
  REMOTE_IMAGE_MAX_BYTES,
  REMOTE_IMAGE_SHED,
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
    expect(((await loader.load({ uri: 'https://cdn.example/exact', ext: '.png' })) as Buffer).length).toBe(4096)
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

  it('answers shed, not null, and does not fetch, when too many downloads are running or waiting', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 0 })
    let release = () => {}
    const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const { loader, fetchImpl } = setup({ gate })
    expect(await loader.load({ uri: 'https://cdn.example/busy', ext: '.png' })).toBe(REMOTE_IMAGE_SHED)
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
    // A real picture: the sanitizer now refuses a file sharp cannot decode, instead of passing it on.
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } })
      .png()
      .toBuffer()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png))),
    )
    try {
      const loader = createRemoteImageLoader()
      const bytes = await loader.load({ uri: 'https://cdn.example/one.png', ext: '.png' })
      // Re-encoded by the real sanitizer: still a png.
      expect((bytes as Buffer).subarray(1, 4).toString()).toBe('PNG')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('one deadline from arrival (third review, finding 7)', () => {
  it('turns away a request whose deadline passes in line, and never downloads for it', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    let release = () => {}
    const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const { loader, fetchImpl } = setup({ gate, timeoutMs: 30 })

    const started = Date.now()
    const outcome = await loader.load({ uri: 'https://cdn.example/queued', ext: '.png' })

    // It leaves when its own deadline passes, not when the line finally reaches it.
    expect(outcome).toBe(REMOTE_IMAGE_SHED)
    expect(Date.now() - started).toBeLessThan(1_000)
    release()
    await holding
    // The abandoned place in line is reached later and does not download.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(gate.active).toBe(0)
    expect(gate.waiting).toBe(0)
  })

  it('does not remember a deadline passed in line as a failure of the address', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    let release = () => {}
    const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const { loader, fetchImpl } = setup({ gate, timeoutMs: 20 })
    expect(await loader.load({ uri: 'https://cdn.example/again', ext: '.png' })).toBe(REMOTE_IMAGE_SHED)
    release()
    await holding
    expect((await loader.load({ uri: 'https://cdn.example/again', ext: '.png' }))?.toString()).toBe('.png:logo')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('counts the time spent in line against the download, with one signal for both', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    const { loader, fetchImpl } = setup({ gate, timeoutMs: 5_000 })
    await loader.load({ uri: 'https://cdn.example/a.png', ext: '.png' })
    const signal = (fetchImpl.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal
    expect(signal.aborted).toBe(false)
  })

  it('remembers a download that is still running at the deadline as a failure of the address', async () => {
    let downloads = 0
    const hanging = ((_uri: string, init: { signal: AbortSignal }) => {
      downloads += 1
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('timed out'))),
      )
    }) as unknown as typeof fetch
    const loader = createRemoteImageLoader({ fetchImpl: hanging, timeoutMs: 20 })
    const request = { uri: 'https://cdn.example/slow', ext: '.png' }
    // The deadline passed during the network call: the request is shed, and the aborted call is the remote's failure.
    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    // Let the aborted call settle, then the failure is remembered: the second ask does not download again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await loader.load(request)).toBeNull()
    expect(downloads).toBe(1)
  })

  // Fourth review, finding 1: a deadline that passes while the server sanitizes the bytes is the server's
  // load, not the remote's. Recording it as a failure kept the logo missing for a minute.
  it('answers shed, and remembers no failure, when the deadline passes while the bytes are being sanitized', async () => {
    // The sanitizing takes ten times the window, so the second ask joins the download still running, whatever the load.
    const slowSanitize = async (bytes: Buffer) => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return bytes
    }
    const { loader, fetchImpl } = setup({ sanitize: slowSanitize, timeoutMs: 40 })
    const request = { uri: 'https://cdn.example/cpu-bound.png', ext: '.png' }

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    // No failure was remembered. The second ask joins the download still running, so it makes no new fetch.
    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('still remembers a refused body as a failure when the deadline has not passed', async () => {
    const { loader, fetchImpl } = setup({ body: () => new Response(bytesOf('x'.repeat(20))), maxBytes: 4 })
    const request = { uri: 'https://cdn.example/big.png', ext: '.png' }
    expect(await loader.load(request)).toBeNull()
    expect(await loader.load(request)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('a download that started late is shed, not charged (fifth review, finding 3)', () => {
  // The reviewer's scenario: the line has one place, a holder keeps it 250 ms, the deadline is 300 ms after arrival,
  // and a healthy host answers in 100 ms. Request 1 waits in line, starts at 250 ms with 50 ms left, and is cut off:
  // it is shed. Request 2 at 400 ms downloads, and must succeed; a failure charged to the address would refuse it.
  it('sheds a request whose download started late and was cut off, and lets the next request succeed', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    const holding = gate.run(() => new Promise<void>((resolve) => setTimeout(resolve, 250)))
    const healthyHost = vi.fn(
      (_uri: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          const answer = setTimeout(() => resolve(new Response(bytesOf('logo'))), 100)
          init.signal.addEventListener('abort', () => {
            clearTimeout(answer)
            reject(new Error('aborted'))
          })
        }),
    ) as unknown as typeof fetch
    const loader = createRemoteImageLoader({
      fetchImpl: healthyHost,
      sanitize: async (bytes) => bytes,
      gate,
      timeoutMs: 300,
    })
    const request = { uri: 'https://cdn.example/healthy.png', ext: '.png' }

    const first = loader.load(request)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(await first).toBe(REMOTE_IMAGE_SHED)
    await holding

    const second = await loader.load(request)
    expect(second).not.toBeNull()
    expect(second).not.toBe(REMOTE_IMAGE_SHED)
    // The late answer was kept, so the second request needed no fetch.
    expect(healthyHost).toHaveBeenCalledTimes(1)
  })

  it('still charges a download that started at arrival and was cut off by the deadline', async () => {
    const hanging = ((_uri: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('timed out'))),
      )) as unknown as typeof fetch
    const loader = createRemoteImageLoader({ fetchImpl: hanging, sanitize: async (bytes) => bytes, timeoutMs: 40 })
    const request = { uri: 'https://cdn.example/hung.png', ext: '.png' }
    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await loader.load(request)).toBeNull()
  })
})

describe('the sanitizer runner decides what a deadline or a refusal costs (fifth review, finding 2)', () => {
  /** A runner that answers the given attempts in order, and counts its jobs. */
  const runnerAnswering = (...attempts: SanitizeAttempt[]): SanitizerRunner & { run: Mock } => {
    const run = vi.fn(async () => attempts.shift() ?? { status: 'refused' as const, message: 'no answer left' })
    return {
      run,
      workers: () => 0,
      reserve: () => ({ release: () => undefined }),
      workersPeak: () => 0,
      workersStarted: () => 0,
      close: () => undefined,
    }
  }
  const request = { uri: 'https://cdn.example/worker.png', ext: '.png' }

  it('charges an address whose sanitizer the deadline cut off, as a refused file is charged', async () => {
    const sanitizer = runnerAnswering({ status: 'cut-off' })
    const fetchImpl = vi.fn(async () => new Response(bytesOf('logo')))
    const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer })

    expect(await loader.load(request)).toBeNull()
    // The failure is remembered: the second ask does not download or sanitize again.
    expect(await loader.load(request)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sanitizer.run).toHaveBeenCalledTimes(1)
  })

  it('sheds, and charges nothing, a job that expired while it waited for a worker', async () => {
    const sanitizer = runnerAnswering(
      { status: 'expired-in-queue' },
      { status: 'sanitized', bytes: Buffer.from('logo') },
    )
    const fetchImpl = vi.fn(async () => new Response(bytesOf('logo')))
    const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer })

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    expect((await loader.load(request))?.toString()).toBe('logo')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps the sanitized bytes the runner returns, so a later request needs no download', async () => {
    const sanitizer = runnerAnswering({ status: 'sanitized', bytes: Buffer.from('clean') })
    const fetchImpl = vi.fn(async () => new Response(bytesOf('logo')))
    const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer })

    expect((await loader.load(request))?.toString()).toBe('clean')
    expect((await loader.load(request))?.toString()).toBe('clean')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('each download has its own window from its start (fifth review, finding 3, second round)', () => {
  /** A remote that never answers, and honours the signal it is given, as a real fetch does. */
  const silentHost = () => {
    const calls = { count: 0 }
    const fetchImpl = ((_uri: string, init: { signal: AbortSignal }) => {
      calls.count += 1
      return new Promise<Response>((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      )
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }
  const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

  // (a) The reviewer's late-start scenario. The download starts at 250 ms, so the arrival deadline at 300 ms sheds
  // the first request. The download still has its window, its answer at 350 ms is kept, and the second request,
  // at 400 ms, is served from it with no new fetch.
  it('sheds a late-started download, keeps its late answer, and serves the next request from it', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    const holding = gate.run(() => sleep(250))
    const healthyHost = vi.fn(
      (_uri: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          const answer = setTimeout(() => resolve(new Response(bytesOf('logo'))), 100)
          init.signal.addEventListener('abort', () => {
            clearTimeout(answer)
            reject(new Error('aborted'))
          })
        }),
    ) as unknown as typeof fetch
    const loader = createRemoteImageLoader({
      fetchImpl: healthyHost,
      sanitize: async (bytes) => bytes,
      gate,
      timeoutMs: 300,
    })
    const request = { uri: 'https://cdn.example/healthy.png', ext: '.png' }

    const first = loader.load(request)
    expect(await first).toBe(REMOTE_IMAGE_SHED)
    await holding
    const second = await loader.load(request)

    expect(second?.toString()).toBe('logo')
    expect(healthyHost).toHaveBeenCalledTimes(1)
  })

  // (b) A remote that never answers, after queueing. The download starts at 100 ms with the whole 300 ms window,
  // so the arrival deadline at 300 ms sheds the request while the download still has its window. When that
  // window ends, at 400 ms, the address is charged, and the next request makes no new fetch.
  it('charges a silent remote once its full window has passed, even though the request was shed before', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    const holding = gate.run(() => sleep(100))
    const { fetchImpl, calls } = silentHost()
    const loader = createRemoteImageLoader({ fetchImpl, sanitize: async (bytes) => bytes, gate, timeoutMs: 300 })
    const request = { uri: 'https://cdn.example/silent-queued.png', ext: '.png' }

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    await holding
    await sleep(250)
    expect(await loader.load(request)).toBeNull()
    expect(calls.count).toBe(1)
  })

  // (c) The same remote with no queueing: the download starts at arrival, so its window and the arrival
  // deadline end together, and the address is charged as before.
  it('charges a silent remote that started at arrival, and makes no new fetch afterwards', async () => {
    const { fetchImpl, calls } = silentHost()
    const loader = createRemoteImageLoader({ fetchImpl, sanitize: async (bytes) => bytes, timeoutMs: 100 })
    const request = { uri: 'https://cdn.example/silent-now.png', ext: '.png' }

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    await sleep(150)
    expect(await loader.load(request)).toBeNull()
    expect(calls.count).toBe(1)
  })
})

describe('a download is shared by the requests for its address, and kept (fifth review, denial of service)', () => {
  const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  /** A host that answers after `milliseconds`, honouring the signal it is given. */
  const slowHost = (milliseconds: number) => {
    const calls = { count: 0 }
    const fetchImpl = vi.fn((_uri: string, init: { signal: AbortSignal }) => {
      calls.count += 1
      return new Promise<Response>((resolve, reject) => {
        const answer = setTimeout(() => resolve(new Response(bytesOf('logo'))), milliseconds)
        init.signal.addEventListener('abort', () => {
          clearTimeout(answer)
          reject(new Error('aborted'))
        })
      })
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  // (a) Requests for one address during one window join the download that is running. They do not start more.
  it('makes exactly one fetch for many requests for one address during one window', async () => {
    const { fetchImpl, calls } = slowHost(100)
    const loader = createRemoteImageLoader({ fetchImpl, sanitize: async (bytes) => bytes, timeoutMs: 300 })
    const request = { uri: 'https://cdn.example/shared.png', ext: '.png' }

    const results = await Promise.all(Array.from({ length: 10 }, () => loader.load(request)))

    expect(results.every((result) => result?.toString() === 'logo')).toBe(true)
    expect(calls.count).toBe(1)
  })

  // (b) A download the request left is not stopped and its late answer is kept: the next request is served from
  // the cache. The download queues for 100 ms, so its window (400 ms) ends after the arrival deadline (400 ms)
  // only if it starts late; here it starts at 100 ms, the request is shed at 400 ms, and the answer at 450 ms is
  // inside the window (100 + 400 = 500 ms).
  it('keeps a late answer, and serves the next request from it with no new fetch', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
    const holding = gate.run(() => sleep(100))
    const { fetchImpl, calls } = slowHost(350)
    const loader = createRemoteImageLoader({ fetchImpl, sanitize: async (bytes) => bytes, gate, timeoutMs: 400 })
    const request = { uri: 'https://cdn.example/late.png', ext: '.png' }

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    await holding
    await sleep(200)
    expect((await loader.load(request))?.toString()).toBe('logo')
    expect(calls.count).toBe(1)
  })
})

describe('the sanitizing budget starts when a worker is granted (sixth review, finding 1)', () => {
  const sleepFor = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

  // The reviewer's scenario, scaled to 1 second: a 400 ms file holds the worker; a 900 ms file is requested 50 ms
  // later with a 1,000 ms window. It waits 350 ms for the worker, then sanitizes for 900 ms, so it finishes at
  // 1,300 ms, past its own window (fetch, 1,000 ms) but inside its sanitizing budget (granted at 400 ms, 1,000 ms).
  // It must not be charged: the file is kept, and the next request is served from it.
  it('does not charge a file whose wait for a worker used up its window', async () => {
    const pool = createSanitizerPool({
      workerUrl: new URL('./__testing__/slow-sanitize-worker.ts', import.meta.url),
      budgetMs: 1_500,
    })
    try {
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, () => true)
      await sleepFor(50)
      const fetchImpl = vi.fn(async () => new Response(bytesOf('SLOW')))
      const loader = createRemoteImageLoader({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sanitizer: pool,
        timeoutMs: 1_000,
      })
      const request = { uri: 'https://cdn.example/slow.svg', ext: '.svg' }

      expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
      await holder
      // The file finishes sanitizing after this request was shed, and is kept; the next request is served from it.
      await sleepFor(1_500)

      expect((await loader.load(request))?.toString()).toBe('SLOW')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      pool.close()
    }
  })
})

describe('an unavailable sanitizer is shed, never charged (sixth review, finding 2)', () => {
  it('answers shed, and charges nothing, when the sanitizer is unavailable, so the next request tries again', async () => {
    const attempts: SanitizeAttempt[] = [
      { status: 'unavailable', message: 'sanitizer worker failed: fixture' },
      { status: 'sanitized', bytes: Buffer.from('logo') },
    ]
    const run = vi.fn(async () => attempts.shift() ?? { status: 'refused' as const, message: 'no answer left' })
    const sanitizer: SanitizerRunner = {
      run,
      workers: () => 0,
      reserve: () => ({ release: () => undefined }),
      workersPeak: () => 0,
      workersStarted: () => 0,
      close: () => undefined,
    }
    const fetchImpl = vi.fn(async () => new Response(bytesOf('logo')))
    const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer })
    const request = { uri: 'https://cdn.example/unavailable.png', ext: '.png' }

    expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
    expect((await loader.load(request))?.toString()).toBe('logo')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('a worker failure is charged to the file only after the worker was ready (sixth review, crash gap)', () => {
  const workerAt = (name: string) => new URL(`./__testing__/${name}`, import.meta.url)

  // A file whose job throws out of a worker that had loaded. Charged: the next request is refused from memory, with
  // no new fetch and no new worker, so the file cannot restart the worker on every request.
  it('charges a file whose job crashes a loaded worker, so the next request makes no new fetch', async () => {
    const pool = createSanitizerPool({ workerUrl: workerAt('crashing-sanitize-worker.ts') })
    try {
      const fetchImpl = vi.fn(async () => new Response(bytesOf('crash-me')))
      const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer: pool })
      const request = { uri: 'https://cdn.example/crashes-worker.svg', ext: '.svg' }

      expect(await loader.load(request)).toBeNull()
      expect(await loader.load(request)).toBeNull()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      pool.close()
    }
  })

  // A worker that fails while loading never took a file: nothing is charged, and the next request tries again.
  it('sheds, and retries, when the worker fails while loading', async () => {
    const pool = createSanitizerPool({ workerUrl: workerAt('failing-import-sanitize-worker.ts') })
    try {
      const fetchImpl = vi.fn(async () => new Response(bytesOf('logo')))
      const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer: pool })
      const request = { uri: 'https://cdn.example/fails-to-load.svg', ext: '.svg' }

      expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
      expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      pool.close()
    }
  })
})

describe('the fetch gate covers only the fetch, not the wait for a sanitizer (sixth review, gate)', () => {
  const slowWorker = () => new URL('./__testing__/slow-sanitize-worker.ts', import.meta.url)

  // Gate limit one. The first file's fetch finishes at once, then it waits behind a 400 ms holder for the worker.
  // The second address must still fetch while that wait lasts: the first file holds no fetch slot while it waits.
  it('lets a second address fetch while the first address waits for the sanitizer', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker() })
    try {
      let holderDone = false
      const holder = pool
        .run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, () => true)
        .then(() => {
          holderDone = true
        })
      const fetchImpl = vi.fn(async () => new Response(bytesOf('MID')))
      const gate = createConcurrencyGate({ limit: 1, maxQueue: 4 })
      const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer: pool, gate })

      const first = loader.load({ uri: 'https://cdn.example/first.svg', ext: '.svg' })
      const second = loader.load({ uri: 'https://cdn.example/second.svg', ext: '.svg' })

      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
      expect(holderDone).toBe(false)
      expect((await first)?.toString()).toBe('MID')
      expect((await second)?.toString()).toBe('MID')
      await holder
    } finally {
      pool.close()
    }
  })

  // A file the queue sheds was never cleaned, so it is dropped: the next request fetches again, and is not served
  // the uncleaned bytes from memory.
  it('drops the bytes of a file the queue sheds, and the next request fetches again', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker(), queueMaxWaitMs: 100 })
    try {
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, () => true)
      const fetchImpl = vi.fn(async () => new Response(bytesOf('MID')))
      const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer: pool })
      const request = { uri: 'https://cdn.example/shed.svg', ext: '.svg' }

      expect(await loader.load(request)).toBe(REMOTE_IMAGE_SHED)
      await holder
      expect((await loader.load(request))?.toString()).toBe('MID')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      pool.close()
    }
  })

  it('refuses a file that an in-process sanitizer throws on, and charges the address', async () => {
    const fetchImpl = vi.fn(async () => new Response(bytesOf('bad')))
    const loader = createRemoteImageLoader({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sanitize: async () => {
        throw new Error('refused in process')
      },
    })
    const request = { uri: 'https://cdn.example/throws.svg', ext: '.svg' }

    expect(await loader.load(request)).toBeNull()
    expect(await loader.load(request)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('a download reserves a place in the sanitizer queue first (sixth review, outbound amplification)', () => {
  const slowWorker = () => new URL('./__testing__/slow-sanitize-worker.ts', import.meta.url)

  // With every place in use, a new address is shed at once: it is not downloaded, so no fetch is made for it.
  it('answers shed, and makes no fetch, for a new address while the queue is full', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker(), queueLimit: 1 })
    try {
      const holderPlace = pool.reserve()
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, () => true)
      const fetchImpl = vi.fn(async () => new Response(bytesOf('MID')))
      const loader = createRemoteImageLoader({ fetchImpl: fetchImpl as unknown as typeof fetch, sanitizer: pool })

      expect(await loader.load({ uri: 'https://cdn.example/new.svg', ext: '.svg' })).toBe(REMOTE_IMAGE_SHED)
      expect(fetchImpl).not.toHaveBeenCalled()

      holderPlace?.release()
      await holder
    } finally {
      pool.close()
    }
  })

  // Every failure and every shed must give its place back: after many of them, the queue still accepts work.
  it('gives every place back after refusals and sheds, so the queue still accepts work', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker(), queueLimit: 2, queueMaxWaitMs: 50 })
    try {
      const refusing = createRemoteImageLoader({
        fetchImpl: vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
        sanitizer: pool,
      })
      for (let index = 0; index < 5; index += 1) {
        expect(await refusing.load({ uri: `https://cdn.example/refused-${index}.svg`, ext: '.svg' })).toBeNull()
      }
      const holderPlace = pool.reserve()
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, () => true)
      const shedding = createRemoteImageLoader({
        fetchImpl: vi.fn(async () => new Response(bytesOf('MID'))) as unknown as typeof fetch,
        sanitizer: pool,
      })
      for (let index = 0; index < 5; index += 1) {
        expect(await shedding.load({ uri: `https://cdn.example/shed-${index}.svg`, ext: '.svg' })).toBe(
          REMOTE_IMAGE_SHED,
        )
      }

      // The holder keeps one place; the five refusals and five sheds gave theirs back, so one more is free.
      const probe = pool.reserve()
      expect(probe).not.toBeNull()
      expect(pool.reserve()).toBeNull()

      probe?.release()
      holderPlace?.release()
      await holder
    } finally {
      pool.close()
    }
  })

  // A download that reserved its place is cleaned in it, and its place is released after the cleaning.
  it('cleans a file it downloaded in the place it reserved, and frees the place afterwards', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker(), queueLimit: 1 })
    try {
      const loader = createRemoteImageLoader({
        fetchImpl: vi.fn(async () => new Response(bytesOf('logo'))) as unknown as typeof fetch,
        sanitizer: pool,
      })

      expect((await loader.load({ uri: 'https://cdn.example/cleaned.svg', ext: '.svg' }))?.toString()).toBe('logo')
      expect(pool.reserve()).not.toBeNull()
    } finally {
      pool.close()
    }
  })
})
