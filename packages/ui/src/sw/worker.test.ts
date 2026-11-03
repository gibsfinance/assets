import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorker, type FetchEventLike, type WorkerDependencies } from './worker'
import { CACHE_NAME, SHELL_URL } from './worker-logic'

const origin = 'https://gib.show'
const absolute = (input: RequestInfo | URL) =>
  new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin).href

/** An in-memory Cache keyed by absolute address. */
class FakeCache {
  entries = new Map<string, Response>()
  async match(input: RequestInfo | URL) {
    return this.entries.get(absolute(input))?.clone()
  }
  async put(input: RequestInfo | URL, response: Response) {
    this.entries.set(absolute(input), response)
  }
  async delete(input: RequestInfo | URL) {
    return this.entries.delete(absolute(input))
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

/** An in-memory CacheStorage. */
class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
}

const SHELL_V1 = '<script src="./assets/index-1.js"></script><style>a{src:url(./assets/f-1.woff2)}</style>'
const SHELL_V2 = '<script src="./assets/index-2.js"></script><style>a{src:url(./assets/f-1.woff2)}</style>'

const SHELL_V3 = '<script src="./assets/index-3.js"></script><style>a{src:url(./assets/f-1.woff2)}</style>'

let storage: FakeCacheStorage
let network: Map<string, () => Response>
let requested: string[]
let fetchFile: ReturnType<typeof vi.fn>
let skipWaiting: ReturnType<typeof vi.fn>
let claimClients: ReturnType<typeof vi.fn>

const dependencies = (): WorkerDependencies => ({
  caches: storage as unknown as CacheStorage,
  fetchFile: fetchFile as unknown as typeof fetch,
  origin,
  skipWaiting: skipWaiting as () => Promise<void>,
  claimClients: claimClients as () => Promise<void>,
})

const html = (body: string) => () => new Response(body, { status: 200 })

beforeEach(() => {
  storage = new FakeCacheStorage()
  requested = []
  network = new Map([
    ['https://gib.show/index.html', html(SHELL_V1)],
    ['https://gib.show/', html(SHELL_V1)],
    ['https://gib.show/assets/index-1.js', () => new Response('one')],
    ['https://gib.show/assets/index-2.js', () => new Response('two')],
    ['https://gib.show/assets/f-1.woff2', () => new Response('font')],
  ])
  fetchFile = vi.fn(async (input: RequestInfo | URL) => {
    const url = absolute(input)
    requested.push(url)
    const answer = network.get(url)
    if (!answer) throw new TypeError('offline')
    return answer()
  })
  skipWaiting = vi.fn().mockResolvedValue(undefined)
  claimClients = vi.fn().mockResolvedValue(undefined)
})

const cache = () => storage.open(CACHE_NAME)
const cachedUrls = async () => [...(await cache()).entries.keys()].sort()

/** A fetch event that records what the worker did with it. */
function fetchEvent(url: string, init: { method?: string; mode?: RequestMode } = {}) {
  const pending: Promise<unknown>[] = []
  let answer: Promise<Response> | undefined
  const request = new Request(url, { method: init.method ?? 'GET' })
  Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' })
  const event: FetchEventLike = {
    request,
    respondWith: (value) => {
      answer = value
    },
    waitUntil: (work) => {
      pending.push(work)
    },
  }
  return {
    event,
    intercepted: () => answer !== undefined,
    response: () => answer!,
    settle: () => Promise.all(pending),
  }
}

describe('install', () => {
  it('takes over at once and stores the shell with the files it names', async () => {
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)

    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(await cachedUrls()).toEqual([
      'https://gib.show/assets/f-1.woff2',
      'https://gib.show/assets/index-1.js',
      'https://gib.show/index.html',
    ])
  })

  it('still installs when the network is down', async () => {
    network.clear()
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => pending.push(work) })
    await expect(Promise.all(pending)).resolves.toBeDefined()
    expect(await cachedUrls()).toEqual([])
  })

  it('does not store an error page as the shell', async () => {
    network.set('https://gib.show/index.html', () => new Response('nope', { status: 503 }))
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)
    expect(await cachedUrls()).toEqual([])
  })

  it('does not store a redirected answer as the shell', async () => {
    const redirected = new Response(SHELL_V1)
    Object.defineProperty(redirected, 'redirected', { value: true })
    network.set('https://gib.show/index.html', () => redirected)
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)
    expect(await cachedUrls()).toEqual([])
  })
})

