import { describe, it, expect, vi } from 'vitest'
import {
  installPreloadRecovery,
  shouldReload,
  LAST_RELOAD_KEY,
  RELOAD_WINDOW_MS,
  type PreloadRecoveryEnvironment,
} from './preload-recovery'

describe('shouldReload', () => {
  it('reloads when no reload has happened', () => {
    expect(shouldReload(1_000, null)).toBe(true)
  })

  it('does not reload again inside the window', () => {
    expect(shouldReload(1_000 + RELOAD_WINDOW_MS - 1, 1_000)).toBe(false)
  })

  it('reloads again once the window has passed', () => {
    expect(shouldReload(1_000 + RELOAD_WINDOW_MS, 1_000)).toBe(true)
  })
})

/** Installs the recovery over fakes and returns a way to fire the Vite event. */
function setup(options: { time?: number; stored?: string | null; storageBroken?: 'read' | 'write' } = {}) {
  const store = new Map<string, string>()
  if (options.stored != null) store.set(LAST_RELOAD_KEY, options.stored)
  const reload = vi.fn()
  let clock = options.time ?? 100_000
  let listener: ((event: { preventDefault: () => void }) => void) | undefined
  const environment: PreloadRecoveryEnvironment = {
    window: {
      addEventListener: (_type, handler) => {
        listener = handler
      },
      sessionStorage: {
        getItem: (key) => {
          if (options.storageBroken === 'read') throw new Error('blocked')
          return store.get(key) ?? null
        },
        setItem: (key, value) => {
          if (options.storageBroken === 'write') throw new Error('full')
          store.set(key, value)
        },
      },
      location: { reload },
    },
    now: () => clock,
  }
  installPreloadRecovery(environment)
  const fail = () => {
    const preventDefault = vi.fn()
    listener!({ preventDefault })
    return preventDefault
  }
  return { fail, reload, store, advance: (ms: number) => (clock += ms) }
}

describe('installPreloadRecovery', () => {
  it('reloads once on the first failure, and stops the error being thrown', () => {
    const { fail, reload, store } = setup()
    const preventDefault = fail()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(store.get(LAST_RELOAD_KEY)).toBe('100000')
  })

  it('lets a second failure inside the window surface instead of looping', () => {
    const { fail, reload } = setup()
    fail()
    const second = fail()
    expect(second).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again after the window has passed', () => {
    const { fail, reload, advance } = setup()
    fail()
    advance(RELOAD_WINDOW_MS + 1)
    fail()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('lets the error surface when storage cannot be read, since the loop cannot be guarded', () => {
    const { fail, reload } = setup({ storageBroken: 'read' })
    expect(fail()).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('lets the error surface when the reload cannot be recorded', () => {
    const { fail, reload } = setup({ storageBroken: 'write' })
    expect(fail()).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
