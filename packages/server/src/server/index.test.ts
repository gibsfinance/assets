/**
 * Tests for the process entrypoint: static file mounting at import time, the
 * `listen()` promise contract (resolve on 'listening', reject on 'error'),
 * and `main()`'s port-selection ternary plus its wait on the app's own
 * 'close'/'error' events after the server starts listening.
 *
 * The real `app` from ./app pulls in the whole route tree (database, sharp,
 * etc.) — this file only needs an object shaped like an Express app plus an
 * event emitter, so ./app is replaced with a minimal hand-rolled stand-in
 * that never touches a real socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** Minimal event emitter matching the `.once`/`.emit` surface main() and listen() use. */
function makeEmitter() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    once(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return this
    },
    trigger(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
    reset() {
      listeners.clear()
    },
  }
}

let fakeServer = makeEmitter()
const fakeApp = Object.assign(makeEmitter(), {
  use: vi.fn(),
  listen: vi.fn(() => fakeServer),
})

vi.mock('./app', () => ({ app: fakeApp }))

describe('server entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PORT
    // Fresh listener state per test — main()/listen() each register new
    // 'listening'/'close'/'error' subscribers, and a stale one left over
    // from a prior test must not still be attached when we trigger events.
    fakeApp.reset()
    fakeServer = makeEmitter()
    fakeApp.listen.mockReturnValue(fakeServer)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mounts static file serving on the app at import time', async () => {
    await import('./index')
    expect(fakeApp.use).toHaveBeenCalled()
  })

  describe('listen()', () => {
    it('resolves once the server emits "listening", using the given port', async () => {
      const { listen } = await import('./index')
      const promise = listen(4321)
      fakeServer.trigger('listening')
      await expect(promise).resolves.toBeNull()
      expect(fakeApp.listen).toHaveBeenCalledWith(4321)
    })

    it('defaults to port 3000 when none is given', async () => {
      const { listen } = await import('./index')
      const promise = listen()
      fakeServer.trigger('listening')
      await promise
      expect(fakeApp.listen).toHaveBeenCalledWith(3000)
    })

    it('rejects when the server emits "error"', async () => {
      const { listen } = await import('./index')
      const promise = listen(4321)
      const err = new Error('EADDRINUSE')
      fakeServer.trigger('error', err)
      await expect(promise).rejects.toBe(err)
    })
  })

  describe('main()', () => {
    // main() chains `.then()` off listen()'s promise before registering the
    // app-level 'close'/'error' listeners — that registration lands on a
    // later microtask, so tests must yield before firing those events.
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('reads PORT from the environment (parseInt branch) and resolves when the app closes', async () => {
      process.env.PORT = '5000'
      const { main } = await import('./index')

      const promise = main()
      fakeServer.trigger('listening')
      expect(fakeApp.listen).toHaveBeenCalledWith(5000)
      await flushMicrotasks()
      fakeApp.trigger('close')

      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects when the app emits "error" after startup', async () => {
      const { main } = await import('./index')

      const promise = main()
      fakeServer.trigger('listening')
      await flushMicrotasks()
      const err = new Error('fatal')
      fakeApp.trigger('error', err)

      await expect(promise).rejects.toBe(err)
    })
  })
})
