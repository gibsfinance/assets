import { describe, it, expect, vi, afterEach } from 'vitest'
import { installServiceWorker, type WorkerScope } from './sw'
import { killWorkerSource } from './kill-worker'

const fakeScope = () => {
  const listeners = new Map<string, (event: never) => void>()
  const scope = {
    addEventListener: vi.fn((type: string, listener: (event: never) => void) => listeners.set(type, listener)),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    location: { origin: 'https://gib.show' },
    caches: { open: vi.fn(), keys: vi.fn().mockResolvedValue([]), delete: vi.fn() },
    fetch: vi.fn().mockResolvedValue(new Response('<html></html>')),
  }
  return { scope: scope as unknown as WorkerScope & typeof scope, listeners }
}

afterEach(() => vi.unstubAllGlobals())

describe('installServiceWorker', () => {
  it('attaches install, activate and fetch handlers that use the scope services', async () => {
    const { scope, listeners } = fakeScope()
    installServiceWorker(scope)
    expect([...listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install'])

    const work: Promise<unknown>[] = []
    ;(listeners.get('install') as (event: unknown) => void)({ waitUntil: (p: Promise<unknown>) => work.push(p) })
    ;(listeners.get('activate') as (event: unknown) => void)({ waitUntil: (p: Promise<unknown>) => work.push(p) })
    await Promise.all(work)
    expect(scope.skipWaiting).toHaveBeenCalledOnce()
    expect(scope.clients.claim).toHaveBeenCalledOnce()
    expect(scope.fetch).toHaveBeenCalled()
  })

  it('answers nothing for a request it does not handle', () => {
    const { scope, listeners } = fakeScope()
    installServiceWorker(scope)
    const respondWith = vi.fn()
    ;(listeners.get('fetch') as (event: unknown) => void)({
      request: new Request('https://gib.show/networks'),
      respondWith,
      waitUntil: vi.fn(),
    })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('installs itself on the global scope when the module loads', async () => {
    const { scope, listeners } = fakeScope()
    vi.stubGlobal('self', scope)
    vi.resetModules()
    await import('./sw')
    expect([...listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install'])
  })
})

describe('kill worker', () => {
  it('deletes every cache and unregisters itself, and takes over without waiting', async () => {
    const handlers = new Map<string, (event: unknown) => void>()
    const deleted: string[] = []
    const self = {
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
      skipWaiting: vi.fn(),
      registration: { unregister: vi.fn().mockResolvedValue(true) },
    }
    const cacheStorage = {
      keys: async () => ['gib-shell-v1', 'other'],
      delete: async (name: string) => deleted.push(name),
    }
    new Function('self', 'caches', killWorkerSource)(self, cacheStorage)

    handlers.get('install')!({})
    expect(self.skipWaiting).toHaveBeenCalledOnce()

    let finished: Promise<unknown> = Promise.resolve()
    handlers.get('activate')!({ waitUntil: (work: Promise<unknown>) => (finished = work) })
    await finished
    expect(deleted).toEqual(['gib-shell-v1', 'other'])
    expect(self.registration.unregister).toHaveBeenCalledOnce()
  })
})