describe('activate', () => {
  it('deletes caches of other versions, keeps its own, and claims open pages', async () => {
    await storage.open('gib-shell-v0')
    await storage.open(CACHE_NAME)
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onActivate({ waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)

    expect(await storage.keys()).toEqual([CACHE_NAME])
    expect(claimClients).toHaveBeenCalledOnce()
  })
})

describe('navigation', () => {
  it('goes to the network when nothing is cached, then stores the page for next time', async () => {
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)

    expect(await (await visit.response()).text()).toBe(SHELL_V1)
    await visit.settle()
    expect(await cachedUrls()).toContain('https://gib.show/index.html')
    expect(await cachedUrls()).toContain('https://gib.show/assets/index-1.js')
  })

  it('answers from the cache without waiting for the network, and refreshes behind it', async () => {
    const store = await cache()
    await store.put(SHELL_URL, new Response(SHELL_V1))
    network.set('https://gib.show/index.html', html(SHELL_V2))
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)

    expect(await (await visit.response()).text()).toBe(SHELL_V1)
    await visit.settle()
    expect(await (await store.match(SHELL_URL))!.text()).toBe(SHELL_V2)
    expect(fetchFile).toHaveBeenCalledWith(SHELL_URL, { cache: 'no-cache' })
  })

  it('keeps the cached page when the background refresh fails', async () => {
    const store = await cache()
    await store.put(SHELL_URL, new Response(SHELL_V1))
    network.clear()
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)

    expect(await (await visit.response()).text()).toBe(SHELL_V1)
    await expect(visit.settle()).resolves.toBeDefined()
    expect(await (await store.match(SHELL_URL))!.text()).toBe(SHELL_V1)
  })

  it('fails like the network when nothing is cached and the network is down', async () => {
    network.clear()
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)
    await expect(visit.response()).rejects.toThrow('offline')
  })

  it('does not rewrite the cache when the page has not changed', async () => {
    const store = await cache()
    await store.put(SHELL_URL, new Response(SHELL_V1))
    const put = vi.spyOn(store, 'put')
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)
    await visit.settle()
    expect(put).not.toHaveBeenCalled()
  })

  it('swallows a failure while storing the first network answer', async () => {
    const store = await cache()
    vi.spyOn(store, 'put').mockRejectedValue(new Error('quota'))
    const worker = createWorker(dependencies())
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)
    expect(await (await visit.response()).text()).toBe(SHELL_V1)
    await expect(visit.settle()).resolves.toBeDefined()
  })
})

describe('deploy', () => {
  const visitAfter = async (worker: ReturnType<typeof createWorker>) => {
    const visit = fetchEvent('https://gib.show/', { mode: 'navigate' })
    worker.onFetch(visit.event)
    await visit.settle()
  }

  it('fetches the new files and keeps the previous page files for a tab still running it', async () => {
    const worker = createWorker(dependencies())
    const first: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => first.push(work) })
    await Promise.all(first)

    network.set('https://gib.show/index.html', html(SHELL_V2))
    await visitAfter(worker)

    expect(await cachedUrls()).toEqual([
      'https://gib.show/assets/f-1.woff2',
      'https://gib.show/assets/index-1.js',
      'https://gib.show/assets/index-2.js',
      'https://gib.show/index.html',
    ])
  })

  it('prunes files that neither the new page nor the one before it names', async () => {
    const worker = createWorker(dependencies())
    const first: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => first.push(work) })
    await Promise.all(first)
    network.set('https://gib.show/index.html', html(SHELL_V2))
    await visitAfter(worker)

    network.set('https://gib.show/assets/index-3.js', () => new Response('three'))
    network.set('https://gib.show/index.html', html(SHELL_V3))
    await visitAfter(worker)

    expect(await cachedUrls()).toEqual([
      'https://gib.show/assets/f-1.woff2',
      'https://gib.show/assets/index-2.js',
      'https://gib.show/assets/index-3.js',
      'https://gib.show/index.html',
    ])
  })

  it('tolerates a file that fails to download', async () => {
    network.delete('https://gib.show/assets/index-1.js')
    network.set('https://gib.show/assets/f-1.woff2', () => new Response('gone', { status: 404 }))
    const worker = createWorker(dependencies())
    const pending: Promise<unknown>[] = []
    worker.onInstall({ waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)
    expect(await cachedUrls()).toEqual(['https://gib.show/index.html'])
  })
})

describe('assets', () => {
  it('serves a cached file without touching the network', async () => {
    const store = await cache()
    await store.put('/assets/index-1.js', new Response('cached'))
    const worker = createWorker(dependencies())
    const load = fetchEvent('https://gib.show/assets/index-1.js', { mode: 'no-cors' })
    worker.onFetch(load.event)
    expect(await (await load.response()).text()).toBe('cached')
    expect(requested).toEqual([])
  })

  it('fetches a missing file once and keeps it', async () => {
    const worker = createWorker(dependencies())
    const load = fetchEvent('https://gib.show/assets/index-2.js', { mode: 'no-cors' })
    worker.onFetch(load.event)
    expect(await (await load.response()).text()).toBe('two')
    expect(await cachedUrls()).toEqual(['https://gib.show/assets/index-2.js'])
  })

  it('does not keep a failed answer', async () => {
    network.set('https://gib.show/assets/index-2.js', () => new Response('missing', { status: 404 }))
    const worker = createWorker(dependencies())
    const load = fetchEvent('https://gib.show/assets/index-2.js', { mode: 'no-cors' })
    worker.onFetch(load.event)
    expect((await load.response()).status).toBe(404)
    expect(await cachedUrls()).toEqual([])
  })
})

describe('everything else', () => {
  it.each([
    ['https://gib.show/image/eip155-1/0xabc?w=96', 'GET', 'no-cors'],
    ['https://gib.show/list/search?q=usdc', 'GET', 'cors'],
    ['https://gib.show/networks', 'GET', 'cors'],
    ['https://gib.show/stats', 'GET', 'cors'],
    ['https://gib.show/docs', 'GET', 'navigate'],
    ['https://other.example/assets/x.js', 'GET', 'no-cors'],
    ['https://gib.show/assets/index-1.js', 'POST', 'cors'],
    ['https://gib.show/', 'POST', 'navigate'],
  ] as const)('does not intercept %s (%s)', async (url, method, mode) => {
    const worker = createWorker(dependencies())
    const call = fetchEvent(url, { method, mode })
    worker.onFetch(call.event)
    expect(call.intercepted()).toBe(false)
    expect(requested).toEqual([])
    expect(await storage.keys()).toEqual([])
  })
})
